/** Whole-page translation session state (content script is source of truth). */
export type PageTranslatePhase = 'idle' | 'running' | 'done';

/** True when a page translate session is in progress or finished (not idle). */
export function isPageTranslateStarted(phase: PageTranslatePhase): boolean {
  return phase !== 'idle';
}
