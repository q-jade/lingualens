/** True when the event originated inside the extension shadow UI host. */
export function isInsideOurUI(e: Event): boolean {
  return e.composedPath().some(
    (el) => el instanceof HTMLElement && el.tagName?.toLowerCase() === 'lingua-lens',
  );
}

function hasExtensionUISelection(): boolean {
  const shadow = document.querySelector('lingua-lens')?.shadowRoot;
  if (!shadow || typeof shadow.getSelection !== 'function') return false;
  const selection = shadow.getSelection();
  return Boolean(selection?.rangeCount && !selection.isCollapsed);
}

/** Set on contextmenu inside extension UI; cleared on outside mousedown or after handling. */
let pendingContextMenuSelectionInUI = false;

export function isSelectionInExtensionUI(): boolean {
  return hasExtensionUISelection();
}

export function shouldBlockSelectionTranslate(): boolean {
  return pendingContextMenuSelectionInUI || isSelectionInExtensionUI();
}

export function clearContextMenuSelectionBlock(): void {
  pendingContextMenuSelectionInUI = false;
}

/** Like shouldBlockSelectionTranslate, but clears pending after the decision is consumed. */
export function checkSelectionTranslateBlock(): boolean {
  const block = shouldBlockSelectionTranslate();
  if (block) pendingContextMenuSelectionInUI = false;
  return block;
}

/** Mark pending when contextmenu originates inside extension UI (no isInsideOurUI check needed). */
export function markContextMenuInExtensionUI(): void {
  pendingContextMenuSelectionInUI = true;
}
