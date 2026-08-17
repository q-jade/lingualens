# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- Introduced a shared design system (`src/shared/theme.css`): unified brand/neutral/semantic color tokens, font stack, focus rings, and reusable `.input` / `.ll-select` / `.ll-btn-primary` / `.ll-badge` / `.ll-spinner` component classes now used across popup, sidepanel, options, and content stylesheets.
- Popup: added a brand accent bar, custom-styled language select with chevron, shared field styling for the textarea, primary button class, and replaced emoji selection-mode icons with SVG icons (indigo active states).
- Sidepanel: added a brand accent bar, custom-styled language selects, a spinner loading indicator, and a subtle container background for the translation result pane.
- Options: gradient brand title, custom-styled selects, explicit input widths, and unified save button styling.
- Content overlay: selection-mode menu now uses the shared SVG mode icons instead of emoji.

## [0.5.2] - 2026-07-31

### Fixed

- Page translate context menu item was always disabled (greyed out) in production builds due to missing `tabs` permission. The context menu now correctly enables on translatable pages.
- Handle quota exceeded errors when persisting cache and translation history, preventing silent data loss when storage is full.

## [0.5.1] - 2026-07-20

### Added

- Page translation status now shows "Preparing…" while scanning the page for translatable text, instead of misleading 0/0 progress.
- `ProviderPicker` dropdown listens to `window.blur` for more consistent dismiss behavior.

### Fixed

- Content UI font sizes are now independent of the host page's root `font-size`, preventing layout breakage on pages with non-standard scaling.
- Selection trigger mode dropdown no longer gets clipped by panel overflow.
- DOM walker: copy sub-segment array before mutating to avoid side effects on input.
- Cache: replaced weak 32-bit hash with FNV-1a 64-bit dual hash to eliminate collision risk.
- Selection translation panel drag callback stabilized to avoid jitter.

## [0.5.0] - 2026-07-03

### Added

- **Selection trigger modes**: choose how text selection starts translation on web pages — Trigger icon (default), Instant, Modifier key, or Off. Toggle quickly from the popup or cycle with `Alt+M`.
- **Trigger mode picker** accessible from the panel header — switch modes directly without opening the popup. Toast confirmation on change; no-op when selecting the already-active mode.
- **Pin button** on the selection translation panel: pin the floating panel so it stays open across selections. A floating trigger appears for new text and translates into the pinned panel without moving it.
- **Retry button** in the selection translation panel when translation fails.
- **Switch default provider** from any UI surface — popup, side panel, and the selection translation panel header all show a provider dropdown that immediately re-translates.
- Popup page-translate button now shows **Stop Page Translation** while running and **Restore Original Page** when finished (mirrors context menu behavior). Modifier key changes from the popup take effect immediately.

### Fixed

- Skip dropdown menus, tooltips, popovers, and screen-reader-only elements during page translation.
- Skip relative paths and filenames (e.g. `package.json`, `dom-walker.ts`) in the "don't translate" filter.
- Side panel history stores full text instead of truncating to 200 characters.
- Map raw error codes to friendly i18n messages in the selection translation overlay (e.g. "No active provider" instead of raw error codes).
- Show error feedback when all page-translate segments fail, instead of silently disappearing.
- Show platform-aware keyboard shortcut hints (`Ctrl` vs `⌘`) in popup and side panel.

### Improved

- Selection panel focus management: receives focus on open (Escape works immediately), restores previous focus on close.
- Side panel: history back button deduplicates repeated entries; added clear-input button and draggable split-pane divider.
- Side panel: added settings entry button and layout polish.
- Popup and side panel: show a brief checkmark animation after copying translation to clipboard.
- Options: Add Provider menu changed from hover to click for better usability.

## [0.4.0] - 2026-06-04

### Added

- Full internationalization (i18n) support with 9 UI languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Spanish, and Russian.
- UI language selector in Options page with auto-detection from browser locale on first use; user preference persists across sessions.
- Chrome native i18n (`_locales`) for manifest name/description and context menu titles (follows browser language).
- `react-i18next` integration for all React surfaces (popup, side panel, options, content overlay) with user-selectable language.
- Separate translator language preferences: popup/side panel remember their own source/target independent of selection & page translation settings.
- Auto-infer default target language from browser locale.

### Fixed

- Side panel language prefs now sync when popup updates storage.

## [0.3.0] - 2026-06-01

### Added

- Page translation phase state (`idle` / `running` / `done`): context menu and status bar share the same labels — **Translate This Page**, **Stop Page Translation**, and **Restore Original Page** — and update as the session progresses.

### Changed

- Page translate status bar: AppLogo on the bar and collapsed floater, minus minimize control, and a soft squircle chip instead of a white circle.
- Selection translate trigger stays anchored to the selection while the page scrolls or resizes.

### Fixed

- Background: unified selection and page translate entry points so context menu, shortcut, and floating trigger use the same selection text (improves cache reuse).
- Background: clearer warnings when translation is requested on unreachable tabs.

## [0.2.0] - 2026-05-28

### Added

- Selection translation panel: viewport-relative sizing (30% width, 50% max height), draggable header, and copy button in a footer bar.
- Selection translate trigger: placement near the mouse release point, outside the nearest selection corner, with viewport-aware fallback.

### Changed

- Popup and context menu: page translate is disabled on restricted tabs and extension store pages, with clear messaging instead of connection errors.
- Translatable-tab detection uses a protocol blocklist so `file://` and other injectable schemes remain allowed while store and browser-internal pages stay blocked.

### Fixed

- Background: sync context menu on startup and session restore; only update the menu for the focused tab.
- Content: block selection translate inside the open translation panel (shadow `getSelection()` guard).
- Content: skip re-translate on Alt+T when the panel already shows the same selected text.
- Manifest: use Chrome Web Store–valid localhost host permissions (`http://localhost/*`, `http://127.0.0.1/*`).
- TypeScript: declare `ShadowRoot.getSelection()` for closed-shadow selection handling in CI.

## [0.1.1] - 2026-05-20

### Added

- First-install onboarding: open Settings automatically and show a provider setup welcome banner.
- GitHub Actions CI: `npm ci`, TypeScript check, and production build on push/PR to `main`.
- Privacy policy (`docs/privacy.md`) for store listing and GitHub Pages.

## [0.1.0] - 2026-05-19

### Added

- Initial public release: selection and full-page translation, popup, side panel, and options.
- Providers: Ollama, LM Studio, OpenAI-compatible, OpenAI, DeepSeek, DeepL, Google Translate, custom HTTP API.
- Provider fallback chain, translation cache, LLM prompt template, and disable-thinking option for LLM backends.

[0.5.1]: https://github.com/q-jade/lingualens/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/q-jade/lingualens/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/q-jade/lingualens/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/q-jade/lingualens/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/q-jade/lingualens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/q-jade/lingualens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/q-jade/lingualens/releases/tag/v0.1.0
