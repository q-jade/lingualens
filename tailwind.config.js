import resolveConfig from 'tailwindcss/resolveConfig.js';

/**
 * Font-size-relative theme for BOTH the extension pages and the content script.
 *
 * THE PROBLEM
 * `rem` is unusable in a content script. Its UI is injected into a shadow root on
 * arbitrary pages, and shadow DOM isolates *selectors*, not units: `rem` always
 * resolves against the HOST DOCUMENT's root `<html>`. On baidu.com
 * (`html { font-size: 100px }`) that rendered `text-xs` at 75px and `rounded-xl`
 * as a 75px radius, blowing up the selection panel.
 *
 * WHAT WE WANT
 * The overlay should follow the browser's *default font size setting*
 * (chrome://settings/fonts) and ignore the page's root; the extension pages
 * should follow that setting too. `rem` gives the right answer for the pages and
 * the wrong one for the overlay, because the two live under different roots.
 *
 * HOW
 * Every `rem` length becomes `calc(var(--ll-root, 1rem) * <px at a 16px root> / 16)`,
 * and `--ll-root` means "the font size to scale against":
 *
 * - Extension pages (popup / options / sidepanel) never define `--ll-root`, so
 *   the `1rem` fallback applies — their own root, i.e. plain `rem`. Their
 *   rendering is unchanged and they keep following the browser's setting.
 * - The content script publishes `--ll-root` on the shadow host
 *   (`src/entrypoints/content/index.tsx`), measured with a `font-size: medium`
 *   probe. Absolute-size keywords resolve from the user's default font size and
 *   never from the page root or an ancestor — measured in Chromium, `medium`
 *   stayed 16px on a 100px-root page while `1rem` read 100px, and it tracked the
 *   setting at 16 / 20 / 24px.
 *
 * So: `rem` semantics with a root we can trust. At a 16px default font size the
 * output is arithmetically identical to the stock scale on every surface.
 */
const DESIGN_ROOT_PX = 16;

/** The unit everything is expressed against; also recognized by the guard below. */
const ROOT_UNIT = 'var(--ll-root, 1rem)';

/** Non-global so `.test()` stays stateless. */
const REM_LENGTH = /(-?\d*\.?\d+)rem\b/;

/**
 * `0.75rem` -> `calc(var(--ll-root, 1rem) * 12 / 16)` — "12px of a 16px root".
 * The same shape is used by hand in `content/style.css`, so both read alike.
 */
const toRootRelative = (value) =>
  value.replace(
    new RegExp(REM_LENGTH, 'g'),
    (_, n) => `calc(${ROOT_UNIT} * ${Number((Number(n) * DESIGN_ROOT_PX).toFixed(4))} / ${DESIGN_ROOT_PX})`,
  );

const convert = (value) => {
  if (typeof value === 'string') return toRootRelative(value);
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
  }
  return value;
};

/** A `rem` outside `var(--ll-root, 1rem)` is a leak: it would resolve to the page root. */
const stripRootUnit = (value) => value.split(ROOT_UNIT).join('');

const hasRawRem = (value) => {
  if (typeof value === 'string') return REM_LENGTH.test(stripRootUnit(value));
  if (Array.isArray(value)) return value.some(hasRawRem);
  if (value && typeof value === 'object') return Object.values(value).some(hasRawRem);
  return false;
};

/*
 * Theme customisations belong HERE, not on the exported config: they are merged
 * with Tailwind's defaults and then converted in one pass. Adding them to the
 * exported `theme`/`extend` instead would merge them AFTER conversion and leak
 * a bare rem — which `assertNoBareRem` would then reject.
 */
const themeOverrides = {
  extend: {},
};

const resolvedTheme = resolveConfig({ content: [], theme: themeOverrides }).theme;

/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/**/*.{html,tsx,ts,jsx,js}'],
  theme: convert(resolvedTheme),
  plugins: [],
};

/**
 * Guard the conversion invariant: every theme length must travel through
 * `convert()`, so nothing can resolve against the host page root.
 *
 * "Bare" is the operative word — this does not mean "no rem at all". Each of the
 * ~687 rem values in the theme is the fallback inside `var(--ll-root, 1rem)`,
 * which `stripRootUnit` removes before testing; that token is the whole
 * mechanism letting one config serve both root situations (see the file header),
 * so it must stay.
 *
 * Scope, verified: values arriving BEFORE conversion (Tailwind's own defaults,
 * and anything added to `themeOverrides`) are rewritten automatically and pass —
 * including a hypothetical new rem-authored scale from a Tailwind upgrade. The
 * only way a bare rem reaches the content script is by being merged AFTER
 * conversion, e.g. `theme: { ...convert(resolvedTheme), spacing: { 18: '4.5rem' } }`.
 * That is what this catches.
 */
function assertNoBareRem(cfg) {
  const theme = resolveConfig(cfg).theme;
  const leaked = Object.keys(theme).filter((key) => hasRawRem(theme[key]));
  if (leaked.length > 0) {
    throw new Error(
      `[tailwind.config] bare rem leaked into theme scale(s): ${leaked.join(', ')}.\n` +
      'It was merged after convert() ran, so it resolves against the host page root ' +
      `and breaks the content-script UI. Move it into \`themeOverrides\` in ` +
      'tailwind.config.js (it is converted there), or express it as ' +
      `\`calc(${ROOT_UNIT} * <px at a 16px root> / 16)\`.`,
    );
  }
}

assertNoBareRem(config);

export default config;
