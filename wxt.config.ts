import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    version: '0.2.0',
    name: 'LinguaLens',
    description: 'LinguaLens — translate anything with LLM and online APIs',
    permissions: ['storage', 'activeTab', 'sidePanel', 'contextMenus', 'scripting'],
    host_permissions: [
      // Chrome Web Store rejects `http://localhost:*/*`; omit port to match all local ports.
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://api.deepseek.com/*',
      'https://api.openai.com/*',
      'https://api-free.deepl.com/*',
      'https://api.deepl.com/*',
      'https://translation.googleapis.com/*',
    ],
    commands: {
      'translate-selection': {
        suggested_key: { default: 'Alt+T' },
        description: 'Translate selected text',
      },
      'translate-page': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Translate entire page',
      },
    },
  },
});
