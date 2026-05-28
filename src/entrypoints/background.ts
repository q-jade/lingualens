import { handleMessage } from '../background/message-router';
import { registerInstallOnboarding } from '../background/onboarding';
import { isTranslatableTabUrl, PAGE_TRANSLATE_UNAVAILABLE } from '../shared/translatable-tab';

export default defineBackground(() => {
  registerInstallOnboarding();
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
    if (!tabId) return;
    try {
      const tab = await browser.tabs.get(tabId);
      if (!isTranslatableTabUrl(tab.url)) {
        await browser.contextMenus.update('translate-page', { enabled: false });
        return;
      }
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

  async function isSelectionInExtensionUIFromTab(tabId: number, frameId?: number): Promise<boolean> {
    const scripting = browser.scripting;
    if (!scripting?.executeScript) return false;
    try {
      const target =
        typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId };
      const results = await scripting.executeScript({
        target,
        func: () => {
          const shadow = document.querySelector('lingua-lens')?.shadowRoot;
          if (!shadow) return false;
          if (typeof shadow.getSelection === 'function') {
            const sel = shadow.getSelection();
            return Boolean(sel?.rangeCount && !sel.isCollapsed);
          }
          const docSel = window.getSelection();
          if (!docSel?.rangeCount || docSel.isCollapsed) return false;
          const inShadow = (node: Node | null) => node !== null && shadow.contains(node);
          return inShadow(docSel.anchorNode) || inShadow(docSel.focusNode);
        },
      });
      return Boolean(results[0]?.result);
    } catch {
      return false;
    }
  }

  async function shouldBlockSelectionTranslate(
    tabId: number,
    frameId?: number,
  ): Promise<boolean> {
    try {
      const res = await browser.tabs.sendMessage(tabId, {
        type: 'SHOULD_BLOCK_SELECTION_TRANSLATE',
      });
      return Boolean((res as { block?: boolean })?.block);
    } catch {
      return isSelectionInExtensionUIFromTab(tabId, frameId);
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
      browser.tabs
        .get(payload.tabId)
        .then((tab) => {
          if (!isTranslatableTabUrl(tab.url)) {
            return { success: false, error: PAGE_TRANSLATE_UNAVAILABLE };
          }
          return isPageTranslationActive(payload.tabId).then((active) => {
            if (active) return { success: false, error: 'Page translation is already active.' };
            return browser.tabs
              .sendMessage(payload.tabId, { type: 'PAGE_TRANSLATE_START' })
              .then(() => ({ success: true }));
          });
        })
        .then(sendResponse)
        .catch(() => sendResponse({ success: false, error: PAGE_TRANSLATE_UNAVAILABLE }));
      return true;
    }

    handleMessage(message).then(sendResponse);
    return true;
  });

  browser.commands.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    switch (command) {
      case 'translate-selection': {
        if (await shouldBlockSelectionTranslate(tab.id)) break;
        let text = (await readSelectedTextFromTab(tab.id)).trim();
        if (text.length > 1) {
          await browser.tabs
            .sendMessage(tab.id, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text } })
            .catch((err) => {
              console.warn(
                '[LinguaLens] translate-selection: could not reach this tab (reload the page, use a normal https page, or set a shortcut in chrome://extensions/shortcuts).',
                err,
              );
            });
        } else {
          await browser.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' }).catch((err) => {
            console.warn(
              '[LinguaLens] translate-selection: could not reach this tab (reload the page, use a normal https page, or set a shortcut in chrome://extensions/shortcuts).',
              err,
            );
          });
        }
        break;
      }
      case 'translate-page':
        if (!isTranslatableTabUrl(tab.url)) break;
        await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' }).catch((err) => {
          console.warn(
            '[LinguaLens] translate-page: could not reach this tab (reload the page or use a normal https page).',
            err,
          );
        });
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
    }
    if (changeInfo.status === 'loading' || changeInfo.url) {
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
      if (
        await shouldBlockSelectionTranslate(
          tab.id,
          typeof info.frameId === 'number' ? info.frameId : undefined,
        )
      ) {
        return;
      }
      // MV3: await keeps the service worker alive until the message is sent; fire-and-forget can drop the message.
      await browser.tabs
        .sendMessage(tab.id, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text } })
        .catch(() => {});
    } else if (
      menuId === 'translate-page'
      && isTranslatableTabUrl(tab.url)
      && !(await isPageTranslationActive(tab.id))
    ) {
      await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_START' }).catch(() => {});
    }
  });

  // Service worker startup does not fire tabs.onActivated/onUpdated for the tab the user
  // is already on (e.g. extension reload on chrome://extensions). contextMenus.create
  // defaults to enabled, so sync the active tab once on boot.
  // query: active=true → focused tab in the window; currentWindow=true → that browser window.
  browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) updatePageContextMenu(tab.id).catch(() => {});
  });

  console.log('[LinguaLens] background service worker started');
});
