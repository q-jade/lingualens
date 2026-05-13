import { handleMessage } from '../background/message-router';

export default defineBackground(() => {
  const pageTranslatedTabs = new Set<number>();

  async function isPageTranslationActive(tabId?: number): Promise<boolean> {
    if (!tabId) return false;
    if (pageTranslatedTabs.has(tabId)) return true;
    try {
      const response = await browser.tabs.sendMessage(tabId, { type: 'PAGE_TRANSLATE_STATUS' });
      return Boolean((response as { active?: boolean })?.active);
    } catch {
      return false;
    }
  }

  async function updatePageContextMenu(tabId?: number): Promise<void> {
    const active = await isPageTranslationActive(tabId);
    await browser.contextMenus.update('translate-page', { enabled: !active });
  }

  browser.runtime.onMessage.addListener((message: Record<string, unknown>, sender, sendResponse) => {
    if (message.type === 'PAGE_TRANSLATE_STATE_CHANGED') {
      const tabId = sender.tab?.id;
      const payload = message.payload as { active?: boolean };
      if (tabId) {
        if (payload.active) {
          pageTranslatedTabs.add(tabId);
        } else {
          pageTranslatedTabs.delete(tabId);
        }
        updatePageContextMenu(tabId).catch(() => {});
      }
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'PAGE_TRANSLATE_PAGE') {
      const payload = message.payload as { tabId: number };
      isPageTranslationActive(payload.tabId)
        .then((active) => {
          if (active) return { success: false, error: 'Page translation is already active.' };
          return browser.tabs.sendMessage(payload.tabId, { type: 'PAGE_TRANSLATE_START' })
            .then(() => ({ success: true }));
        })
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to reach page' }));
      return true;
    }

    handleMessage(message).then(sendResponse);
    return true;
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

  browser.tabs.onActivated.addListener(({ tabId }) => {
    updatePageContextMenu(tabId).catch(() => {});
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      pageTranslatedTabs.delete(tabId);
      updatePageContextMenu(tabId).catch(() => {});
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    pageTranslatedTabs.delete(tabId);
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'translate-selection' && info.selectionText) {
      browser.tabs.sendMessage(tab.id, {
        type: 'TRANSLATE_SELECTION_TEXT',
        payload: { text: info.selectionText },
      });
    } else if (info.menuItemId === 'translate-page' && !(await isPageTranslationActive(tab.id))) {
      browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' });
    }
  });

  console.log('[LinguaLens] background service worker started');
});
