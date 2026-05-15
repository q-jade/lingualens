import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppSettings, MessageResponse } from '../../shared/types';
import { PageTranslateEngine, type TranslateProgress, type DisplayMode } from '../../content/page-translator/engine';
import { StatusBar } from '../../content/page-translator/StatusBar';

export interface ContentAppHandle {
  showTrigger: (text: string, position: { x: number; y: number }) => void;
  /** Open panel and translate immediately (e.g. context menu — no floating trigger step). */
  translateNow: (text: string) => void;
  hide: () => void;
  isPageTranslationActive: () => boolean;
  startPageTranslation: () => void;
  stopPageTranslation: () => void;
  restorePageTranslation: () => void;
}

interface Props {
  onReady: (handle: ContentAppHandle) => void;
}

type Mode = 'hidden' | 'trigger' | 'panel';

/** Matches `.st-panel` width + horizontal gutter used in `innerWidth - outerWidth`. */
const SELECTION_PANEL_OUTER_W = 340;
const SELECTION_PANEL_MAX_H = 400;
const SELECTION_PANEL_VIEW_MARGIN = 8;

/** `top` is the bottom edge of the panel (`translateY(-100%)`); keep the full box inside the viewport. */
function clampSelectionPanelTop(anchorY: number, innerHeight: number): number {
  const m = SELECTION_PANEL_VIEW_MARGIN;
  const maxPanelH = Math.min(SELECTION_PANEL_MAX_H, Math.max(0, innerHeight - 2 * m));
  const preferredTop = Math.max(anchorY - 4, m);
  const minTop = m + maxPanelH;
  const maxTop = innerHeight - m;
  return Math.min(Math.max(preferredTop, minTop), maxTop);
}

export function ContentApp({ onReady }: Props) {
  const [mode, setMode] = useState<Mode>('hidden');
  const [position, setPosition] = useState({ x: 0, y: 0 });
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
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));

  const selectedTextRef = useRef('');
  const settingsRef = useRef<AppSettings | null>(null);
  const engineRef = useRef(new PageTranslateEngine());
  const pageTranslatedRef = useRef(false);
  const handleTranslateRef = useRef<() => Promise<void>>(async () => {});

  const startPageTranslation = useCallback(async () => {
    const settings = settingsRef.current;
    const engine = engineRef.current;
    if (engine.running || pageTranslatedRef.current) return;

    pageTranslatedRef.current = true;
    browser.runtime.sendMessage({
      type: 'PAGE_TRANSLATE_STATE_CHANGED',
      payload: { active: true },
    }).catch(() => {});
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
    }
  }, [displayMode]);

  const stopPageTranslation = useCallback(() => {
    engineRef.current.stop();
    setPageRunning(false);
  }, []);

  const restorePageTranslation = useCallback(() => {
    engineRef.current.restore();
    pageTranslatedRef.current = false;
    browser.runtime.sendMessage({
      type: 'PAGE_TRANSLATE_STATE_CHANGED',
      payload: { active: false },
    }).catch(() => {});
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

  useEffect(() => {
    if (mode !== 'panel') return;
    const sync = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [mode]);

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
        selectedTextRef.current = t;
        setSelectedText(t);
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
        setTranslation('');
        setError(null);
        setCopied(false);
        setMode('panel');
        queueMicrotask(() => void handleTranslateRef.current());
      },
      hide() {
        setMode('hidden');
      },
      isPageTranslationActive() {
        return pageTranslatedRef.current;
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

    setMode('panel');
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
            left: position.x + 6,
            top: position.y - 4,
            transform: 'translateY(-100%)',
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
          className="st-trigger-btn"
          title="Translate"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
          </svg>
        </button>
      )}

      {/* Floating translation panel */}
      {mode === 'panel' && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(position.x + 6, viewport.w - SELECTION_PANEL_OUTER_W),
            top: clampSelectionPanelTop(position.y, viewport.h),
            transform: 'translateY(-100%)',
            zIndex: 2147483647,
            pointerEvents: 'auto',
            backgroundColor: '#ffffff',
            isolation: 'isolate',
          }}
          className="st-panel"
        >
          <div className="st-panel-header">
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
        </div>
      )}
    </>
  );
}
