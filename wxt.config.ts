import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    version: '0.4.0',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
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
        description: '__MSG_commandTranslateSelection__',
      },
      'translate-page': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: '__MSG_commandTranslatePage__',
      },
    },
  },
});
