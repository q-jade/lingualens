import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { AppSettings, MessageResponse } from '../../shared/types';
import { PageTranslateEngine, type TranslateProgress, type DisplayMode } from '../../content/page-translator/engine';
import { StatusBar } from '../../content/page-translator/StatusBar';
import { AppLogo } from '../../shared/AppLogo';
import type { PageTranslatePhase } from '../../shared/page-translate-phase';

function notifyPageTranslatePhase(phase: PageTranslatePhase) {
  browser.runtime.sendMessage({
    type: 'PAGE_TRANSLATE_STATE_CHANGED',
    payload: { phase },
  }).catch(() => {});
}

export interface ContentAppHandle {
  showTrigger: (text: string, position: { x: number; y: number }) => void;
  /** Open panel and translate immediately (e.g. context menu — no floating trigger step). */
  translateNow: (text: string) => void;
  hide: () => void;
  isPageTranslationActive: () => boolean;
  getPageTranslatePhase: () => PageTranslatePhase;
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
  const [mode, setMode] = useState<Mode>('hidden');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [panelPosition, setPanelPosition] = useState<PanelPosition>({ left: 0, top: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Page translation state
  const [pageProgress, setPageProgress] = useState<TranslateProgress | null>(null);
  const [pageRunning, setPageRunning] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  const selectedTextRef = useRef('');
  const anchorRef = useRef({ x: 0, y: 0 });
  const settingsRef = useRef<AppSettings | null>(null);
  const engineRef = useRef(new PageTranslateEngine());
  const pageTranslatedRef = useRef(false);
  const pageProgressRef = useRef<TranslateProgress | null>(null);
  const pageRunningRef = useRef(false);

  pageProgressRef.current = pageProgress;
  pageRunningRef.current = pageRunning;

  const computePageTranslatePhase = (): PageTranslatePhase => {
    if (!pageTranslatedRef.current) return 'idle';
    if (pageRunningRef.current) return 'running';
    if (pageProgressRef.current && pageProgressRef.current.done > 0) return 'done';
    return 'idle';
  };

  const handleTranslateRef = useRef<() => Promise<void>>(async () => {});
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const panelDragRef = useRef<{ startX: number; startY: number; origin: PanelPosition } | null>(null);
  const modeRef = useRef(mode);
  const loadingRef = useRef(loading);
  const translationRef = useRef(translation);
  modeRef.current = mode;
  loadingRef.current = loading;
  translationRef.current = translation;

  const startPageTranslation = useCallback(async () => {
    const settings = settingsRef.current;
    const engine = engineRef.current;
    if (engine.running || pageTranslatedRef.current) return;

    pageTranslatedRef.current = true;
    notifyPageTranslatePhase('running');
    setMode('hidden');
    setPageRunning(true);
    setPageProgress({ total: 0, done: 0, errors: 0 });

    try {
      await engine.start(
        {
          targetLang: settings?.defaultTargetLang ?? 'zh',
          sourceLang: settings?.defaultSourceLang ?? 'auto',
          displayMode,
          concurrency: 4,
          chunkingMode: settings?.chunkingMode ?? 'quality',
        },
        (progress) => setPageProgress({ ...progress }),
      );
    } finally {
      setPageRunning(false);
      if ((pageProgressRef.current?.done ?? 0) === 0) {
        pageTranslatedRef.current = false;
        setPageProgress(null);
        notifyPageTranslatePhase('idle');
      } else {
        notifyPageTranslatePhase('done');
      }
    }
  }, [displayMode]);

  const stopPageTranslation = useCallback(() => {
    engineRef.current.stop();
    setPageRunning(false);
    if ((pageProgressRef.current?.done ?? 0) === 0) {
      pageTranslatedRef.current = false;
      setPageProgress(null);
      notifyPageTranslatePhase('idle');
    } else {
      notifyPageTranslatePhase('done');
    }
  }, []);

  const restorePageTranslation = useCallback(() => {
    engineRef.current.restore();
    pageTranslatedRef.current = false;
    notifyPageTranslatePhase('idle');
    setPageProgress(null);
    setPageRunning(false);
  }, []);

  const toggleDisplayMode = useCallback(() => {
    const newMode: DisplayMode = displayMode === 'bilingual' ? 'replace' : 'bilingual';
    setDisplayMode(newMode);
    engineRef.current.switchMode(newMode);
  }, [displayMode]);

  const STATUS_BAR_HEIGHT = 40;
  useEffect(() => {
    const visible = pageProgress !== null && !statusCollapsed;
    if (visible) {
      const original = document.documentElement.style.paddingTop;
      document.documentElement.style.paddingTop = `${STATUS_BAR_HEIGHT}px`;
      return () => { document.documentElement.style.paddingTop = original; };
    }
  }, [pageProgress !== null, statusCollapsed]);

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
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [mode]);

  const openPanelAt = useCallback((anchor: { x: number; y: number }) => {
    pendingAnchorRef.current = anchor;
    setMode('panel');
  }, []);

  const handlePanelHeaderMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.st-panel-close')) return;
    event.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const origin = rect
      ? { left: rect.left, top: rect.top }
      : panelPosition;
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
  }, [panelPosition]);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      (res: MessageResponse<AppSettings>) => {
        if (res.success) settingsRef.current = res.data;
      },
    );

    onReady({
      showTrigger(text, pos) {
        if (pageTranslatedRef.current) return;
        selectedTextRef.current = text;
        anchorRef.current = pos;
        setSelectedText(text);
        setPosition(pos);
        setMode('trigger');
        setTranslation('');
        setError(null);
        setCopied(false);
      },
      translateNow(text) {
        if (pageTranslatedRef.current) return;
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
        setSelectedText(t);
        anchorRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
        setPosition(anchorRef.current);
        setTranslation('');
        setError(null);
        setCopied(false);
        queueMicrotask(() => void handleTranslateRef.current());
      },
      hide() {
        setMode('hidden');
      },
      isPageTranslationActive() {
        return pageTranslatedRef.current;
      },
      getPageTranslatePhase() {
        return computePageTranslatePhase();
      },
      startPageTranslation,
      stopPageTranslation,
      restorePageTranslation,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPageTranslation, stopPageTranslation, restorePageTranslation]);

  const handleTranslate = async () => {
    const text = selectedTextRef.current;
    if (!text || pageTranslatedRef.current) return;

    const targetLang = settingsRef.current?.defaultTargetLang ?? 'zh';
    const sourceLang = settingsRef.current?.defaultSourceLang ?? 'auto';

    openPanelAt(anchorRef.current);
    setLoading(true);
    setError(null);

    try {
      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE',
        payload: { text, sourceLang, targetLang },
      });

      if (response?.success) {
        setTranslation(response.data.translated);
      } else {
        setError(response?.error || 'Translation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setLoading(false);
    }
  };

  handleTranslateRef.current = handleTranslate;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(translation);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {/* Page translation status bar */}
      <StatusBar
        progress={pageProgress}
        running={pageRunning}
        displayMode={displayMode}
        collapsed={statusCollapsed}
        onStop={stopPageTranslation}
        onRestore={restorePageTranslation}
        onToggleMode={toggleDisplayMode}
        onToggleCollapse={() => setStatusCollapsed((c) => !c)}
      />

      {/* Selection trigger button */}
      {mode === 'trigger' && (
        <button
          onClick={handleTranslate}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
          className="st-trigger-btn"
          title="Translate"
        >
          <AppLogo className="st-trigger-icon" />
        </button>
      )}

      {/* Floating translation panel */}
      {mode === 'panel' && (
        <div
          ref={panelRef}
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
            <span className="st-panel-title">LinguaLens</span>
            <button onClick={() => setMode('hidden')} className="st-panel-close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div className="st-panel-body">
            {loading && (
              <div className="st-loading">
                <span className="st-dot" /><span className="st-dot" /><span className="st-dot" />
                <span style={{ marginLeft: 6 }}>Translating…</span>
              </div>
            )}
            {error && <div className="st-error">{error}</div>}
            {!loading && !error && translation && (
              <div className="st-translation">
                <p>{translation}</p>
              </div>
            )}
          </div>
          {!loading && !error && translation && (
            <div className="st-panel-footer">
              <button onClick={handleCopy} className="st-copy-btn" title="Copy translation">
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
