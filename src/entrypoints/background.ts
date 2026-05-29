import { handleMessage } from '../background/message-router';
import { registerInstallOnboarding } from '../background/onboarding';
import {
  isPageTranslateStarted,
  PAGE_TRANSLATE_CONTEXT_MENU_TITLE,
  type PageTranslatePhase,
} from '../shared/page-translate-phase';
import { isTranslatableTabUrl, PAGE_TRANSLATE_UNAVAILABLE } from '../shared/translatable-tab';

export default defineBackground(() => {
  registerInstallOnboarding();
  const pageTranslatePhaseByTab = new Map<number, PageTranslatePhase>();

  function rememberPageTranslatePhase(tabId: number, phase: PageTranslatePhase): void {
    if (isPageTranslateStarted(phase)) pageTranslatePhaseByTab.set(tabId, phase);
    else pageTranslatePhaseByTab.delete(tabId);
  }

  async function applyPageContextMenu(tabId: number, phase: PageTranslatePhase): Promise<void> {
    try {
      const tab = await browser.tabs.get(tabId);
      if (!isTranslatableTabUrl(tab.url)) {
        await browser.contextMenus.update('translate-page', { enabled: false });
        return;
      }
      await browser.contextMenus.update('translate-page', {
        title: PAGE_TRANSLATE_CONTEXT_MENU_TITLE[phase],
        enabled: true,
      });
    } catch {
      // Menu may not exist yet (e.g. first SW tick) or update unsupported
    }
  }

  async function getPageTranslatePhase(tabId: number): Promise<PageTranslatePhase> {
    try {
      const response = await browser.tabs.sendMessage(tabId, { type: 'PAGE_TRANSLATE_STATUS' });
      const phase = (response as { phase?: PageTranslatePhase })?.phase ?? 'idle';
      rememberPageTranslatePhase(tabId, phase);
      return phase;
    } catch {
      return pageTranslatePhaseByTab.get(tabId) ?? 'idle';
    }
  }

  /** Query content script and refresh menu (tab switch, startup, etc.). */
  async function updatePageContextMenu(tabId?: number): Promise<void> {
    if (!tabId) return;
    const phase = await getPageTranslatePhase(tabId);
    await applyPageContextMenu(tabId, phase);
  }

  async function getFocusedActiveTabId(): Promise<number | undefined> {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id;
  }

  /** Menu is global; only repaint when the user is viewing this tab. */
  async function applyPageContextMenuIfFocusedTab(
    tabId: number,
    phase: PageTranslatePhase,
  ): Promise<void> {
    if ((await getFocusedActiveTabId()) !== tabId) return;
    await applyPageContextMenu(tabId, phase);
  }

  /** Query content script, but only if this tab is focused (tab switch / navigation). */
  async function updatePageContextMenuIfFocusedTab(tabId: number): Promise<void> {
    if ((await getFocusedActiveTabId()) !== tabId) return;
    await updatePageContextMenu(tabId);
  }

  async function syncPageContextMenuForFocusedTab(): Promise<void> {
    const tabId = await getFocusedActiveTabId();
    if (tabId) await updatePageContextMenu(tabId);
  }

  /** Read the live selection via `getSelection()` (keeps paragraph breaks; used by all selection translate entry points). */
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

  const TAB_TRANSLATE_UNREACHABLE =
    '[LinguaLens] Could not run on this tab. Reload a normal website (https/http) after install or update — not chrome:// or the Web Store. If a keyboard shortcut does nothing, bind it at chrome://extensions/shortcuts.';

  function warnTabTranslateUnreachable(err: unknown): void {
    console.warn(TAB_TRANSLATE_UNREACHABLE, err);
  }

  /** Shared by keyboard shortcut and context menu (MV3: await keeps the SW alive until send completes). */
  async function translateSelectionInTab(tabId: number, frameId?: number): Promise<void> {
    if (await shouldBlockSelectionTranslate(tabId, frameId)) return;

    const text = (await readSelectedTextFromTab(tabId, frameId)).trim();
    if (text.length > 1) {
      await browser.tabs
        .sendMessage(tabId, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text } })
        .catch(warnTabTranslateUnreachable);
    } else {
      await browser.tabs
        .sendMessage(tabId, { type: 'TRANSLATE_SELECTION' })
        .catch(warnTabTranslateUnreachable);
    }
  }

  /** Shared by keyboard shortcut and context menu. */
  async function translatePageInTab(tabId: number, tabUrl?: string): Promise<void> {
    let url = tabUrl;
    if (url === undefined) {
      try {
        url = (await browser.tabs.get(tabId)).url;
      } catch {
        return;
      }
    }
    if (!isTranslatableTabUrl(url)) return;
    if ((await getPageTranslatePhase(tabId)) !== 'idle') return;

    await browser.tabs
      .sendMessage(tabId, { type: 'PAGE_TRANSLATE_START' })
      .catch(warnTabTranslateUnreachable);
  }

  async function stopPageInTab(tabId: number): Promise<void> {
    await browser.tabs
      .sendMessage(tabId, { type: 'PAGE_TRANSLATE_STOP' })
      .catch(warnTabTranslateUnreachable);
  }

  async function restorePageInTab(tabId: number): Promise<void> {
    await browser.tabs
      .sendMessage(tabId, { type: 'PAGE_TRANSLATE_RESTORE' })
      .catch(warnTabTranslateUnreachable);
  }

  browser.runtime.onMessage.addListener((message: Record<string, unknown>, sender, sendResponse) => {
    if (message.type === 'PAGE_TRANSLATE_STATE_CHANGED') {
      const tabId = sender.tab?.id;
      const phase = (message.payload as { phase?: PageTranslatePhase })?.phase ?? 'idle';
      if (tabId) {
        rememberPageTranslatePhase(tabId, phase);
        applyPageContextMenuIfFocusedTab(tabId, phase).catch(() => {});
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
          return getPageTranslatePhase(payload.tabId).then((phase) => {
            if (phase !== 'idle') return { success: false, error: 'Page translation is already active.' };
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
      case 'translate-selection':
        await translateSelectionInTab(tab.id);
        break;
      case 'translate-page':
        await translatePageInTab(tab.id, tab.url);
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

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.active && tab.id) updatePageContextMenuIfFocusedTab(tab.id).catch(() => {});
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      pageTranslatePhaseByTab.delete(tabId);
    }
    // Session restore after cold start often skips `loading`; `complete` carries the final URL.
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
      updatePageContextMenuIfFocusedTab(tabId).catch(() => {});
    }
  });

  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    browser.tabs.query({ active: true, windowId }).then(([tab]) => {
      if (tab?.id) updatePageContextMenu(tab.id).catch(() => {});
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    pageTranslatePhaseByTab.delete(tabId);
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    const menuId = String(info.menuItemId);

    if (menuId === 'translate-selection') {
      const frameId = typeof info.frameId === 'number' ? info.frameId : undefined;
      await translateSelectionInTab(tab.id, frameId);
    } else if (menuId === 'translate-page') {
      const phase = await getPageTranslatePhase(tab.id);
      switch (phase) {
        case 'running':
          await stopPageInTab(tab.id);
          break;
        case 'done':
          await restorePageInTab(tab.id);
          break;
        default:
          await translatePageInTab(tab.id, tab.url);
      }
    }
  });

  // onStartup may run before session restore; tab events below sync menu once URLs are known.
  browser.runtime.onStartup.addListener(() => {
    syncPageContextMenuForFocusedTab().catch(() => {});
  });

  syncPageContextMenuForFocusedTab().catch(() => {});

  console.log('[LinguaLens] background service worker started');
});
