Translate the web with the providers you choose

LinguaLens is a browser translation extension built for flexibility. Unlike tools tied to a single cloud vendor, LinguaLens lets you decide where every translation runs: on your own computer with local LLMs, through major cloud APIs, via any OpenAI-compatible gateway, or through a customizable HTTP API template. Set a default provider, add an optional fallback chain, and translation continues even when your primary service is unavailable.

WHY LINGUALENS

• Bring your own backend — No lock-in to one translation service.
• Local-first option — Use Ollama or LM Studio so sensitive text can stay on your machine.
• Cloud when you need it — OpenAI, DeepSeek, DeepL, Google Cloud Translation, and more.
• OpenAI-compatible endpoints — Works with any gateway or proxy that exposes /v1/chat/completions.
• Custom HTTP API — Configure method, headers, JSON body template, and response path for proprietary stacks.
• Resilient workflow — Ordered fallback providers if the default fails mid-session.
• Honest privacy model — LinguaLens runs no translation servers; you choose who receives your text.
• Multi-language interface — 9 UI languages: English, 中文 (简/繁), 日本語, 한국어, Français, Deutsch, Español, Русский.

TRANSLATION PROVIDERS

Local
• Ollama (default preset) — http://localhost:11434
• LM Studio — Uses LM Studio's native local API

Cloud Presets
• OpenAI — api.openai.com
• DeepSeek — api.deepseek.com
• DeepL — Free or Pro API endpoint
• Google Cloud Translation — translation.googleapis.com

Advanced
• OpenAI Compatible — Any user-supplied base URL exposing /v1/chat/completions
• Custom API — Fully configurable HTTP request template

Verify each provider's connectivity from Settings before saving. API keys (when required) are stored locally in your browser storage.

FEATURES

Selection Translation
Select text on any normal web page. Choose from four trigger modes: a floating icon near your selection (default), instant translation on select, hold a modifier key to trigger, or turn the trigger off. Open the panel to view results, retry on failure, copy the translation, or dismiss it. Pin the panel to keep it open across multiple selections. Also available via right-click context menu, or press Alt+T to translate the current selection in one step. Switch the active translation provider anytime from the panel header.

Full-Page Bilingual Translation
Convert articles, docs, and long pages into inline bilingual or replacement reading without leaving the site. Toggle between modes anytime from the status bar. Start from the popup ("Translate This Page"), the page context menu, or Alt+Shift+T. A status bar shows progress and lets you stop translation, restore the original text, or switch display mode.

Page Translation Modes
• Quality — Larger chunks, better context for LLM translation
• Speed — Smaller chunks, faster progressive updates

Popup Translator
Click the toolbar icon to paste or type text, pick a target language, and translate instantly. Jump to Settings or start full-page translation on the active tab.

Side Panel (Chrome 114+)
Open a dedicated translation workspace from the popup. Set source and target languages, swap them, view results, and browse recent translations stored locally on your device.

Settings & Onboarding
On first install, Settings opens automatically with a short setup guide. Configure languages, default provider, fallback order, LLM prompt template, and per-provider options such as disabling "thinking" output on supported models for faster, cleaner translations.

Performance
Built-in translation cache reduces repeat API calls for identical text during browsing.

KEYBOARD SHORTCUTS

Alt+T — Translate selection
Alt+Shift+T — Translate entire page
Alt+M — Cycle selection trigger mode (icon → instant → modifier → off)

If shortcuts conflict with other extensions, reassign LinguaLens shortcuts in chrome://extensions/shortcuts.

GETTING STARTED

1. Install LinguaLens. Settings opens on first run.
2. Scroll to Translation Providers. Enable at least one backend.
3. Set base URL, model, and API key if needed. Click Verify, then Save Settings.
4. Open any normal https page and try selection or full-page translation.

Ollama tip: run `ollama pull llama3` and start Ollama with OLLAMA_ORIGINS="chrome-extension://*" if the browser cannot connect.

PRIVACY

LinguaLens does not operate its own translation servers. Text you translate is sent only to providers you enable. Settings and API keys remain on your device. See the privacy policy URL on this listing. Review third-party policies for any cloud API you use.

LIMITATIONS

• Does not run on restricted pages (chrome://, Chrome Web Store, etc.)
• Requires at least one configured, working provider to translate
• Side panel requires Chromium 114+
• Very large pages may take time and multiple API calls

SUPPORT

Issues & feedback: https://github.com/q-jade/lingualens/issues
Project home: https://github.com/q-jade/lingualens

Read foreign news, technical documentation, research, and forums with the translation workflow you control.
