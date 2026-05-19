# LinguaLens

[![GitHub](https://img.shields.io/github/license/q-jade/lingualens)](LICENSE)

**Translate anything on the web** — with local LLMs (Ollama, LM Studio), cloud APIs (OpenAI, DeepSeek, DeepL, Google Translate), or your own HTTP endpoint.

LinguaLens is a browser extension built with [WXT](https://wxt.dev/) and React. It adds selection translation, full-page bilingual translation, a popup translator, and a Chrome side panel with history — all routed through a configurable provider chain with caching and automatic fallback.

## Features

- **Selection translation** — Select text on any page; a floating trigger appears. Right-click **Translate** or use the keyboard shortcut for one-step translation.
- **Full-page translation** — Inject bilingual translations inline while preserving layout. Choose **Quality** (larger chunks, better context) or **Speed** (smaller chunks, faster updates) in settings.
- **Multiple providers** — Ollama, LM Studio, OpenAI-compatible APIs, OpenAI, DeepSeek, DeepL, Google Cloud Translation, and a customizable HTTP template.
- **Provider fallback** — If the default provider fails, try the next configured provider in order.
- **Translation cache** — Repeated text is served from an in-memory cache with debounced persistence.
- **Popup & side panel** — Quick translate from the toolbar popup; open the side panel (Chrome 114+) for a larger UI with session history.
- **LLM tuning** — Custom system prompt template; optional **disable thinking** for models that emit chain-of-thought (faster, cleaner output).

## Browser support

| Browser | Status |
|---------|--------|
| **Chrome / Edge** (Chromium 114+) | Primary target. Side panel requires Chromium 114+. |
| **Firefox** | `npm run build:firefox` produces an MV2 build. Side panel is not available; other features should be tested separately. |

Content scripts do **not** run on restricted pages (for example `chrome://`, `edge://`, or the browser extension gallery).

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- For the default setup: [Ollama](https://ollama.com/) running locally with a model pulled (e.g. `ollama pull llama3`)

### Install from source

```bash
git clone https://github.com/q-jade/lingualens.git
cd lingualens
npm install
npm run dev
```

Load the unpacked extension:

1. Open `chrome://extensions` (or your browser’s equivalent).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `.output/chrome-mv3-dev` folder (created by `npm run dev`).

For a production build:

```bash
npm run build          # Chrome MV3 → .output/chrome-mv3
npm run zip            # Creates .output/lingualens-<version>-chrome.zip
npm run build:firefox  # Firefox MV2 → .output/firefox-mv2
```

### First-time configuration

1. Open the extension **Settings** (right-click the toolbar icon → Options, or **Settings** in the popup).
2. Under **Providers**, ensure at least one provider is **enabled** (Ollama and LM Studio are added by default).
3. Set **Base URL** and **Model** if needed, then click **Verify** on that provider.
4. Choose a **Default provider** and optional **Fallback** order if you use multiple backends.
5. Click **Save Settings**.

If translation fails with *“No active provider configured”*, enable a provider and save again.

## Usage

### Selection translation

1. Select text on a normal web page (not `chrome://` URLs).
2. Click the floating LinguaLens trigger, or right-click → **Translate "…"**.
3. **Shortcut (default):** `Alt+T` — translates the selection directly in the panel.

### Full-page translation

- **Popup:** **Translate This Page**
- **Shortcut (default):** `Alt+Shift+T`
- **Context menu:** **Translate This Page** on the page (disabled while translation is already active)

Use the on-page status bar to stop or restore the original text.

### Popup & side panel

- **Popup** — Enter text, pick target language, translate. Link to **Settings** and **Translate This Page**.
- **Side panel** — Click **Side panel** in the popup (Chrome 114+). Supports source/target languages, swap, and recent history (stored locally).

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+T` | Translate selection |
| `Alt+Shift+T` | Translate entire page |

If shortcuts do nothing, open your browser’s extension shortcut settings and assign LinguaLens to a free combination. Reload the tab after installing or updating the extension.

## Supported providers

| Provider | Type | API key | Notes |
|----------|------|---------|--------|
| Ollama | Local | No | Default. `http://localhost:11434` |
| LM Studio | Local | Optional | Native chat API; thinking disabled by default |
| OpenAI Compatible | Cloud / local | Usually | Any OpenAI-style `/v1/chat/completions` endpoint |
| OpenAI | Cloud | Yes | `https://api.openai.com/v1` |
| DeepSeek | Cloud | Yes | Preset uses `https://api.deepseek.com` |
| DeepL | Cloud | Yes | Free or Pro API base URL |
| Google Translate | Cloud | Yes | Google Cloud Translation API |
| Custom API | Any | Optional | Configurable method, headers, body template, JSON response path |

**Host permissions:** The extension manifest allows requests only to declared hosts (localhost, OpenAI, DeepSeek, DeepL, Google, etc.). Custom or self-hosted API URLs outside that list may be blocked by the browser until additional permissions are granted — plan endpoints accordingly.

## Settings reference

- **Language** — Default source (including auto-detect) and target language.
- **Default provider / Fallback providers** — Primary backend and ordered backups on failure.
- **Translation prompt template** — System prompt for LLM providers; placeholders `{sourceLang}`, `{targetLang}`.
- **Page translation** — **Quality** vs **Speed** chunking strategy.
- **Disable thinking** (LLM providers) — Reduces reasoning output for faster translation (on by default for Ollama/LM Studio).

API keys and settings are stored in **`browser.storage.local`** on your device only; they are not sent to LinguaLens servers (there are none).

## Development

```bash
npm run dev           # Chrome, watch mode
npm run dev:firefox   # Firefox, watch mode
npm run build         # Production Chrome build
npx tsc --noEmit      # Typecheck
```

Project layout:

```
src/
  entrypoints/     # background, content, popup, sidepanel, options
  providers/       # translation backends
  content/         # page translation engine
  background/      # messaging, cache
  shared/          # types, constants
```

Stack: WXT, React 19, TypeScript, Tailwind CSS.

## Privacy

LinguaLens sends text you choose to translate (selection, popup input, or page content) **only to the translation providers you configure**. It does not operate a backend service. Review the privacy policies of any third-party API you use (OpenAI, DeepL, Google, etc.).

## Known limitations

- Content scripts cannot run on browser internal pages or the extension store.
- Very large pages may take time and many API calls when using full-page translation.
- Firefox build uses Manifest V2; feature parity with Chrome is not guaranteed.
- Side panel requires Chromium 114+.

## License

[MIT](LICENSE) — Copyright (c) 2026 Qi Wang
