import { handleMessage, getSettings, saveSettings } from '../background/message-router';
import { registerInstallOnboarding } from '../background/onboarding';
import {
  isPageTranslateStarted,
  type PageTranslatePhase,
} from '../shared/page-translate-phase';
import { isTranslatableTabUrl, isBrowserStoreUrl } from '../shared/translatable-tab';
import { setTranslatorLanguages } from '../shared/translator-languages';
import type { SelectionTriggerMode, RoutedSidepanelSelection } from '../shared/types';

export default defineBackground(() => {
  registerInstallOnboarding();
  const pageTranslatePhaseByTab = new Map<number, PageTranslatePhase>();

  /**
   * Selection routed to the side panel before it finished loading (e.g. from the
   * PDF viewer, where no content script can run). Pulled via SIDEPANEL_READY.
   */
  let pendingSidepanelSelection: RoutedSidepanelSelection | null = null;

  /**
   * Text of the last selection delivered to a mounting side panel via
   * SIDEPANEL_READY. Lets routeSelectionToSidePanel skip its own sync +
   * delivery when the freshly mounted panel already pulled the selection
   * (READY won the race and synced the language pair itself).
   */
  let readyDeliveredText: string | null = null;

  /**
   * Fresh presence report sent by the content script when the user opens the
   * context menu (contextmenu event / right-button mousedown). Read
   * synchronously in the click handler: a page WITHOUT a fresh report has no
   * content script (store pages, restricted https pages, PDF viewers without
   * injection), so the selection must go to the side panel.
   * Replaces contextMenus.onShown, which Chromium does NOT implement
   * (Firefox-only per MDN).
   * Only meaningful for TOP-frame clicks: the content UI runs with
   * allFrames=false, so a right-click inside an iframe (the PDF viewer is
   * embedded as one) never fires the top-frame listener even when the script
   * is alive — absence there must not be read as "unreachable".
   */
  let contextMenuPresence: {
    tabId: number;
    url: string;
    at: number;
  } | null = null;

  /**
   * Unreachable-page signals the side-panel fast path trusts. All are either
   * synchronous certainties or a fresh presence report from the right-click
   * that opened the menu:
   * - `tabId === undefined`: Edge's PDF viewer (browser-UI surface)
   * - browser-internal schemes (chrome://, edge://, …)
   * - browser extension gallery pages (https, but never injectable)
   * - no fresh CONTEXT_MENU_PRESENCE report (http/https/file/chrome-extension)
   * A long-lived reachability cache was dropped: it goes stale while the PDF
   * viewer reloads (the viewer destroys and re-injects the content script,
   * and probes during the churn record a false "unreachable"), which opened
   * a spurious empty side panel next to a working in-page bubble. The PING
   * probe in translateSelectionInTab still decides the actual route.
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
   * Align the popup/sidepanel language pair with the page-translation settings
   * before routing a selection there, so the routed text translates to the same
   * target language the page itself would have used (page translate uses
   * settings, popup/sidepanel use the separate translatorLanguages pair).
   */
  async function syncTranslatorLanguagesWithSettings(): Promise<{
    sourceLang: string;
    targetLang: string;
  } | null> {
    try {
      const settings = await getSettings();
      const langs = {
        sourceLang: settings.defaultSourceLang,
        targetLang: settings.defaultTargetLang,
      };
      await setTranslatorLanguages(langs);
      return langs;
    } catch {
      // Non-fatal — the side panel falls back to its own language pair.
      return null;
    }
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
    // The freshly mounted panel may have already pulled this selection via
    // SIDEPANEL_READY (which synced the language pair itself). Skip the
    // redundant sync + delivery in that case.
    if (pendingSidepanelSelection === null && readyDeliveredText === text) return;

    // The side panel is only the vehicle here — the page context wins, so use
    // the page-translation language pair (and persist it as the popup/sidepanel
    // preference so the panel UI reflects what will actually be translated).
    const langs = await syncTranslatorLanguagesWithSettings();

    // READY may have consumed the selection while we were syncing.
    if (pendingSidepanelSelection === null && readyDeliveredText === text) return;

    if (pendingSidepanelSelection === null) {
      // Cold start (the fast path did not stash): stash with the resolved pair
      // so a panel mounting before the direct delivery can still pull it.
      pendingSidepanelSelection = {
        text,
        sourceLang: langs?.sourceLang ?? '',
        targetLang: langs?.targetLang ?? '',
      };
    } else if (langs) {
      pendingSidepanelSelection.sourceLang = langs.sourceLang;
      pendingSidepanelSelection.targetLang = langs.targetLang;
    }

    // Best effort: the click handler normally already opened the panel
    // synchronously (gesture still valid); this re-call only covers paths
    // where the gesture may have expired (keyboard shortcut).
    if (typeof windowId === 'number') {
      await tryOpenSidePanel(windowId);
    }

    // A freshly mounted panel already pulled the pending text via SIDEPANEL_READY.
    if (pendingSidepanelSelection?.text !== text) return;

    // Panel already open — deliver directly; clear pending only when a live panel acked.
    const res = await browser.runtime
      .sendMessage({
        type: 'TRANSLATE_SELECTION_VIA_SIDEPANEL',
        payload: { text, sourceLang: langs?.sourceLang, targetLang: langs?.targetLang },
      })
      .catch(() => null);
    if (res && typeof res === 'object' && (res as { success?: boolean }).success) {
      pendingSidepanelSelection = null;
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
    if (message.type === 'CONTEXT_MENU_PRESENCE') {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number' && tabId >= 0) {
        contextMenuPresence = { tabId, url: sender.tab?.url ?? '', at: Date.now() };
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'SIDEPANEL_READY') {
      const pending = pendingSidepanelSelection;
      // Fast answer when there is nothing to route or the pair is already
      // complete (routeSelectionToSidePanel filled it) — avoids a redundant
      // settings read + translatorLanguages write on every panel mount.
      if (!pending || (pending.sourceLang && pending.targetLang)) {
        if (pending?.text) readyDeliveredText = pending.text;
        sendResponse({ success: true, data: pending });
        pendingSidepanelSelection = null;
        return false;
      }
      // The click fast path stashed the selection with empty langs and the
      // panel mounted before routeSelectionToSidePanel could fill them.
      // Resolve the pair from settings before answering so the routed text
      // always carries the page-translation language pair.
      void (async () => {
        const langs = await syncTranslatorLanguagesWithSettings();
        const p = pendingSidepanelSelection;
        const data =
          p && langs
            ? {
              ...p,
              sourceLang: p.sourceLang || langs.sourceLang,
              targetLang: p.targetLang || langs.targetLang,
            }
            : p;
        sendResponse({ success: true, data });
        if (p?.text) readyDeliveredText = p.text;
        pendingSidepanelSelection = null;
      })();
      return true;
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
      // The content script is destroyed on navigation/reload; any earlier
      // right-click presence report is stale (tabId+url may match a reload).
      if (contextMenuPresence?.tabId === tabId) contextMenuPresence = null;
      if (pendingSidepanelSelection) pendingSidepanelSelection = null;
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
      // gesture is live. Only synchronous certainties trigger it — no tab id
      // (Edge's PDF viewer), an internal URL scheme, a known gallery page, or
      // a missing fresh presence report for a TOP-frame click. The PING probe
      // decides the actual route either way.
      const urlScheme = tab?.url ? tab.url.split(':')[0].toLowerCase() : '';
      const presence = contextMenuPresence;
      // One-shot consumption: a menu click is always preceded by a right-click
      // that (re)reported presence if the content script is alive. Clearing it
      // here binds the report to the current menu instance — a report can never
      // outlive its menu, no matter how long the user lingers before clicking.
      // Navigation (tabs.onUpdated loading) clears it as well.
      contextMenuPresence = null;
      const presenceUsable =
        presence !== null &&
        tabId !== undefined &&
        presence.tabId === tabId &&
        presence.url === (tab?.url ?? '');
      // Presence only covers top-frame clicks on page-like schemes. Clicks
      // inside an iframe (the PDF viewer embeds one) never fire the top-frame
      // listener, so absence there proves nothing — PING decides. Internal
      // schemes are already covered by the scheme set.
      const presenceCovered =
        (frameId === undefined || frameId === 0) &&
        (urlScheme === 'http' || urlScheme === 'https' || urlScheme === 'file');
      const knownUnreachable =
        tabId === undefined ||
        INTERNAL_UNREACHABLE_SCHEMES.has(urlScheme) ||
        isBrowserStoreUrl(tab?.url) ||
        (presenceCovered && !presenceUsable);
      if (selected && knownUnreachable && typeof windowId === 'number') {
        // Placeholder langs — SIDEPANEL_READY resolves them from settings before
        // answering, so a panel mounting before routeSelectionToSidePanel runs
        // still receives the page-translation language pair.
        pendingSidepanelSelection = { text: selected, sourceLang: '', targetLang: '' };
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
