/**
 * Platform-aware keyboard shortcut display.
 *
 * Convention: macOS renders modifiers as symbols with no separator (⌘S);
 * Windows/Linux use the modifier name joined with `+` (Ctrl+S).
 */
export const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Renders a shortcut like "⌘S" on macOS or "Ctrl+S" elsewhere. */
export function shortcutLabel(key: string): string {
  return isMacPlatform ? `⌘${key}` : `Ctrl+${key}`;
}
