import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, MessageResponse, SelectionTriggerMode, SelectionModifierKey } from '../../shared/types';
import { PageTranslateEngine, type TranslateProgress, type DisplayMode } from '../../content/page-translator/engine';
import { StatusBar } from '../../content/page-translator/StatusBar';
import { AppLogo } from '../../shared/AppLogo';
import { ModeIcon } from '../../shared/ModeIcon';
import { ProviderIcon } from '../../shared/ProviderIcon';
import { CopyButton } from '../../shared/CopyButton';
import { computeTriggerPosition } from '../../content/trigger-position';
import {
  isPageTranslateStarted,
  type PageTranslatePhase,
} from '../../shared/page-translate-phase';
import { resolveDefaultTargetLang } from '../../shared/default-target-lang';

const ERROR_KEYS: Record<string, string> = {
  NO_PROVIDER: 'content.noProvider',
  TRANSLATION_FAILED: 'content.translationFailed',
};

function notifyPageTranslatePhase(phase: PageTranslatePhase) {
  browser.runtime.sendMessage({
    type: 'PAGE_TRANSLATE_STATE_CHANGED',
    payload: { phase },
  }).catch(() => { });
}

function phaseAfterPageTranslateEnds(progress: TranslateProgress | null): PageTranslatePhase {
  if (!progress) return 'idle';
  return (progress.done > 0 || progress.errors > 0) ? 'done' : 'idle';
}

/**
 * The content UI lives in a shadow root: `document.activeElement` returns the
 * shadow host (the lingua-lens element) instead of the focused element inside
 * the shadow tree. Descend through nested shadow roots to find the real one.
 */
function getDeepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

export interface ContentAppHandle {
  showTrigger: (text: string, mouseX: number, mouseY: number, range: Range) => void;
  /** Open panel and translate immediately (e.g. context menu — no floating trigger step). */
  translateNow: (text: string) => void;
  hide: () => void;
  isPageTranslationActive: () => boolean;
  getPageTranslatePhase: () => PageTranslatePhase;
  getSelectionTriggerMode: () => SelectionTriggerMode;
  getSelectionModifierKey: () => SelectionModifierKey;
  showModeToast: (mode: SelectionTriggerMode, modifierKey?: SelectionModifierKey) => void;
  startPageTranslation: () => void;
  stopPageTranslation: () => void;
  restorePageTranslation: () => void;
}

interface Props {
  onReady: (handle: ContentAppHandle) => void;
}

type Mode = 'hidden' | 'trigger' | 'panel';

const SELECTION_PANEL_VIEW_MARGIN = 8;
const PANEL_MIN_WIDTH = 280;
const PANEL_WIDTH_RATIO = 0.3;
const PANEL_MAX_HEIGHT_RATIO = 0.5;

type PanelPosition = { left: number; top: number };
type PanelSize = { w: number; h: number };

function getViewport() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function estimatePanelSize(viewport = getViewport()): PanelSize {
  return {
    w: Math.max(PANEL_MIN_WIDTH, viewport.w * PANEL_WIDTH_RATIO),
    h: viewport.h * PANEL_MAX_HEIGHT_RATIO,
  };
}

function readPanelSize(panel: HTMLDivElement | null): PanelSize {
  const rect = panel?.getBoundingClientRect();
  return rect ? { w: rect.width, h: rect.height } : estimatePanelSize();
}

function clampPanelPosition(
  pos: PanelPosition,
  viewport: { w: number; h: number },
  panelSize: PanelSize,
): PanelPosition {
  const m = SELECTION_PANEL_VIEW_MARGIN;
  return {
    left: Math.min(Math.max(pos.left, m), Math.max(m, viewport.w - panelSize.w - m)),
    top: Math.min(Math.max(pos.top, m), Math.max(m, viewport.h - panelSize.h - m)),
  };
}

/** Place the panel above the selection when possible; falls back to below. */
function panelPositionFromAnchor(
  anchor: { x: number; y: number },
  viewport: { w: number; h: number },
  panelSize: PanelSize,
): PanelPosition {
  const gap = 4;
  let top = anchor.y - gap - panelSize.h;
  if (top < SELECTION_PANEL_VIEW_MARGIN) {
    top = anchor.y + gap;
  }
  return clampPanelPosition({ left: anchor.x + 6, top }, viewport, panelSize);
}

