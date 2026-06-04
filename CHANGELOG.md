# Changelog

All notable changes to this project are documented in this file.

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

[0.4.0]: https://github.com/q-jade/lingualens/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/q-jade/lingualens/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/q-jade/lingualens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/q-jade/lingualens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/q-jade/lingualens/releases/tag/v0.1.0
