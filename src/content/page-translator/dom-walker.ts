import type { ChunkingMode } from '../../shared/types';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'CODE', 'PRE',
  'KBD', 'SAMP', 'VAR', 'LINGUA-LENS', 'INPUT', 'TEXTAREA',
  'SELECT', 'BUTTON',
]);

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
  'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DT', 'DD',
  'MAIN', 'HEADER', 'NAV', 'FOOTER', 'ASIDE', 'FORM',
  'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
  'FIGURE', 'ADDRESS', 'FIELDSET', 'LEGEND',
]);

const SAFETY_LIMIT = 4000;
const MAX_SEGMENT_CHARS = 800;
const MIN_SEGMENT_CHARS = 100;

const SKIP_WORDS = new Set([
  'github', 'huggingface', 'google', 'facebook', 'twitter', 'youtube',
  'instagram', 'linkedin', 'reddit', 'discord', 'slack', 'notion',
  'figma', 'vercel', 'netlify', 'heroku', 'aws', 'azure', 'docker',
  'kubernetes', 'nginx', 'apache', 'linux', 'windows', 'macos',
  'chrome', 'firefox', 'safari', 'edge', 'opera',
  'javascript', 'typescript', 'python', 'rust', 'golang',
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt',
  'npm', 'yarn', 'pnpm', 'webpack', 'vite', 'eslint',
  'openai', 'anthropic', 'meta', 'microsoft', 'apple', 'amazon',
  'ok', 'n/a', 'todo', 'null', 'undefined', 'true', 'false',
]);

/**
 * Returns true if the text doesn't need translation:
 * - Pure numbers (with optional commas, dots, percent, currency symbols)
 * - A single word that is a well-known brand/tech term
 * - Pure punctuation or symbols
 * - Very short content (single character)
 * - URLs, emails, file paths
 */
function shouldSkipTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 1) return true;

  if (/^[\d,.\s%$€¥£+\-*/=()]+$/.test(trimmed)) return true;

  if (/^[^\w\s]+$/.test(trimmed)) return true;

  if (/^(https?:\/\/|www\.|\/[\w/.-]+|\S+@\S+\.\S+)/.test(trimmed)) return true;

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const lower = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SKIP_WORDS.has(lower)) return true;
  }

  return false;
}

export interface SubSegment {
  textNodes: Text[];
  originalTexts: string[];
  textLen: number;
}

