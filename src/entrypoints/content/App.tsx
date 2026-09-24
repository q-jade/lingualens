import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject, Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, MessageResponse, SelectionTriggerMode, SelectionModifierKey } from '../../shared/types';
import { PageTranslateEngine, type TranslateProgress, type DisplayMode } from '../../content/page-translator/engine';
import { StatusBar } from '../../content/page-translator/StatusBar';
import { AppLogo } from '../../shared/AppLogo';
import { ModeIcon } from '../../shared/ModeIcon';
import { ProviderIcon } from '../../shared/ProviderIcon';
import { CopyButton } from '../../shared/CopyButton';
import { iconSize } from '../../shared/icon-size';
import { computeTriggerPosition } from '../../content/trigger-position';
import {
  isPageTranslateStarted,
  type PageTranslatePhase,
} from '../../shared/page-translate-phase';
import { resolveDefaultTargetLang } from '../../shared/default-target-lang';
import { SUPPORTED_LANGUAGES, getLanguageName } from '../../shared/languages';

const ERROR_KEYS: Record<string, string> = {
  NO_PROVIDER: 'content.noProvider',
  TRANSLATION_FAILED: 'content.translationFailed',
  NO_IMAGE_PROVIDER: 'content.noImageProvider',
  IMAGE_FETCH_FAILED: 'content.imageFetchFailed',
  BLOB_IMAGE: 'content.imageFetchFailed',
  NOT_AN_IMAGE: 'content.imageFetchFailed',
  IMAGE_TOO_LARGE: 'content.imageFetchFailed',
  IMAGE_READ_FAILED: 'content.imageFetchFailed',
};

/** Sentinel the built-in image prompt outputs when an image has no text. */
const NO_TEXT_IN_IMAGE = 'NO_TEXT_IN_IMAGE';

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
  /** Floating trigger for a selection that covers an image. */
  showImageTrigger: (imageUrl: string, mouseX: number, mouseY: number, range: Range) => void;
  /** Open panel and translate the text inside an image (context menu path). */
  translateImageNow: (imageUrl: string) => void;
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
/** Must match the panel width in style.css. */
const PANEL_MIN_WIDTH = 390;
const PANEL_WIDTH_RATIO = 0.35;
const PANEL_MAX_HEIGHT_RATIO = 0.5;

type PanelPosition = { left: number; top: number };
type PanelSize = { w: number; h: number };

