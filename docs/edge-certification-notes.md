This extension does not operate its own translation servers and therefore cannot provide a shared test account or API key. All translation requests go directly from the user's browser to the translation provider they configure.

Recommended testing method (no API key required, works entirely offline):

1. Install Ollama from https://ollama.com
2. Run `ollama pull gemma3:4b` (small multimodal model, ~3 GB — supports text and image input)
3. Start Ollama with: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`
4. Install LinguaLens — Settings opens automatically; enable the Ollama provider, set its model to `gemma3:4b`, click "Verify", then "Save Settings"
5. Open any https:// webpage and select text — click the floating LinguaLens icon to translate
6. Image translation: select an image (or right-click it) and click the trigger / "Translate Image" menu item — the panel shows the image with the text inside it translated
7. Right-click the page and choose "Translate This Page" for full-page bilingual translation

If Ollama is unavailable, the extension also supports OpenAI, DeepSeek, DeepL Free, any OpenAI-compatible endpoint, and a custom HTTP API template (API keys provided by the tester). Each provider has a "Verify" button in Settings. Without a verified provider, translation shows "No active provider".

The extension cannot function without a user-configured translation backend because it is a client-side routing tool, not a translation service itself.
