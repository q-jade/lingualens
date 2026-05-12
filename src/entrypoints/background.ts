import { handleMessage } from '../background/message-router';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
    return handleMessage(message);
  });

  browser.commands.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    switch (command) {
      case 'translate-selection':
        browser.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' });
        break;
      case 'translate-page':
        browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' });
        break;
    }
  });

  browser.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate "%s"',
    contexts: ['selection'],
  });

  browser.contextMenus.create({
    id: 'translate-page',
    title: 'Translate This Page',
    contexts: ['page'],
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'translate-selection' && info.selectionText) {
      browser.tabs.sendMessage(tab.id, {
        type: 'TRANSLATE_SELECTION_TEXT',
        payload: { text: info.selectionText },
      });
    } else if (info.menuItemId === 'translate-page') {
      browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' });
    }
  });

  console.log('[Smart Translator] background service worker started');
});
