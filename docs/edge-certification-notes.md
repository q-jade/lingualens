This extension does not operate its own translation servers and therefore cannot provide a shared test account or API key. All translation requests go directly from the user's browser to the translation provider they configure. No LinguaLens infrastructure exists to host test credentials.

Recommended testing method (no API key required, works entirely offline):

1. Install Ollama from https://ollama.com
2. Run `ollama pull llama3.2` in a terminal to download a small local model (~2 GB)
3. Start Ollama with: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`
4. Install LinguaLens — the Settings page opens automatically
5. Scroll to "Translation Providers" and enable the Ollama provider (the default preset points to http://localhost:11434)
6. Click "Verify" next to Ollama — a green checkmark confirms the connection
7. Click "Save Settings" at the bottom
8. Open any https:// webpage (e.g., https://en.wikipedia.org)
9. Select some text — a floating LinguaLens icon appears near the selection — click it to translate
10. Alternatively, right-click on the page and choose "Translate This Page" for full-page bilingual translation

If Ollama is not available in the testing environment, the extension also supports:
- OpenAI (requires an API key — the tester must provide their own)
- DeepSeek (requires an API key)
- DeepL Free API (requires an API key; free tier signup at deepl.com)
- Any OpenAI-compatible endpoint with a custom base URL
- A fully customizable HTTP API template

Each provider has a "Verify" button in Settings that tests connectivity before saving. Without at least one verified provider, the extension will display "No active provider" when translation is attempted.

The extension cannot function without a user-configured translation backend because it is a client-side routing tool, not a translation service itself.
