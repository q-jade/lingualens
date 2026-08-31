import { handleMessage, getSettings, saveSettings } from '../background/message-router';
import { registerInstallOnboarding } from '../background/onboarding';
import {
  isPageTranslateStarted,
  type PageTranslatePhase,
} from '../shared/page-translate-phase';
import { isTranslatableTabUrl } from '../shared/translatable-tab';
import type { SelectionTriggerMode } from '../shared/types';

export default defineBackground(() => {
  registerInstallOnboarding();
  const pageTranslatePhaseByTab = new Map<number, PageTranslatePhase>();

  /**
   * Selection routed to the side panel before it finished loading (e.g. from the
   * PDF viewer, where no content script can run). Pulled via SIDEPANEL_READY.
   */
  let pendingSidepanelSelection: string | null = null;

  /**
   * True once a mounted side panel consumed the pending selection (via
   * SIDEPANEL_READY or a direct delivery ack). Lets routeSelectionToSidePanel
   * know whether re-stashing is needed or would ghost stale text.
   */
  let sidepanelConsumed = false;

  /**
   * Whether the content script is reachable in a tab. Kept warm by
   * getPageTranslatePhase (runs on tab switch / load / menu refresh), so the
   * context-menu click handler can decide synchronously whether to open the
   * side panel while the user gesture is still valid.
   */
  const contentScriptReachable = new Map<number, boolean>();

  /**
   * Browser-internal schemes never host our content script, so they are
   * synchronously identifiable as unreachable in the click handler — even on
   * cold start when the reachability cache has no entry for the tab yet.
   * (chrome-extension: is deliberately excluded: Chrome 141+ DOES inject
   * content scripts into its PDF viewer, which lives under that scheme.)
   */
  const INTERNAL_UNREACHABLE_SCHEMES = new Set([
    'chrome', 'edge', 'about', 'devtools', 'view-source',
  ]);

  /**
   * Cached focused window id. Needed to open the side panel synchronously in
   * the click handler when the tab itself reports id/windowId = -1 (Edge's
   * built-in PDF viewer is a browser-UI surface without a real tab object).
   */
  let lastFocusedWindowId: number | null = null;

  /**
   * `sidePanel.open()` may only run inside a user gesture, so this must be called
   * synchronously from the click handler (before any await hops) when possible.
   */
  function tryOpenSidePanel(windowId: number): Promise<void> {
    type ChromeSidePanel = {
      sidePanel?: { open: (opts: { windowId: number }) => Promise<void> };
    };
    const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeSidePanel }).chrome;
    if (!chromeApi?.sidePanel?.open) return Promise.resolve();
    return chromeApi.sidePanel.open({ windowId }).catch((err) => {
      console.warn('[LinguaLens] side panel open failed', err);
    });
  }

  /**
   * Context menu items persist across service-worker restarts (and WXT dev-mode
   * HMR reloads), so `create` with an existing id rejects with "duplicate id".
   * Remove all first to keep creation idempotent; menu updates below await this
   * promise so they never race the remove/create cycle.
   */
  const contextMenusReady = (async () => {
    await browser.contextMenus.removeAll();
    await Promise.all([
      browser.contextMenus.create({
        id: 'translate-selection',
        title: browser.i18n.getMessage('contextMenuTranslateSelection', ['%s']) || 'Translate "%s"',
        contexts: ['selection'],
      }),
      browser.contextMenus.create({
        id: 'translate-page',
        title: browser.i18n.getMessage('contextMenuTranslatePage') || 'Translate This Page',
        contexts: ['page'],
      }),
    ]);
  })().catch((err) => {
    console.warn('[LinguaLens] Failed to create context menus', err);
  });

  function rememberPageTranslatePhase(tabId: number, phase: PageTranslatePhase): void {
    if (isPageTranslateStarted(phase)) pageTranslatePhaseByTab.set(tabId, phase);
    else pageTranslatePhaseByTab.delete(tabId);
  }

  function getPageContextMenuTitle(phase: PageTranslatePhase): string {
    const key = {
      idle: 'contextMenuTranslatePage',
      running: 'contextMenuStopPage',
      done: 'contextMenuRestorePage',
    } as const;
    return browser.i18n.getMessage(key[phase]) || 'Translate This Page';
  }

  async function applyPageContextMenu(tabId: number, phase: PageTranslatePhase): Promise<void> {
    try {
      await contextMenusReady;
      const tab = await browser.tabs.get(tabId);
      if (!isTranslatableTabUrl(tab.url)) {
        await browser.contextMenus.update('translate-page', { enabled: false });
        return;
      }
      await browser.contextMenus.update('translate-page', {
        title: getPageContextMenuTitle(phase),
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
      contentScriptReachable.set(tabId, true);
      rememberPageTranslatePhase(tabId, phase);
      return phase;
    } catch {
      contentScriptReachable.set(tabId, false);
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
  async function translateSelectionInTab(
    tabId: number,
    frameId?: number,
    fallbackSelectionText?: string,
    windowId?: number,
  ): Promise<void> {
    // Single probe: pages without a reachable content script (PDF viewer,
    // chrome:// …) never answer, so route to the side panel right away.
    const reachable = await browser.tabs
      .sendMessage(tabId, { type: 'PING' })
      .then(() => true)
      .catch(() => false);
    contentScriptReachable.set(tabId, reachable);

    if (!reachable) {
      const fallback = fallbackSelectionText?.trim() ?? '';
      if (fallback) {
        await routeSelectionToSidePanel(fallback, windowId);
      } else {
        warnTabTranslateUnreachable(new Error('content script unreachable'));
      }
      return;
    }

    // Any stashed side-panel text is stale once the selection is handled in-page.
    pendingSidepanelSelection = null;
    sidepanelConsumed = true;

    if (await shouldBlockSelectionTranslate(tabId, frameId)) return;

    const text = (await readSelectedTextFromTab(tabId, frameId)).trim();
    if (text.length > 1) {
      await browser.tabs
        .sendMessage(tabId, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text } })
        .catch(warnTabTranslateUnreachable);
      return;
    }

    // Live selection not readable via executeScript (PDF viewer, embedded
    // frames, shadow-DOM viewers) — the menu click already carries the text.
    const fallback = fallbackSelectionText?.trim() ?? '';
    if (fallback) {
      await browser.tabs
        .sendMessage(tabId, { type: 'TRANSLATE_SELECTION_TEXT', payload: { text: fallback } })
        .catch(warnTabTranslateUnreachable);
      return;
    }

    await browser.tabs
      .sendMessage(tabId, { type: 'TRANSLATE_SELECTION' })
      .catch(warnTabTranslateUnreachable);
  }

  /** Deliver a selection to the side panel (pages where no content script runs). */
  async function routeSelectionToSidePanel(text: string, windowId?: number): Promise<void> {
    // The click fast path normally stashed this text already. Only stash here
    // when nothing is pending AND no mounted panel has consumed a previous
    // selection (cold-start path). Re-stashing after the panel pulled the text
    // would ghost stale text into the next mount / duplicate the delivery.
    if (pendingSidepanelSelection === null && !sidepanelConsumed) {
      pendingSidepanelSelection = text;
    }

    // Best effort: the click handler normally already opened the panel
    // synchronously (gesture still valid); this re-call only covers paths
    // where the gesture may have expired (keyboard shortcut).
    if (typeof windowId === 'number') {
      await tryOpenSidePanel(windowId);
    }

    // A freshly mounted panel already pulled the pending text via SIDEPANEL_READY.
    if (pendingSidepanelSelection !== text) return;

    // Panel already open — deliver directly; clear pending only when a live panel acked.
    const res = await browser.runtime
      .sendMessage({ type: 'TRANSLATE_SELECTION_VIA_SIDEPANEL', payload: { text } })
      .catch(() => null);
    if (res && typeof res === 'object' && (res as { success?: boolean }).success) {
      pendingSidepanelSelection = null;
      sidepanelConsumed = true;
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
    if (message.type === 'SIDEPANEL_READY') {
      sendResponse({ success: true, data: pendingSidepanelSelection });
      pendingSidepanelSelection = null;
      sidepanelConsumed = true;
      return false;
    }

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
            return { success: false, error: 'PAGE_TRANSLATE_UNAVAILABLE' };
          }
          return getPageTranslatePhase(payload.tabId).then((phase) => {
            if (phase !== 'idle') return { success: false, error: 'PAGE_TRANSLATE_ALREADY_ACTIVE' };
            return browser.tabs
              .sendMessage(payload.tabId, { type: 'PAGE_TRANSLATE_START' })
              .then(() => ({ success: true }));
          });
        })
        .then(sendResponse)
        .catch(() => sendResponse({ success: false, error: 'PAGE_TRANSLATE_UNAVAILABLE' }));
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
      case 'cycle-selection-mode': {
        const MODES: SelectionTriggerMode[] = ['icon', 'instant', 'modifier', 'off'];
        const settings = await getSettings();
        const idx = MODES.indexOf(settings.selectionTriggerMode ?? 'icon');
        const nextMode = MODES[(idx + 1) % MODES.length];
        await saveSettings({ selectionTriggerMode: nextMode });
        browser.tabs
          .sendMessage(tab.id, {
            type: 'SELECTION_MODE_CHANGED',
            payload: { mode: nextMode, modifierKey: settings.selectionModifierKey },
          })
          .catch(() => {});
        break;
      }
    }
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
      contentScriptReachable.delete(tabId);
    }
    // Session restore after cold start often skips `loading`; `complete` carries the final URL.
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
      updatePageContextMenuIfFocusedTab(tabId).catch(() => {});
    }
  });

  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    lastFocusedWindowId = windowId;
    browser.tabs.query({ active: true, windowId }).then(([tab]) => {
      if (tab?.id) updatePageContextMenu(tab.id).catch(() => {});
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    pageTranslatePhaseByTab.delete(tabId);
    contentScriptReachable.delete(tabId);
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    // Edge's PDF viewer (and other browser-UI surfaces) reports tab.id = -1 and
    // windowId = -1; normalize and fall back to the cached focused window.
    const tabId =
      tab && typeof tab.id === 'number' && tab.id >= 0 ? tab.id : undefined;
    const windowId =
      tab && typeof tab.windowId === 'number' && tab.windowId >= 0
        ? tab.windowId
        : lastFocusedWindowId ?? undefined;

    const menuId = String(info.menuItemId);

    if (menuId === 'translate-selection') {
      const frameId =
        typeof info.frameId === 'number' && info.frameId >= 0 ? info.frameId : undefined;
      const selected = info.selectionText?.trim() ?? '';
      // Fast path: open the side panel NOW, synchronously, while the click
      // gesture is live. Known-unreachable via the cached map, no tab id at
      // all (Edge PDF viewer), or a browser-internal URL scheme (covers cold
      // start when the cache has no entry yet) — none can show a bubble.
      const reachableCache =
        tabId === undefined ? undefined : contentScriptReachable.get(tabId);
      const urlScheme = tab?.url ? tab.url.split(':')[0].toLowerCase() : '';
      const knownUnreachable =
        tabId === undefined ||
        reachableCache === false ||
        (reachableCache === undefined && INTERNAL_UNREACHABLE_SCHEMES.has(urlScheme));
      if (selected && knownUnreachable && typeof windowId === 'number') {
        pendingSidepanelSelection = selected;
        sidepanelConsumed = false;
        void tryOpenSidePanel(windowId);
      }
      if (tabId === undefined) {
        // No reachable tab to message — deliver straight to the side panel.
        if (selected) await routeSelectionToSidePanel(selected, windowId);
        return;
      }
      await translateSelectionInTab(tabId, frameId, selected, windowId);
      return;
    }

    if (menuId === 'translate-page') {
      if (tabId === undefined) return;
      const phase = await getPageTranslatePhase(tabId);
      switch (phase) {
        case 'running':
          await stopPageInTab(tabId);
          break;
        case 'done':
          await restorePageInTab(tabId);
          break;
        default:
          await translatePageInTab(tabId, tab?.url);
      }
    }
  });

  // onStartup may run before session restore; tab events below sync menu once URLs are known.
  browser.runtime.onStartup.addListener(() => {
    syncPageContextMenuForFocusedTab().catch(() => {});
  });

  syncPageContextMenuForFocusedTab().catch(() => {});

  browser.windows.getLastFocused().then((win) => {
    if (typeof win?.id === 'number') lastFocusedWindowId = win.id;
  }).catch(() => {});

  console.log('[LinguaLens] background service worker started');
});
