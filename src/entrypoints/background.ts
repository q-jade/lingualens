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
    try {
      const active = await isPageTranslationActive(tabId);
      await browser.contextMenus.update('translate-page', { enabled: !active });
    } catch {
      // Menu may not exist yet (e.g. first SW tick) or update unsupported
    }
  }

  /** When `selectionText` is empty (some sites / frames), read the live selection in the page. */
  async function readSelectedTextFromTab(tabId: number, frameId?: number): Promise<string> {
    const scripting = browser.scripting;
    if (!scripting?.executeScript) return '';
    try {
      const target =
        typeof frameId === 'number'
          ? { tabId, frameIds: [frameId] }
          : { tabId };
      const results = await scripting.executeScript({
        target,
        func: () => window.getSelection()?.toString()?.trim() ?? '',
      });
      const r = results[0]?.result;
      return typeof r === 'string' ? r.trim() : '';
    } catch {
      return '';
    }
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
        await browser.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' }).catch(() => {});
        break;
      case 'translate-page':
        await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' }).catch(() => {});
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

    const menuId = String(info.menuItemId);

    if (menuId === 'translate-selection') {
      let text = (info.selectionText ?? '').trim();
      if (!text) {
        text = await readSelectedTextFromTab(
          tab.id,
          typeof info.frameId === 'number' ? info.frameId : undefined,
        );
      }
      if (!text) return;
      // MV3: await keeps the service worker alive until the message is sent; fire-and-forget can drop the message.
      await browser.tabs
        .sendMessage(tab.id, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text } })
        .catch(() => {});
    } else if (menuId === 'translate-page' && !(await isPageTranslationActive(tab.id))) {
      await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' }).catch(() => {});
    }
  });

  console.log('[LinguaLens] background service worker started');
});
