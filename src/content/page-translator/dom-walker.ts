const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'CODE', 'PRE',
  'KBD', 'SAMP', 'VAR', 'SMART-TRANSLATOR',
]);

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
  'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DT', 'DD',
]);

export interface TextSegment {
  id: string;
  element: Element;
  originalHTML: string;
  text: string;
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function getTextContent(el: Element): string {
  return el.textContent?.trim() ?? '';
}

export function extractSegments(root: Element = document.body): TextSegment[] {
  const segments: TextSegment[] = [];
  let idCounter = 0;

  function walk(node: Element) {
    if (SKIP_TAGS.has(node.tagName)) return;
    if (!isVisible(node)) return;

    if (BLOCK_TAGS.has(node.tagName)) {
      const text = getTextContent(node);
      if (text.length > 1) {
        segments.push({
          id: `seg-${idCounter++}`,
          element: node,
          originalHTML: node.innerHTML,
          text,
        });
      }
      return;
    }

    for (const child of node.children) {
      walk(child);
    }

    if (node.children.length === 0) {
      const text = getTextContent(node);
      if (text.length > 1 && node.parentElement && !BLOCK_TAGS.has(node.parentElement.tagName)) {
        segments.push({
          id: `seg-${idCounter++}`,
          element: node,
          originalHTML: node.innerHTML,
          text,
        });
      }
    }
  }

  walk(root);
  return segments;
}
