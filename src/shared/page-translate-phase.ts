/** Whole-page translation session state (content script is source of truth). */
export type PageTranslatePhase = 'idle' | 'running' | 'done';

export const PAGE_TRANSLATE_ACTION_LABEL = {
  start: 'Translate This Page',
  stop: 'Stop Page Translation',
  restore: 'Restore Original Page',
} as const;

export const PAGE_TRANSLATE_CONTEXT_MENU_TITLE: Record<PageTranslatePhase, string> = {
  idle: PAGE_TRANSLATE_ACTION_LABEL.start,
  running: PAGE_TRANSLATE_ACTION_LABEL.stop,
  done: PAGE_TRANSLATE_ACTION_LABEL.restore,
};

/** True when a page translate session is in progress or finished (not idle). */
export function isPageTranslateStarted(phase: PageTranslatePhase): boolean {
  return phase !== 'idle';
}