export function ContentApp({ onReady }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('hidden');
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [panelPosition, setPanelPosition] = useState<PanelPosition>({ left: 0, top: 0 });
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  // When the panel is pinned, a new selection shows this floating trigger
  // (instead of replacing the panel) so the user can translate into it.
  const [pinnedTrigger, setPinnedTrigger] = useState<{ x: number; y: number } | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modeMenuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [providerMenuPosition, setProviderMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuId = useId();
  const providerMenuId = useId();

  const computeMenuPosition = () => {
    const btn = modeTriggerRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    // Position below the button, right-aligned (matching original right: 0 behavior)
    const menuWidth = 180;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    return { left, top: rect.bottom + 4 };
  };

  const openModeMenu = () => {
    const pos = computeMenuPosition();
    if (pos) setMenuPosition(pos);
    setModeMenuOpen(true);
  };

  const closeModeMenu = () => {
    setModeMenuOpen(false);
    setMenuPosition(null);
  };

  const repositionModeMenu = () => {
    if (!modeMenuOpen) return;
    const pos = computeMenuPosition();
    if (pos) setMenuPosition(pos);
  };

  const computeProviderMenuPosition = () => {
    const btn = providerTriggerRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 220;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    return { left, top: rect.bottom + 4 };
  };

  const openProviderMenu = () => {
    const pos = computeProviderMenuPosition();
    if (pos) setProviderMenuPosition(pos);
    setProviderMenuOpen(true);
  };

  const closeProviderMenu = () => {
    setProviderMenuOpen(false);
    setProviderMenuPosition(null);
  };

  const repositionProviderMenu = () => {
    if (!providerMenuOpen) return;
    const pos = computeProviderMenuPosition();
    if (pos) setProviderMenuPosition(pos);
  };

  /**
   * Shared keyboard handling for the panel's floating menus: Escape closes and
   * returns focus to the trigger, Tab closes (focus stays with the trigger),
   * ArrowDown/Up and Home/End move between items.
   */
  const handleFloatingMenuKeyDown = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    menuRef: RefObject<HTMLDivElement | null>,
    close: () => void,
    triggerRef: RefObject<HTMLButtonElement | null>,
  ) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    const idx = items.indexOf(getDeepActiveElement() as HTMLButtonElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else next = items.length - 1;
    items[next].focus({ preventScroll: true });
  };

  const selectTriggerMode = (m: SelectionTriggerMode) => {
    closeModeMenu();
    modeTriggerRef.current?.focus();
    if (selectionTriggerModeRef.current === m) return;
    selectionTriggerModeRef.current = m;
    setSettings((s) => (s ? { ...s, selectionTriggerMode: m } : s));
    void browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { selectionTriggerMode: m },
    });
    const key = m === 'modifier'
      ? t('content.modeSwitchedModifier', { key: selectionModifierKeyRef.current.toUpperCase() })
      : t(`content.modeSwitched${m.charAt(0).toUpperCase() + m.slice(1)}`);
    showToast(key);
  };

  const switchProvider = async (providerId: string) => {
    if (!settings || providerId === settings.defaultProvider) return;
    const nextFallback = settings.fallbackProviders.filter((id) => id !== providerId);
    const next = { ...settings, defaultProvider: providerId, fallbackProviders: nextFallback };
    setSettings(next);
    await browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { defaultProvider: providerId, fallbackProviders: nextFallback },
    });
    await doTranslate();
  };

  // Page translation state
  const [pageTranslatePhase, setPageTranslatePhase] = useState<PageTranslatePhase>('idle');
  const [pageProgress, setPageProgress] = useState<TranslateProgress | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  const [toastText, setToastText] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTextRef = useRef('');
  const triggerMouseRef = useRef({ x: 0, y: 0 });
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;
  const selectionTriggerModeRef = useRef<SelectionTriggerMode>('icon');
  const selectionModifierKeyRef = useRef<SelectionModifierKey>('ctrl');
  const engineRef = useRef(new PageTranslateEngine());
  /** Mirrors `pageTranslatePhase` for sync guards inside message/async handlers. */
  const pageTranslatePhaseRef = useRef<PageTranslatePhase>('idle');
  /** Latest progress for `finally` / stop (React state may lag one tick). */
  const pageProgressRef = useRef<TranslateProgress | null>(null);

  const applyPageTranslatePhase = (phase: PageTranslatePhase) => {
    pageTranslatePhaseRef.current = phase;
    setPageTranslatePhase(phase);
    notifyPageTranslatePhase(phase);
  };

  const showToast = useCallback((text: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastText(text);
    toastTimerRef.current = setTimeout(() => setToastText(null), 1500);
  }, []);

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => {
      if (!changes.settings) return;
      const newSettings = changes.settings.newValue as AppSettings | undefined;
      if (!newSettings) return;
      setSettings(newSettings);
      if (newSettings.selectionTriggerMode) {
        selectionTriggerModeRef.current = newSettings.selectionTriggerMode;
      }
      if (newSettings.selectionModifierKey) {
        selectionModifierKeyRef.current = newSettings.selectionModifierKey;
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  const finishPageTranslateSession = (progress: TranslateProgress | null) => {
    const phase = phaseAfterPageTranslateEnds(progress);
    if (phase === 'idle') setPageProgress(null);
    if (phase === 'done' && progress && progress.done > 0) {
      showToast(t('content.pageTranslated'));
    }
    applyPageTranslatePhase(phase);
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const panelDragRef = useRef<{ startX: number; startY: number; origin: PanelPosition } | null>(null);
  const modeRef = useRef(mode);
  const loadingRef = useRef(loading);
  const translationRef = useRef(translation);
  const pinnedRef = useRef(pinned);
  const previousFocusRef = useRef<Element | null>(null);
  modeRef.current = mode;
  loadingRef.current = loading;
  translationRef.current = translation;
  pinnedRef.current = pinned;

  const startPageTranslation = useCallback(async () => {
    const settings = settingsRef.current;
    const engine = engineRef.current;
    if (engine.running || pageTranslatePhaseRef.current !== 'idle') return;

    applyPageTranslatePhase('running');
    setMode('hidden');
    const initial = { total: 0, done: 0, errors: 0 };
    pageProgressRef.current = initial;
    setPageProgress(initial);

    try {
      await engine.start(
        {
          targetLang: settings?.defaultTargetLang ?? resolveDefaultTargetLang(),
          sourceLang: settings?.defaultSourceLang ?? 'auto',
          displayMode,
          concurrency: 4,
          chunkingMode: settings?.chunkingMode ?? 'quality',
        },
        (progress) => {
          // Keep ref in sync here: `finally` runs before React re-renders after the last onProgress.
          pageProgressRef.current = progress;
          setPageProgress({ ...progress });
        },
      );
    } finally {
      finishPageTranslateSession(pageProgressRef.current);
    }
  }, [displayMode]);

  const stopPageTranslation = () => {
    engineRef.current.stop();
    finishPageTranslateSession(pageProgressRef.current);
  };

  const restorePageTranslation = () => {
    engineRef.current.restore();
    pageProgressRef.current = null;
    setPageProgress(null);
    applyPageTranslatePhase('idle');
  };

  const toggleDisplayMode = useCallback(() => {
    const newMode: DisplayMode = displayMode === 'bilingual' ? 'replace' : 'bilingual';
    setDisplayMode(newMode);
    engineRef.current.switchMode(newMode);
  }, [displayMode]);

  const STATUS_BAR_HEIGHT = 40;
  useEffect(() => {
    const visible = pageTranslatePhase !== 'idle' && !statusCollapsed;
    if (visible) {
      const original = document.documentElement.style.paddingTop;
      document.documentElement.style.paddingTop = `${STATUS_BAR_HEIGHT}px`;
      return () => { document.documentElement.style.paddingTop = original; };
    }
  }, [pageTranslatePhase, statusCollapsed]);

  useLayoutEffect(() => {
    if (mode !== 'panel') return;
    const panelSize = readPanelSize(panelRef.current);
    const viewport = getViewport();
    if (pendingAnchorRef.current) {
      const anchor = pendingAnchorRef.current;
      pendingAnchorRef.current = null;
      setPanelPosition(panelPositionFromAnchor(anchor, viewport, panelSize));
    } else {
      setPanelPosition((prev) => clampPanelPosition(prev, viewport, panelSize));
    }
  }, [mode, loading, translation, error]);

  useEffect(() => {
    if (mode !== 'panel') return;
    const sync = () => {
      setPanelPosition((prev) =>
        clampPanelPosition(prev, getViewport(), readPanelSize(panelRef.current)),
      );
      repositionModeMenu();
      repositionProviderMenu();
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [mode, modeMenuOpen, providerMenuOpen]);

  // Focus management: move focus into the panel on open (so Escape works and
  // keyboard users land inside it), restore the previous focus on close.
  useEffect(() => {
    if (mode !== 'panel') return;
    previousFocusRef.current = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      const prev = previousFocusRef.current;
      if (prev instanceof HTMLElement && prev.isConnected) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [mode]);

  // Pin is a per-open-session flag: it survives re-translations (panel stays
  // open or briefly switches to the trigger) but resets once the panel closes.
  useEffect(() => {
    if (mode === 'hidden') {
      setPinned(false);
      setPinnedTrigger(null);
      closeModeMenu();
      closeProviderMenu();
    }
  }, [mode]);

  // Close the trigger-mode menu on outside click or window blur
  useEffect(() => {
    if (!modeMenuOpen) return;

    const onOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath();
      // Don't close if the click is on the toggle button (onClick will handle it)
      if (modeTriggerRef.current && path.includes(modeTriggerRef.current)) return;
      if (modeMenuRef.current && !path.includes(modeMenuRef.current)) {
        closeModeMenu();
      }
    };

    const onWindowBlur = () => closeModeMenu();

    document.addEventListener('mousedown', onOutsideClick, true);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      document.removeEventListener('mousedown', onOutsideClick, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [modeMenuOpen]);

  // Close the provider menu on outside click or window blur
  useEffect(() => {
    if (!providerMenuOpen) return;

    const onOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath();
      // Don't close if the click is on the toggle button (onClick will handle it)
      if (providerTriggerRef.current && path.includes(providerTriggerRef.current)) return;
      if (providerMenuRef.current && !path.includes(providerMenuRef.current)) {
        closeProviderMenu();
      }
    };

    const onWindowBlur = () => closeProviderMenu();

    document.addEventListener('mousedown', onOutsideClick, true);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      document.removeEventListener('mousedown', onOutsideClick, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [providerMenuOpen]);

  // Focus the active item when a floating menu opens so keyboard users can
  // navigate it immediately.
  useEffect(() => {
    if (!modeMenuOpen) return;
    const items = modeMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const active = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    (active ?? items[0]).focus({ preventScroll: true });
  }, [modeMenuOpen]);

  useEffect(() => {
    if (!providerMenuOpen) return;
    const items = providerMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const active = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    (active ?? items[0]).focus({ preventScroll: true });
  }, [providerMenuOpen]);

  const openPanelAt = (panelAnchor: { x: number; y: number }) => {
    pendingAnchorRef.current = panelAnchor;
    setMode('panel');
  };

  const doTranslate = async () => {
    const text = selectedTextRef.current;
    if (!text) return;

    const targetLang = settingsRef.current?.defaultTargetLang ?? resolveDefaultTargetLang();
    const sourceLang = settingsRef.current?.defaultSourceLang ?? 'auto';

    setLoading(true);
    setError(null);
    setTranslation('');

    try {
      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE',
        payload: { text, sourceLang, targetLang },
      });

      if (response?.success) {
        setTranslation(response.data.translated);
      } else {
        const raw = response?.error;
        setError(raw && ERROR_KEYS[raw] ? t(ERROR_KEYS[raw]) : (raw || t('content.translationFailed')));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('content.translationFailed'));
    } finally {
      setLoading(false);
    }
  };

  const runSelectionTranslate = async (panelAnchor: { x: number; y: number }) => {
    if (!selectedTextRef.current || isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
    openPanelAt(panelAnchor);
    await doTranslate();
  };

  const handlePanelHeaderMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.st-panel-close, .st-provider-trigger, .st-mode-picker')) return;
    event.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const origin = rect
      ? { left: rect.left, top: rect.top }
      : { left: 0, top: 0 };
    panelDragRef.current = { startX: event.clientX, startY: event.clientY, origin };

    const onMouseMove = (moveEvent: MouseEvent) => {
      const drag = panelDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      setPanelPosition(
        clampPanelPosition(
          { left: drag.origin.left + dx, top: drag.origin.top + dy },
          getViewport(),
          readPanelSize(panelRef.current),
        ),
      );
    };

    const onMouseUp = () => {
      panelDragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    const isPinnedTrigger = mode === 'panel' && pinnedTrigger !== null;
    if (mode !== 'trigger' && !isPinnedTrigger) return;

    const syncTriggerPosition = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!text || text !== selectedTextRef.current || !selection?.rangeCount) {
        // Lost selection: dismiss the trigger, but never the pinned panel.
        if (isPinnedTrigger) setPinnedTrigger(null);
        else setMode('hidden');
        return;
      }
      const range = selection.getRangeAt(0);
      const pos = computeTriggerPosition(
        range,
        triggerMouseRef.current.x,
        triggerMouseRef.current.y,
      );
      if (isPinnedTrigger) setPinnedTrigger(pos);
      else setAnchor(pos);
    };

    document.addEventListener('scroll', syncTriggerPosition, { capture: true, passive: true });
    window.addEventListener('resize', syncTriggerPosition, { passive: true });
    return () => {
      document.removeEventListener('scroll', syncTriggerPosition, { capture: true });
      window.removeEventListener('resize', syncTriggerPosition);
    };
  }, [mode, pinnedTrigger]);

  // Re-register handle when startPageTranslation changes (displayMode).
  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      (res: MessageResponse<AppSettings>) => {
        if (res.success) {
          setSettings(res.data);
          selectionTriggerModeRef.current = res.data.selectionTriggerMode ?? 'icon';
          selectionModifierKeyRef.current = res.data.selectionModifierKey ?? 'ctrl';
        }
      },
    );

    onReady({
      showTrigger(text, mouseX, mouseY, range) {
        if (isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
        selectedTextRef.current = text;
        triggerMouseRef.current = { x: mouseX, y: mouseY };
        const pos = computeTriggerPosition(range, mouseX, mouseY);
        // Pinned panel stays open: show a floating trigger for the new
        // selection rather than replacing the panel with the trigger.
        if (pinnedRef.current && modeRef.current === 'panel') {
          setPinnedTrigger(pos);
          return;
        }
        setAnchor(pos);
        setMode('trigger');
        setTranslation('');
        setError(null);
      },
      translateNow(text) {
        if (isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
        const t = text.trim();
        if (!t) return;
        if (
          modeRef.current === 'panel' &&
          t === selectedTextRef.current &&
          (loadingRef.current || translationRef.current)
        ) {
          return;
        }
        selectedTextRef.current = t;
        setTranslation('');
        setError(null);
        // Pinned panel stays in place: translate the new selection into it.
        if (pinnedRef.current && modeRef.current === 'panel') {
          setPinnedTrigger(null);
          queueMicrotask(() => void doTranslate());
          return;
        }
        const panelAnchor = {
          x: window.innerWidth / 2,
          y: window.innerHeight / 3,
        };
        setAnchor(panelAnchor);
        queueMicrotask(() => void runSelectionTranslate(panelAnchor));
      },
      hide() {
        if (pinnedRef.current) return;
        setMode('hidden');
      },
      isPageTranslationActive() {
        return isPageTranslateStarted(pageTranslatePhaseRef.current);
      },
      getPageTranslatePhase() {
        return pageTranslatePhaseRef.current;
      },
      getSelectionTriggerMode() {
        return selectionTriggerModeRef.current;
      },
      getSelectionModifierKey() {
        return selectionModifierKeyRef.current;
      },
      showModeToast(m, modifierKey) {
        const key = m === 'modifier'
          ? t('content.modeSwitchedModifier', { key: (modifierKey ?? selectionModifierKeyRef.current).toUpperCase() })
          : t(`content.modeSwitched${m.charAt(0).toUpperCase() + m.slice(1)}` as 'content.modeSwitchedIcon');
        showToast(key);
      },
      startPageTranslation,
      stopPageTranslation,
      restorePageTranslation,
    });
  }, [onReady, startPageTranslation]);

  const currentProvider = (settings?.providers ?? []).find((p) => p.id === settings?.defaultProvider);

  return (
    <>
      {/* Page translation status bar */}
      <StatusBar
        progress={pageProgress}
        running={pageTranslatePhase === 'running'}
        displayMode={displayMode}
        collapsed={statusCollapsed}
        onStop={stopPageTranslation}
        onRestore={restorePageTranslation}
        onToggleMode={toggleDisplayMode}
        onToggleCollapse={() => setStatusCollapsed((c) => !c)}
      />

      {/* Selection trigger button (normal, or floating over a pinned panel) */}
      {(mode === 'trigger' || pinnedTrigger) && (
        <button
          onClick={() => {
            if (pinnedTrigger) {
              // Panel is already open and pinned in place: translate the new
              // selection into it without moving the panel.
              setPinnedTrigger(null);
              void doTranslate();
            } else {
              void runSelectionTranslate(anchor);
            }
          }}
          style={{
            position: 'fixed',
            left: (pinnedTrigger ?? anchor).x,
            top: (pinnedTrigger ?? anchor).y,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
          className="st-trigger-btn"
          title={t('popup.translate')}
          aria-label={t('popup.translate')}
        >
          <AppLogo className="st-trigger-icon" />
        </button>
      )}

      {/* Floating translation panel */}
      {mode === 'panel' && (
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            if (providerMenuOpen) {
              e.stopPropagation();
              closeProviderMenu();
              return;
            }
            if (modeMenuOpen) {
              e.stopPropagation();
              closeModeMenu();
              return;
            }
            if (!pinned) {
              e.stopPropagation();
              setMode('hidden');
            }
          }}
          style={{
            position: 'fixed',
            left: panelPosition.left,
            top: panelPosition.top,
            zIndex: 2147483647,
            pointerEvents: 'auto',
            backgroundColor: '#ffffff',
            isolation: 'isolate',
          }}
          className="st-panel"
        >
          <div
            className="st-panel-header"
            onMouseDown={handlePanelHeaderMouseDown}
          >
            <AppLogo className="st-header-logo" />
            <div className="st-provider-picker">
              <button
                ref={providerTriggerRef}
                type="button"
                onClick={() => {
                  if (providerMenuOpen) {
                    closeProviderMenu();
                  } else {
                    openProviderMenu();
                  }
                }}
                onKeyDown={(e) => {
                  // Match ProviderPicker: ↑/↓ opens the menu directly (Enter/Space
                  // already work via native button activation).
                  if (
                    (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
                    !providerMenuOpen &&
                    (settings?.providers.length ?? 0) > 0
                  ) {
                    e.preventDefault();
                    openProviderMenu();
                  }
                }}
                className="st-provider-trigger"
                title={t('options.providers')}
                aria-label={t('options.providers')}
                aria-haspopup="menu"
                aria-expanded={providerMenuOpen}
                aria-controls={providerMenuId}
              >
                {currentProvider && (
                  <ProviderIcon
                    type={currentProvider.type}
                    name={currentProvider.name}
                    size={14}
                    className="st-provider-trigger-icon"
                  />
                )}
                <span className="st-provider-name">{currentProvider?.name ?? '—'}</span>
                {/* Same geometry as the .ll-select chevron (m6 9 6 6 6-6, stroke-width 2);
                    currentColor instead of the baked-in gray so it works on the gradient header. */}
                <svg className="st-provider-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
            <div className="st-header-actions">
              <div className="st-mode-picker">
                <button
                  ref={modeTriggerRef}
                  type="button"
                  onClick={() => {
                    if (modeMenuOpen) {
                      closeModeMenu();
                    } else {
                      openModeMenu();
                    }
                  }}
                  onKeyDown={(e) => {
                    // Match ProviderPicker: ↑/↓ opens the menu directly.
                    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !modeMenuOpen) {
                      e.preventDefault();
                      openModeMenu();
                    }
                  }}
                  className={`st-panel-close ${modeMenuOpen ? 'st-pin-active' : ''}`}
                  title={t('popup.selectionMode')}
                  aria-label={t('popup.selectionMode')}
                  aria-haspopup="menu"
                  aria-expanded={modeMenuOpen}
                  aria-controls={modeMenuId}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" />
                  </svg>
                </button>
                {/* Mode menu rendered as sibling outside the panel to avoid overflow: hidden clipping */}
              </div>
              <button
                type="button"
                onClick={() => setPinned((v) => !v)}
                className={`st-panel-close ${pinned ? 'st-pin-active' : ''}`}
                title={pinned ? t('content.unpin') : t('content.pin')}
                aria-label={pinned ? t('content.unpin') : t('content.pin')}
                aria-pressed={pinned}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </button>
              <button onClick={() => setMode('hidden')} className="st-panel-close" title={t('content.close')} aria-label={t('content.close')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="st-panel-body">
            {loading && (
              <div className="st-loading">
                <span className="ll-spinner" />
                <span style={{ marginLeft: 6 }}>{t('content.translating')}</span>
              </div>
            )}
            {error && (
              <div className="st-error">
                <span>{error}</span>
                <button onClick={doTranslate} className="st-retry-btn">{t('content.retry')}</button>
              </div>
            )}
            {!loading && !error && translation && (
              <div className="st-translation">
                <p>{translation}</p>
              </div>
            )}
          </div>
          {!loading && !error && translation && (
            <div className="st-panel-footer">
              <CopyButton text={translation} label={t('content.copy')} variant="icon" />
            </div>
          )}
        </div>
      )}

      {/* Mode menu rendered outside the panel to avoid overflow: hidden clipping */}
      {mode === 'panel' && modeMenuOpen && modeMenuPosition && (
        <div
          ref={modeMenuRef}
          id={modeMenuId}
          className="st-mode-menu"
          role="menu"
          onKeyDown={(e) => handleFloatingMenuKeyDown(e, modeMenuRef, closeModeMenu, modeTriggerRef)}
          style={{
            position: 'fixed',
            left: modeMenuPosition.left,
            top: modeMenuPosition.top,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          {([
            { m: 'icon' as SelectionTriggerMode, labelKey: 'options.triggerModeIcon' },
            { m: 'instant' as SelectionTriggerMode, labelKey: 'options.triggerModeInstant' },
            { m: 'modifier' as SelectionTriggerMode, labelKey: 'options.triggerModeModifier' },
            { m: 'off' as SelectionTriggerMode, labelKey: 'options.triggerModeOff' },
          ]).map(({ m, labelKey }) => {
            const active = (settings?.selectionTriggerMode ?? 'icon') === m;
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                className={`st-mode-option ${active ? 'st-mode-active' : ''}`}
                onClick={() => selectTriggerMode(m)}
              >
                <span className="st-mode-icon"><ModeIcon mode={m} size={14} /></span>
                <span className="st-mode-label">{t(labelKey)}</span>
                {active && <span className="st-mode-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Provider menu rendered outside the panel to avoid overflow: hidden clipping */}
      {mode === 'panel' && providerMenuOpen && providerMenuPosition && (
        <div
          ref={providerMenuRef}
          id={providerMenuId}
          className="st-mode-menu st-provider-menu"
          role="menu"
          onKeyDown={(e) => handleFloatingMenuKeyDown(e, providerMenuRef, closeProviderMenu, providerTriggerRef)}
          style={{
            position: 'fixed',
            left: providerMenuPosition.left,
            top: providerMenuPosition.top,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          {(settings?.providers ?? []).map((p) => {
            const active = p.id === settings?.defaultProvider;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                className={`st-mode-option ${active ? 'st-mode-active' : ''}`}
                onClick={() => {
                  closeProviderMenu();
                  providerTriggerRef.current?.focus();
                  void switchProvider(p.id);
                }}
              >
                <span className="st-mode-icon"><ProviderIcon type={p.type} name={p.name} size={14} /></span>
                <span className="st-mode-label">{p.name}</span>
                {active && <span className="st-mode-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Mode-switch toast */}
      {toastText && (
        <div className="st-toast" role="status">
          {toastText}
        </div>
      )}
    </>
  );
}
