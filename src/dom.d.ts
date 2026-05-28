/** Chromium: selection API for closed shadow roots (not yet in default TS DOM lib). */
interface ShadowRoot {
  getSelection(): Selection | null;
}
