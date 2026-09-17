import type { CSSProperties } from 'react';

/**
 * Inline style that sizes an icon in "design px", scaled by the browser's
 * font-size setting.
 *
 * Icons are drawn at a fixed pixel size in a viewBox, so unlike the text and
 * control boxes around them they do not respond to the font-size setting on
 * their own. A fixed 14px glyph next to a scaled label looks broken at a large
 * or small default, so icons in typography-driven surfaces go through here.
 *
 * `--ll-u` is one design pixel (see `shared/theme.css`) and is
 * `calc(var(--ll-root, 1rem) / 16)` on the extension pages and in the
 * content-script shadow root alike. The `1px` fallback keeps the icon at its
 * design size if the token is ever missing.
 *
 * Usage: `<svg style={iconSize(14)} width="14" height="14" …>`
 * (the attributes stay as a no-CSS fallback and are overridden by the style).
 */
export function iconSize(designPx: number): CSSProperties {
  const value = `calc(var(--ll-u, 1px) * ${designPx})`;
  return { width: value, height: value };
}
