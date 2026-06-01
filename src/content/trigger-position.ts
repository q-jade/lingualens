/** Get corners of the selection. */
export function getSelectionCorners(range: Range): { x: number; y: number }[] {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const rect = range.getBoundingClientRect();
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom },
  ];

  if (rects.length < 2) return corners;
  corners[0].x = Math.max(corners[0].x, rects[0].left);
  corners[1].x = Math.min(corners[1].x, rects[0].right);
  corners[2].x = Math.max(corners[2].x, rects[rects.length - 1].left);
  corners[3].x = Math.min(corners[3].x, rects[rects.length - 1].right);

  return corners;
}

function computePositionByCorners(
  corners: { x: number; y: number }[],
  mouseX: number,
  mouseY: number,
): { x: number; y: number } {
  const prio = [0, 1, 2, 3].sort((a, b) => {
    const da = (mouseX - corners[a].x) ** 2 + (mouseY - corners[a].y) ** 2;
    const db = (mouseX - corners[b].x) ** 2 + (mouseY - corners[b].y) ** 2;
    return da - db;
  });
  const ICON_SIZE = 24;
  const TRIGGER_MARGIN = 8;
  const TRIGGER_OFFSET = 5;
  for (const i of prio) {
    switch (i) {
      case 0: {
        const x = corners[i].x - TRIGGER_OFFSET - ICON_SIZE;
        const y = corners[i].y - TRIGGER_OFFSET - ICON_SIZE;
        if (x < TRIGGER_MARGIN && y < TRIGGER_MARGIN) break;
        return { x: Math.max(x, TRIGGER_MARGIN), y: Math.max(y, TRIGGER_MARGIN) };
      }
      case 1: {
        const x = corners[i].x + TRIGGER_OFFSET;
        const y = corners[i].y - TRIGGER_OFFSET - ICON_SIZE;
        if (x > window.innerWidth - TRIGGER_MARGIN - ICON_SIZE && y < TRIGGER_MARGIN) break;
        return {
          x: Math.min(x, window.innerWidth - TRIGGER_MARGIN - ICON_SIZE),
          y: Math.max(y, TRIGGER_MARGIN),
        };
      }
      case 2: {
        const x = corners[i].x - TRIGGER_OFFSET - ICON_SIZE;
        const y = corners[i].y + TRIGGER_OFFSET;
        if (x < TRIGGER_MARGIN && y > window.innerHeight - TRIGGER_MARGIN - ICON_SIZE) break;
        return {
          x: Math.max(x, TRIGGER_MARGIN),
          y: Math.min(y, window.innerHeight - TRIGGER_MARGIN - ICON_SIZE),
        };
      }
      case 3: {
        const x = corners[i].x + TRIGGER_OFFSET;
        const y = corners[i].y + TRIGGER_OFFSET;
        if (
          x > window.innerWidth - TRIGGER_MARGIN - ICON_SIZE
          && y > window.innerHeight - TRIGGER_MARGIN - ICON_SIZE
        ) break;
        return {
          x: Math.min(x, window.innerWidth - TRIGGER_MARGIN - ICON_SIZE),
          y: Math.min(y, window.innerHeight - TRIGGER_MARGIN - ICON_SIZE),
        };
      }
    }
  }
  const x = Math.min(Math.max(0, mouseX), window.innerWidth);
  const y = Math.min(Math.max(0, mouseY), window.innerHeight);
  return { x, y };
}

/** Place the trigger just outside the selection, near the mouse release point. */
export function computeTriggerPosition(
  range: Range,
  mouseX: number,
  mouseY: number,
): { x: number; y: number } {
  const corners = getSelectionCorners(range);
  return computePositionByCorners(corners, mouseX, mouseY);
}
