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

const MAX_SEGMENT_CHARS = 800;

export interface TextSegment {
  id: string;
  textNodes: Text[];
  originalTexts: string[];
  text: string;
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

export function extractSegments(root: Element = document.body): TextSegment[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      if (isInsideSkipTag(node, root)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const groups: { ancestor: Element; nodes: Text[] }[] = [];
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

  const segments: TextSegment[] = [];
  let idCounter = 0;

  for (const group of groups) {
    let currentNodes: Text[] = [];
    let currentLen = 0;

    for (const node of group.nodes) {
      const trimmed = node.textContent?.trim() ?? '';
      if (!trimmed) continue;

      if (currentLen + trimmed.length > MAX_SEGMENT_CHARS && currentNodes.length > 0) {
        pushSegment(currentNodes);
        currentNodes = [];
        currentLen = 0;
      }
      currentNodes.push(node);
      currentLen += trimmed.length;
    }
    if (currentNodes.length > 0) {
      pushSegment(currentNodes);
    }
  }

  function pushSegment(nodes: Text[]) {
    const text = nodes.map((n) => n.textContent?.trim()).filter(Boolean).join(' ');
    if (text.length > 1) {
      segments.push({
        id: `seg-${idCounter++}`,
        textNodes: nodes,
        originalTexts: nodes.map((n) => n.textContent ?? ''),
        text,
      });
    }
  }

  return segments;
}
