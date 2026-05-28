# Changelog

All notable changes to this project are documented in this file.

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

[0.2.0]: https://github.com/q-jade/lingualens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/q-jade/lingualens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/q-jade/lingualens/releases/tag/v0.1.0
