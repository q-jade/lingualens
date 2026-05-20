# LinguaLens Privacy Policy

**Last updated:** May 20, 2026

This policy describes how the **LinguaLens** browser extension (“the extension”, “we”) handles information when you use it. LinguaLens is published by Qi Wang. If you have questions, open an issue at [github.com/q-jade/lingualens](https://github.com/q-jade/lingualens).

## Summary

- LinguaLens **does not run its own translation servers**.
- Text you choose to translate is sent **only to the translation providers you configure** (for example Ollama on your machine, OpenAI, DeepL, or a custom API URL).
- Settings and API keys are stored **locally in your browser**, not on our servers.
- We **do not sell** your data.

## What data is involved

Depending on how you use the extension, the following may be processed:

| Data | Where it goes | Purpose |
|------|----------------|---------|
| Text you select, enter in the popup/side panel, or page content you choose to translate | The **provider(s) you enable** in Settings | Translation |
| Provider settings (base URL, model, API keys, prompts) | **Local browser storage** (`chrome.storage.local` / equivalent) | Configuration |
| Cached translation results | **Local browser storage** | Faster repeat translations |
| Recent translations in the side panel | **Local browser storage** | History in the side panel UI |

We do not operate a central account system or cloud database for your translations.

## Third-party services

When you enable a provider, your text and API credentials (if required) are sent to that third party under **their** terms and privacy policies. You are responsible for choosing providers you trust. Examples include OpenAI, DeepSeek, DeepL, Google Cloud Translation, or software you host yourself (Ollama, LM Studio, custom HTTP APIs).

LinguaLens only initiates requests you trigger through normal use (translate selection, translate page, popup, side panel, keyboard shortcuts, or context menu).

## Permissions and why they are used

- **Access to websites:** Content scripts run on web pages so the extension can offer selection translation and inline bilingual page translation. Site access is required for those features.
- **Storage:** Save your settings, API keys, cache, and optional translation history locally.
- **Other extension permissions** (such as context menus, side panel, scripting, active tab): Operate translation UI and shortcuts as described in the extension listing.

## Data retention and deletion

Data stored locally remains on your device until you clear extension storage, uninstall the extension, or remove data in the extension UI (for example clearing side panel history). Uninstalling the extension removes locally stored extension data associated with it.

## Children

LinguaLens is not directed at children under 13, and we do not knowingly collect personal information from children.

## Changes

We may update this policy as the extension changes. The “Last updated” date at the top will be revised when we do. Continued use after changes means you accept the updated policy.

## Contact

GitHub issues: [github.com/q-jade/lingualens/issues](https://github.com/q-jade/lingualens/issues)
