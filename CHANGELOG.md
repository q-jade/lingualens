# Changelog

All notable changes to this project are documented in this file.

## [0.8.0] - 2026-09-09

### Added

- Configurable additional prompt for selection, popup, and side-panel translations: a dictionary-style single-word template is appended to the system prompt (page translation is unaffected); clearing it disables the feature. Base and additional prompts are editable in Settings with reset buttons, and cache keys include the effective prompt so edits invalidate stale entries.
- Target language picker in the floating selection panel header: switching the language re-translates immediately.

### Changed

- Lighter, airier UI across all surfaces: selection-panel header with a brand hairline, compact footer, softer shadows and calmer hover states, 400-step brand tokens, and a desaturated squared app icon.

### Fixed

- Selections made on the extension's own pages (options, side panel) now route to the side panel instead of doing nothing.
- Floating mode/provider/language menus in the selection panel are clamped to the viewport and scroll when tall; the panel is wider and longer language names fit.
- Side panel no longer shows double scrollbars at Chrome's default width: the language bar shrinks instead of overflowing.

## [0.7.0] - 2026-09-01

### Added

- Selection translation on pages where content scripts cannot run: right-click **Translate** on `chrome://`/`edge://` pages, extension store pages, and PDF documents routes the selection to the side panel, which opens automatically and translates it with the page-translation language settings (Chromium 114+).
- PDF viewer support: Chrome 141+ translates PDF selections in-page via the floating panel; Edge's built-in PDF viewer falls back to the side panel.

## [0.6.0] - 2026-08-25

### Added

- Shared design system with brand tokens and reusable input, select, button, badge, and spinner classes, used across popup, sidepanel, options, and the page overlay.
- Options page: sidebar navigation with scroll-spy, sticky save bar with unsaved-changes guard and `Ctrl/Cmd+S` shortcut.
- Brand icons for OpenAI, Ollama, LM Studio, DeepL, and Google Translate in provider pickers, menus, and options cards.
- "No provider configured" banners in popup and sidepanel linking to Settings.
- Auto-focused translation inputs in popup and sidepanel, and a page-translation completion toast.
- `prefers-reduced-motion` support.

### Changed

- Popup, sidepanel, and options restyled: brand accent bars, custom-styled selects, primary gradient buttons, and unified spinners and keyboard-shortcut labels.
- Selection trigger and collapsed status-bar icons share layered depth and an indigo hover glow.
- Provider pickers rebuilt with brand icons, full keyboard navigation, and ARIA menu roles (selection-panel provider and mode menus included).
- Unified copy button (icon + label, or icon-only in the selection panel) with green check feedback.
- Semantic state colors (error/warn/success) consolidated into design tokens.

### Fixed

- Context menus are created idempotently, avoiding duplicate-ID errors after the background service worker restarts.

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

[0.8.0]: https://github.com/q-jade/lingualens/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/q-jade/lingualens/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/q-jade/lingualens/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/q-jade/lingualens/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/q-jade/lingualens/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/q-jade/lingualens/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/q-jade/lingualens/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/q-jade/lingualens/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/q-jade/lingualens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/q-jade/lingualens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/q-jade/lingualens/releases/tag/v0.1.0