export interface TextSegment {
  id: string;
  textNodes: Text[];
  originalTexts: string[];
  text: string;
  subSegments?: SubSegment[];
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function isInsideSkipTag(node: Node, root: Element): boolean {
  let current = node.parentElement;
  while (current && current !== root) {
    if (SKIP_TAGS.has(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

function isBlockLike(tagName: string): boolean {
  return BLOCK_TAGS.has(tagName) || tagName.includes('-');
}

function findBlockAncestor(node: Node, root: Element): Element {
  let current = node.parentElement;
  while (current && current !== root) {
    if (isBlockLike(current.tagName)) return current;
    current = current.parentElement;
  }
  return root;
}

/**
 * Bidirectional search for the best split point near `target` within
 * [toleranceLow, toleranceHigh]. Prefers paragraph breaks (\n\n) over
 * sentence endings, and picks the candidate closest to `target`.
 * Returns the char index immediately after the boundary, or null.
 */
function findBestSplitPoint(
  text: string,
  target: number,
  toleranceLow: number,
  toleranceHigh: number,
): number | null {
  const high = Math.min(toleranceHigh, text.length);
  const low = Math.max(toleranceLow, 0);
  const region = text.slice(low, high);

  let bestPara: number | null = null;
  let bestParaDist = Infinity;
  const paraRe = /\n\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(region)) !== null) {
    const absPos = low + m.index + m[0].length;
    const dist = Math.abs(absPos - target);
    if (dist < bestParaDist) {
      bestParaDist = dist;
      bestPara = absPos;
    }
  }
  if (bestPara !== null) return bestPara;

  let bestSentence: number | null = null;
  let bestSentDist = Infinity;
  const sentRe = /[.!?;。！？；]\s/g;
  while ((m = sentRe.exec(region)) !== null) {
    const absPos = low + m.index + m[0].length;
    const dist = Math.abs(absPos - target);
    if (dist < bestSentDist) {
      bestSentDist = dist;
      bestSentence = absPos;
    }
  }
  return bestSentence;
}

interface NodeGroup {
  ancestor: Element;
  nodes: Text[];
}

function textFromNodes(nodes: Text[]): string {
  return nodes.map((n) => n.textContent?.trim()).filter(Boolean).join(' ');
}

function hasLineBreakBetween(previous: Text, next: Text): boolean {
  const range = document.createRange();
  try {
    range.setStartAfter(previous);
    range.setEndBefore(next);
    return Boolean(range.cloneContents().querySelector('br'));
  } catch {
    return false;
  } finally {
    range.detach();
  }
}

function splitByLineBreaks(nodes: Text[]): SubSegment[] {
  const subSegments: SubSegment[] = [];
  let currentNodes: Text[] = [];

  function flush() {
    const text = textFromNodes(currentNodes);
    if (text.length <= 1) {
      currentNodes = [];
      return;
    }

    subSegments.push({
      textNodes: currentNodes,
      originalTexts: currentNodes.map((n) => n.textContent ?? ''),
      textLen: text.length,
    });
    currentNodes = [];
  }

  for (const node of nodes) {
    if (currentNodes.length > 0 && hasLineBreakBetween(currentNodes[currentNodes.length - 1], node)) {
      flush();
    }
    currentNodes.push(node);
  }
  flush();

  return subSegments;
}

function createSegment(nodes: Text[], idCounter: { value: number }): TextSegment | null {
  const subSegments = splitByLineBreaks(nodes);
  const text = subSegments.length > 1
    ? subSegments.map((s) => textFromNodes(s.textNodes)).join('\n')
    : textFromNodes(nodes);

  if (text.length <= 1) return null;

  return {
    id: `seg-${idCounter.value++}`,
    textNodes: nodes,
    originalTexts: nodes.map((n) => n.textContent ?? ''),
    text,
    ...(subSegments.length > 1 ? { subSegments } : {}),
  };
}

/**
 * Given a group of text nodes and a char limit, split them into segments
 * respecting paragraph and sentence boundaries.
 */
function splitGroup(
  nodes: Text[],
  limit: number,
  idCounter: { value: number },
): TextSegment[] {
  const fullText = nodes.map((n) => n.textContent?.trim()).filter(Boolean).join(' ');
  if (fullText.length <= 1) return [];

  if (fullText.length <= limit) {
    const segment = createSegment(nodes, idCounter);
    return segment ? [segment] : [];
  }

  // Build a char-offset map: for each text node, record where it starts in fullText
  const nodeOffsets: { node: Text; start: number; end: number; trimmed: string }[] = [];
  let offset = 0;
  for (const node of nodes) {
    const trimmed = node.textContent?.trim() ?? '';
    if (!trimmed) continue;
    const start = offset;
    const end = offset + trimmed.length;
    nodeOffsets.push({ node, start, end, trimmed });
    offset = end + 1; // +1 for the space join
  }

  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < nodeOffsets.length) {
    // Find how many nodes fit within `limit` chars from the current position
    const startOffset = nodeOffsets[cursor].start;
    let endIdx = cursor;
    for (let i = cursor; i < nodeOffsets.length; i++) {
      if (nodeOffsets[i].end - startOffset > limit && i > cursor) break;
      endIdx = i;
    }

    // The text covered by nodes [cursor..endIdx]
    const coveredEnd = nodeOffsets[endIdx].end;
    const coveredLen = coveredEnd - startOffset;

    if (coveredLen > limit && endIdx > cursor) {
      // Try to find a better split within these nodes
      const textSlice = fullText.slice(startOffset, coveredEnd);
      const splitAt = findBestSplitPoint(
        textSlice,
        limit,
        Math.floor(limit * 0.6),
        Math.ceil(limit * 1.25),
      );

      if (splitAt !== null) {
        const absSplit = startOffset + splitAt;
        // Find the text node boundary closest to absSplit
        let splitNodeIdx = cursor;
        for (let i = cursor; i <= endIdx; i++) {
          if (nodeOffsets[i].end >= absSplit) {
            splitNodeIdx = i;
            break;
          }
        }
        // Include the node at splitNodeIdx if the split is past its midpoint
        const nodeEntry = nodeOffsets[splitNodeIdx];
        const midpoint = (nodeEntry.start + nodeEntry.end) / 2;
        if (absSplit >= midpoint) splitNodeIdx++;

        if (splitNodeIdx > cursor) {
          const segNodes = nodeOffsets.slice(cursor, splitNodeIdx).map((e) => e.node);
          const segment = createSegment(segNodes, idCounter);
          if (segment) segments.push(segment);
          cursor = splitNodeIdx;
          continue;
        }
      }
    }

    // Default: take nodes [cursor..endIdx] as one segment
    const segNodes = nodeOffsets.slice(cursor, endIdx + 1).map((e) => e.node);
    const segment = createSegment(segNodes, idCounter);
    if (segment) segments.push(segment);
    cursor = endIdx + 1;
  }

  return segments;
}

/**
 * Merge adjacent small segments (under MIN_SEGMENT_CHARS) into larger ones,
 * keeping the combined text under `limit`. Stores original segments as
 * subSegments so the engine can map translations back.
 */
function mergeSmallSegments(segments: TextSegment[], limit: number): TextSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TextSegment[] = [];
  let pending: TextSegment | null = null;
  let pendingSubs: SubSegment[] = [];

  function getSubSegments(seg: TextSegment): SubSegment[] {
    return seg.subSegments ?? [{
      textNodes: seg.textNodes,
      originalTexts: seg.originalTexts,
      textLen: seg.text.length,
    }];
  }

  function flush() {
    if (!pending) return;
    if (pendingSubs.length > 1) {
      pending.subSegments = pendingSubs;
    }
    merged.push(pending);
    pending = null;
    pendingSubs = [];
  }

  for (const seg of segments) {
    if (!pending) {
      pending = { ...seg };
      pendingSubs = getSubSegments(seg);
      continue;
    }

    const combinedLen = pending.text.length + 1 + seg.text.length;
    if (pending.text.length < MIN_SEGMENT_CHARS && combinedLen <= limit) {
      pending = {
        id: pending.id,
        textNodes: [...pending.textNodes, ...seg.textNodes],
        originalTexts: [...pending.originalTexts, ...seg.originalTexts],
        text: pending.text + '\n' + seg.text,
      };
      pendingSubs.push(...getSubSegments(seg));
    } else {
      flush();
      pending = { ...seg };
      pendingSubs = getSubSegments(seg);
    }
  }
  flush();

  return merged;
}

export function extractSegments(
  root: Element = document.body,
  chunkingMode: ChunkingMode = 'quality',
): TextSegment[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      if (isInsideSkipTag(node, root)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const groups: NodeGroup[] = [];
  const ancestorIndex = new Map<Element, number>();

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const ancestor = findBlockAncestor(textNode, root);
    let idx = ancestorIndex.get(ancestor);
    if (idx === undefined) {
      idx = groups.length;
      groups.push({ ancestor, nodes: [] });
      ancestorIndex.set(ancestor, idx);
    }
    groups[idx].nodes.push(textNode);
  }

  const limit = chunkingMode === 'quality' ? SAFETY_LIMIT : MAX_SEGMENT_CHARS;
  const idCounter = { value: 0 };
  let segments: TextSegment[] = [];

  for (const group of groups) {
    const groupSegments = splitGroup(group.nodes, limit, idCounter);
    segments.push(...groupSegments);
  }

  segments = segments.filter((seg) => !shouldSkipTranslation(seg.text));
  segments = mergeSmallSegments(segments, limit);

  return segments;
}