function getViewport() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function estimatePanelSize(viewport = getViewport()): PanelSize {
  return {
    w: Math.min(Math.max(PANEL_MIN_WIDTH, viewport.w * PANEL_WIDTH_RATIO), viewport.w - 16),
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

/**
 * Keep a floating menu's bottom edge inside the viewport by shifting it up.
 * Menus open below the panel header, so a panel near the bottom of the viewport
 * (or a tall provider list) can push the menu off-screen. The menu itself
 * scrolls when capped by CSS max-height; this only fixes the position.
 */
function clampMenuBottom(
  pos: { left: number; top: number },
  menu: HTMLElement | null,
): { left: number; top: number } {
  if (!menu) return pos;
  const margin = 8;
  const overflow = menu.getBoundingClientRect().bottom - (window.innerHeight - margin);
  return overflow > 0 ? { ...pos, top: pos.top - overflow } : pos;
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
  const [modeMenuPosition, setModeMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [providerMenuPosition, setProviderMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [langMenuPosition, setLangMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuId = useId();
  const providerMenuId = useId();
  const langMenuId = useId();

  const computeModeMenuPosition = () => {
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
    const pos = computeModeMenuPosition();
    if (pos) setModeMenuPosition(clampMenuBottom(pos, modeMenuRef.current));
    setModeMenuOpen(true);
  };

  const closeModeMenu = () => {
    setModeMenuOpen(false);
    setModeMenuPosition(null);
  };

  const repositionModeMenu = () => {
    if (!modeMenuOpen) return;
    const pos = computeModeMenuPosition();
    if (pos) setModeMenuPosition(clampMenuBottom(pos, modeMenuRef.current));
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
    if (pos) setProviderMenuPosition(clampMenuBottom(pos, providerMenuRef.current));
    setProviderMenuOpen(true);
  };

  const closeProviderMenu = () => {
    setProviderMenuOpen(false);
    setProviderMenuPosition(null);
  };

  const repositionProviderMenu = () => {
    if (!providerMenuOpen) return;
    const pos = computeProviderMenuPosition();
    if (pos) setProviderMenuPosition(clampMenuBottom(pos, providerMenuRef.current));
  };

  const computeLangMenuPosition = () => {
    const btn = langTriggerRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    // Position below the button, right-aligned (matching the mode menu).
    const menuWidth = 200;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    return { left, top: rect.bottom + 4 };
  };

  const openLangMenu = () => {
    const pos = computeLangMenuPosition();
    if (pos) setLangMenuPosition(clampMenuBottom(pos, langMenuRef.current));
    setLangMenuOpen(true);
  };

  const closeLangMenu = () => {
    setLangMenuOpen(false);
    setLangMenuPosition(null);
  };

  const repositionLangMenu = () => {
    if (!langMenuOpen) return;
    const pos = computeLangMenuPosition();
    if (pos) setLangMenuPosition(clampMenuBottom(pos, langMenuRef.current));
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
    // Keep the focused item visible inside a scrollable menu (long language
    // list). Only scroll menus that actually overflow — scrollIntoView on a
    // fixed-position menu could otherwise scroll the page.
    if (menuRef.current && menuRef.current.scrollHeight > menuRef.current.clientHeight) {
      items[next].scrollIntoView({ block: 'nearest' });
    }
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

  const selectTargetLang = (lang: string) => {
    closeLangMenu();
    langTriggerRef.current?.focus();
    if (settingsRef.current?.defaultTargetLang === lang) return;
    setSettings((s) => (s ? { ...s, defaultTargetLang: lang } : s));
    // Fire-and-forget: the new language rides in the translate payload, so the
    // save does not need to land before the re-translation starts.
    void browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { defaultTargetLang: lang },
    });
    retranslateDisplayed(lang);
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
    retranslateDisplayed();
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
  /**
   * Image currently shown in the panel body. State because it is RENDERED
   * (the preview <img>); it switches only when a translation starts — a
   * pending selection records into pendingImageRef instead (see below), so
   * a pinned panel keeps its previous content until the trigger is clicked.
   */
  const [panelImage, setPanelImage] = useState<string | null>(null);
  /**
   * Pending image target for the floating trigger — deliberately NOT a mirror
   * of `panelImage`. In a pinned panel the pending selection and the displayed
   * preview intentionally diverge: show* handlers record the pending target
   * here while the panel keeps its previous content, and the preview switches
   * only when the trigger is clicked (or an explicit translateNow runs). A
   * render-time mirror (`ref.current = panelImage`) would clobber the pending
   * value on the very re-render the show* handler schedules.
   */
  const pendingImageRef = useRef<string | null>(null);
  /**
   * What the panel body currently displays. The dedup guards in
   * translateNow/translateImageNow compare against THIS, not the pending
   * refs: a pinned panel keeps showing the previous result after the pending
   * selection changes, and text/image results share `translation` — so the
   * guard must be kind-aware, or a stale image result would swallow a text
   * re-request (and vice versa).
   */
  const displayedTargetRef = useRef<
    { kind: 'text'; text: string } | { kind: 'image'; url: string } | null
  >(null);
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;
  const selectionTriggerModeRef = useRef<SelectionTriggerMode>('icon');
  const selectionModifierKeyRef = useRef<SelectionModifierKey>('ctrl');
  const engineRef = useRef(new PageTranslateEngine());
  /** Mirrors `pageTranslatePhase` for sync guards inside message/async handlers. */
  const pageTranslatePhaseRef = useRef<PageTranslatePhase>('idle');
  /** Latest progress for `finally` / stop (React state may lag one tick). */
  const pageProgressRef = useRef<TranslateProgress | null>(null);
  /**
   * Session ownership token. `startPageTranslation` claims the session with
   * `++pageSessionRef.current`; stop/restore/another start bump it, so an
   * invocation still awaiting `engine.start` can never finish (or mark `done`)
   * a session it no longer owns.
   */
  const pageSessionRef = useRef(0);

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

    const session = ++pageSessionRef.current;
    applyPageTranslatePhase('running');
    setMode('hidden');
    const initial = { total: 0, done: 0, errors: 0 };
    pageProgressRef.current = initial;
    setPageProgress(initial);

    // `engine.start` resolves `false` when a run is already active — this
    // invocation does not own the engine and must not finish the session.
    let started = true;
    try {
      started = await engine.start(
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
      // Only finish the session this invocation still owns: a stop/restore (or
      // a newer start) invalidates it, and a stale `engine.start` resolution
      // must never mark the current session `done` prematurely.
      if (started && session === pageSessionRef.current) {
        finishPageTranslateSession(pageProgressRef.current);
      }
    }
  }, [displayMode]);

  const stopPageTranslation = () => {
    // Invalidate the still-awaiting `startPageTranslation` invocation: its
    // `finally` would otherwise re-finish the session (duplicate toast) — or,
    // once its aborted tasks settle, mark a NEWER session `done`.
    pageSessionRef.current++;
    engineRef.current.stop();
    finishPageTranslateSession(pageProgressRef.current);
  };

  const restorePageTranslation = () => {
    pageSessionRef.current++;
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
      repositionLangMenu();
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [mode, modeMenuOpen, providerMenuOpen, langMenuOpen]);

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
      displayedTargetRef.current = null;
      pendingImageRef.current = null;
      selectedTextRef.current = '';
      closeModeMenu();
      closeProviderMenu();
      closeLangMenu();
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

  // Close the target-language menu on outside click or window blur
  useEffect(() => {
    if (!langMenuOpen) return;

    const onOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath();
      // Don't close if the click is on the toggle button (onClick will handle it)
      if (langTriggerRef.current && path.includes(langTriggerRef.current)) return;
      if (langMenuRef.current && !path.includes(langMenuRef.current)) {
        closeLangMenu();
      }
    };

    const onWindowBlur = () => closeLangMenu();

    document.addEventListener('mousedown', onOutsideClick, true);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      document.removeEventListener('mousedown', onOutsideClick, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [langMenuOpen]);

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

  useEffect(() => {
    if (!langMenuOpen) return;
    const items = langMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const active = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    const target = active ?? items[0];
    target.focus({ preventScroll: true });
    // The language menu is scrollable: bring the focused item into view.
    target.scrollIntoView({ block: 'nearest' });
  }, [langMenuOpen]);

  /**
   * Keep every floating menu inside the viewport, in both axes.
   *
   * The `compute*MenuPosition` helpers place a menu relative to its trigger using
   * an ASSUMED width, so a menu wider than assumed hangs past the right edge —
   * the mode menu has no fixed width and its labels scale with the font-size
   * setting. Menus also open downwards, so a panel near the bottom of the
   * viewport can push one off-screen.
   *
   * Both are corrected here against the measured rect. Each correction is exact,
   * so it settles in one extra pass; `setPos` is only called when a value
   * actually changes, which also prevents the pathological case of a menu wider
   * than the viewport from looping.
   */
  useLayoutEffect(() => {
    const margin = 8;
    const clamp = (
      open: boolean,
      pos: { left: number; top: number } | null,
      menuRef: RefObject<HTMLDivElement | null>,
      setPos: Dispatch<SetStateAction<{ left: number; top: number } | null>>,
    ) => {
      if (!open || !pos) return;
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();

      // Both edge guards below are safety nets rather than live fixes: the CSS
      // caps (max-width and max-height both end in `calc(100vw|dvh - 16px)`)
      // already keep a menu inside the viewport, so neither guard has been
      // observed to fire — verified down to a 300px-tall viewport with a
      // 60-item list, where the top settled at 0.4 × viewport height. They stay
      // so the invariant holds here even if those caps change.
      let left = pos.left;
      const rightOverflow = rect.right - (window.innerWidth - margin);
      if (rightOverflow > 0) left -= rightOverflow;
      if (left < margin) left = margin;

      let top = pos.top;
      const bottomOverflow = rect.bottom - (window.innerHeight - margin);
      if (bottomOverflow > 0) top -= bottomOverflow;
      if (top < margin) top = margin;

      if (left !== pos.left || top !== pos.top) setPos({ left, top });
    };
    clamp(modeMenuOpen, modeMenuPosition, modeMenuRef, setModeMenuPosition);
    clamp(providerMenuOpen, providerMenuPosition, providerMenuRef, setProviderMenuPosition);
    clamp(langMenuOpen, langMenuPosition, langMenuRef, setLangMenuPosition);
  }, [modeMenuOpen, modeMenuPosition, providerMenuOpen, providerMenuPosition, langMenuOpen, langMenuPosition]);

  const openPanelAt = (panelAnchor: { x: number; y: number }) => {
    pendingAnchorRef.current = panelAnchor;
    setMode('panel');
  };

  /** Translate a text target. `targetLangOverride` is used when the target
   *  language just changed — the settings ref updates only on re-render.
   *  `textOverride` lets panel-level operations re-translate the DISPLAYED
   *  text instead of the pending selection (see retranslateDisplayed). */
  const doTranslate = async (targetLangOverride?: string, textOverride?: string) => {
    const text = textOverride ?? selectedTextRef.current;
    if (!text) return;

    const targetLang = targetLangOverride ?? settingsRef.current?.defaultTargetLang ?? resolveDefaultTargetLang();
    const sourceLang = settingsRef.current?.defaultSourceLang ?? 'auto';

    // The panel body now belongs to this text (loading state) — the dedup
    // guards compare against this record, not the pending refs.
    displayedTargetRef.current = { kind: 'text', text };
    setLoading(true);
    setError(null);
    setTranslation('');

    try {
      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE',
        payload: { text, sourceLang, targetLang, applyAdditionalPrompt: true },
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

  const runSelectionTranslate = (panelAnchor: { x: number; y: number }) => {
    if (!selectedTextRef.current || isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
    openPanelAt(panelAnchor);
    void doTranslate();
  };

  /** Translate the text inside an image. `targetLangOverride` is used when
   *  the target language just changed — the settings ref updates only on
   *  re-render. `imageUrlOverride` lets panel-level operations re-translate
   *  the DISPLAYED image instead of the pending selection (see
   *  retranslateDisplayed). The page-translate guard lives in
   *  runImageTranslate, mirroring the text path — it must also keep the
   *  panel from opening. */
  const doImageTranslate = async (targetLangOverride?: string, imageUrlOverride?: string) => {
    const imageUrl = imageUrlOverride ?? pendingImageRef.current;
    if (!imageUrl) return;

    const targetLang = targetLangOverride ?? settingsRef.current?.defaultTargetLang ?? resolveDefaultTargetLang();
    const sourceLang = settingsRef.current?.defaultSourceLang ?? 'auto';

    // The panel body now belongs to this image — see doTranslate.
    displayedTargetRef.current = { kind: 'image', url: imageUrl };
    setLoading(true);
    setError(null);
    setTranslation('');

    try {
      // Pixel data first: the background fetches the image (canvas fallback
      // inside the page). Providers consume `image`, never the page URL.
      const resolved = await browser.runtime.sendMessage({
        type: 'RESOLVE_IMAGE_DATA_URL',
        payload: { imageUrl },
      });
      if (!resolved?.success || !resolved.dataUrl) {
        const raw = resolved?.error;
        setError(raw && ERROR_KEYS[raw] ? t(ERROR_KEYS[raw]) : t('content.imageFetchFailed'));
        return;
      }

      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE_IMAGE',
        payload: { imageUrl, image: resolved.dataUrl, sourceLang, targetLang },
      });

      if (response?.success) {
        const translated: string = response.data.translated;
        setTranslation(translated === NO_TEXT_IN_IMAGE ? t('content.noTextInImage') : translated);
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

  const runImageTranslate = (panelAnchor: { x: number; y: number }) => {
    if (!pendingImageRef.current || isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
    openPanelAt(panelAnchor);
    void doImageTranslate();
  };

  /**
   * Re-translate what the panel currently displays (language switch, provider
   * switch, retry). Panel-level operations target the DISPLAYED result —
   * never a pending selection the user has not translated (or has already
   * dismissed).
   */
  const retranslateDisplayed = (targetLangOverride?: string) => {
    const displayed = displayedTargetRef.current;
    if (!displayed) return;
    if (displayed.kind === 'image') void doImageTranslate(targetLangOverride, displayed.url);
    else void doTranslate(targetLangOverride, displayed.text);
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
      if (!selection?.rangeCount) {
        // Lost selection: dismiss the trigger, but never the pinned panel.
        if (isPinnedTrigger) setPinnedTrigger(null);
        else setMode('hidden');
        return;
      }
      // An image-only selection has empty text — keep the trigger alive while
      // an image is the pending target (the text match guards text targets).
      const imagePending = pendingImageRef.current !== null;
      const text = selection.toString().trim();
      if (!imagePending && (!text || text !== selectedTextRef.current)) {
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
        // New selection is text: drop any previous image target, or a stale
        // pending image would win at the trigger button (the image path
        // clears selectedTextRef symmetrically).
        pendingImageRef.current = null;
        triggerMouseRef.current = { x: mouseX, y: mouseY };
        const pos = computeTriggerPosition(range, mouseX, mouseY);
        // Pinned panel stays open: show a floating trigger for the new
        // selection rather than replacing the panel with the trigger. The
        // panel keeps the previous result untouched — refs alone record the
        // pending target; preview/result switch when the trigger is clicked.
        if (pinnedRef.current && modeRef.current === 'panel') {
          setPinnedTrigger(pos);
          return;
        }
        setPanelImage(null);
        setAnchor(pos);
        setMode('trigger');
        setTranslation('');
        setError(null);
      },
      translateNow(text) {
        if (isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
        const t = text.trim();
        if (!t) return;
        // Dedup against what the panel DISPLAYS (kind-aware): a pinned panel
        // keeps the previous result after the pending selection changed, and
        // text/image share `translation` — comparing against the pending refs
        // would let a stale image result swallow a text re-request.
        const displayed = displayedTargetRef.current;
        if (
          modeRef.current === 'panel' &&
          displayed?.kind === 'text' &&
          displayed.text === t &&
          (loadingRef.current || translationRef.current)
        ) {
          return;
        }
        selectedTextRef.current = t;
        pendingImageRef.current = null;
        setPanelImage(null);
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
        queueMicrotask(() => runSelectionTranslate(panelAnchor));
      },
      showImageTrigger(imageUrl, mouseX, mouseY, range) {
        if (isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
        selectedTextRef.current = '';
        pendingImageRef.current = imageUrl;
        triggerMouseRef.current = { x: mouseX, y: mouseY };
        const pos = computeTriggerPosition(range, mouseX, mouseY);
        // Pinned panel keeps the previous result untouched — same contract as
        // showTrigger; the preview switches when the trigger is clicked.
        if (pinnedRef.current && modeRef.current === 'panel') {
          setPinnedTrigger(pos);
          return;
        }
        setPanelImage(imageUrl);
        setAnchor(pos);
        setMode('trigger');
        setTranslation('');
        setError(null);
      },
      translateImageNow(imageUrl) {
        if (isPageTranslateStarted(pageTranslatePhaseRef.current)) return;
        if (!imageUrl) return;
        // Kind-aware dedup — see translateNow.
        const displayed = displayedTargetRef.current;
        if (
          modeRef.current === 'panel' &&
          displayed?.kind === 'image' &&
          displayed.url === imageUrl &&
          (loadingRef.current || translationRef.current)
        ) {
          return;
        }
        selectedTextRef.current = '';
        pendingImageRef.current = imageUrl;
        setPanelImage(imageUrl);
        setTranslation('');
        setError(null);
        if (pinnedRef.current && modeRef.current === 'panel') {
          setPinnedTrigger(null);
          queueMicrotask(() => void doImageTranslate());
          return;
        }
        const panelAnchor = {
          x: window.innerWidth / 2,
          y: window.innerHeight / 3,
        };
        setAnchor(panelAnchor);
        queueMicrotask(() => runImageTranslate(panelAnchor));
      },
      hide() {
        if (pinnedRef.current) {
          // The pinned panel stays, but the floating trigger for a pending
          // selection is dismissed together with the selection: mousedown
          // outside our UI means the user deselected or is starting a new
          // one (show* re-records the pending target afterwards). The
          // pending refs go too — panel-level operations re-translate the
          // DISPLAYED result, so a stale pending target must not survive.
          setPinnedTrigger(null);
          pendingImageRef.current = null;
          selectedTextRef.current = '';
          return;
        }
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
  const currentTargetLangName = settings ? getLanguageName(settings.defaultTargetLang) : '';

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
              // selection into it without moving the panel. Only NOW does the
              // panel switch to the pending target (preview in/out) — until
              // this click it kept showing the previous result untouched.
              setPinnedTrigger(null);
              setPanelImage(pendingImageRef.current);
              if (pendingImageRef.current) void doImageTranslate();
              else void doTranslate();
            } else if (pendingImageRef.current) {
              void runImageTranslate(anchor);
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
            if (langMenuOpen) {
              e.stopPropagation();
              closeLangMenu();
              return;
            }
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
            <div className="st-header-left">
              <AppLogo className="st-header-logo" />
              <span className="st-panel-title">
                {browser.i18n.getMessage('extName')}
              </span>
            </div>
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
                className={`st-provider-trigger ${providerMenuOpen ? 'st-pin-active' : ''}`}
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
              <button
                ref={langTriggerRef}
                type="button"
                onClick={() => {
                  if (langMenuOpen) {
                    closeLangMenu();
                  } else {
                    openLangMenu();
                  }
                }}
                onKeyDown={(e) => {
                  // Match the mode trigger: ↑/↓ opens the menu directly.
                  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !langMenuOpen) {
                    e.preventDefault();
                    openLangMenu();
                  }
                }}
                className={`st-panel-close st-lang-trigger ${langMenuOpen ? 'st-pin-active' : ''}`}
                title={t('options.targetLanguage')}
                aria-label={t('options.targetLanguage')}
                aria-haspopup="menu"
                aria-expanded={langMenuOpen}
                aria-controls={langMenuId}
              >
                <span className="st-lang-trigger-name">{currentTargetLangName || '—'}</span>
                <svg className="st-provider-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
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
                  <svg width="14" height="14" style={iconSize(14)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="14" height="14" style={iconSize(14)} viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </button>
              <button onClick={() => setMode('hidden')} className="st-panel-close" title={t('content.close')} aria-label={t('content.close')}>
                <svg width="14" height="14" style={iconSize(14)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="st-panel-body">
            {panelImage && (
              <div className="st-image-preview">
                <img src={panelImage} alt="" draggable={false} />
              </div>
            )}
            {loading && (
              <div className="st-loading">
                <span className="ll-spinner" />
                <span style={{ marginLeft: 6 }}>{t('content.translating')}</span>
              </div>
            )}
            {error && (
              <div className="st-error">
                <span>{error}</span>
                <button
                  onClick={() => retranslateDisplayed()}
                  className="st-retry-btn"
                >
                  {t('content.retry')}
                </button>
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

      {/* Target-language menu rendered outside the panel to avoid overflow: hidden clipping */}
      {mode === 'panel' && langMenuOpen && langMenuPosition && (
        <div
          ref={langMenuRef}
          id={langMenuId}
          className="st-mode-menu st-lang-menu"
          role="menu"
          onKeyDown={(e) => handleFloatingMenuKeyDown(e, langMenuRef, closeLangMenu, langTriggerRef)}
          style={{
            position: 'fixed',
            left: langMenuPosition.left,
            top: langMenuPosition.top,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => {
            const active = (settings?.defaultTargetLang ?? '') === l.code;
            return (
              <button
                key={l.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                className={`st-mode-option ${active ? 'st-mode-active' : ''}`}
                onClick={() => selectTargetLang(l.code)}
              >
                <span className="st-mode-label">{l.name}</span>
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
