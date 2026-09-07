import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, TranslateResult, MessageResponse, RoutedSidepanelSelection } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { getTranslatorLanguages, setTranslatorLanguages, subscribeTranslatorLanguages } from '../../shared/translator-languages';
import { ProviderPicker } from '../../shared/ProviderPicker';
import { CopyButton } from '../../shared/CopyButton';
import { shortcutLabel } from '../../shared/shortcut';

interface HistoryEntry {
  id: number;
  source: string;
  translated: string;
  targetLang: string;
  provider: string;
  timestamp: number;
}

const ERROR_KEYS: Record<string, string> = {
  NO_PROVIDER: 'sidepanel.noProvider',
  TRANSLATION_FAILED: 'sidepanel.translationFailed',
};

export function App() {
  const { t } = useTranslation();

  const translateError = (err: string | undefined): string =>
    err ? (ERROR_KEYS[err] ? t(ERROR_KEYS[err]) : err) : t('sidepanel.translationFailed');

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sourceLang, setSourceLang] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<string | null>(null);
  const langsReady = sourceLang !== null && targetLang !== null;
  const [sourceText, setSourceText] = useState('');
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Latest-state mirrors so the one-time runtime message listener can translate
  // selections that arrive from the background at any point.
  const sourceLangRef = useRef<string | null>(null);
  const targetLangRef = useRef<string | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  sourceLangRef.current = sourceLang;
  targetLangRef.current = targetLang;
  historyRef.current = history;

  // Focus the input as soon as the panel opens so the user can start typing immediately.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(0.8, Math.max(0.2, (ev.clientY - rect.top) / rect.height));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      async (res: MessageResponse<AppSettings>) => {
        if (res.success) setSettings(res.data);
        const langs = await getTranslatorLanguages(
          res.success
            ? { sourceLang: res.data.defaultSourceLang, targetLang: res.data.defaultTargetLang }
            : undefined,
        );
        setSourceLang(langs.sourceLang);
        setTargetLang(langs.targetLang);
      },
    );
    browser.storage.local.get('translationHistory').then((result) => {
      if (result.translationHistory) setHistory(result.translationHistory as HistoryEntry[]);
    });

    const onStorageChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes.settings) {
        const next = changes.settings.newValue as AppSettings | undefined;
        if (next) setSettings(next);
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    const unsubLangs = subscribeTranslatorLanguages((langs) => {
      setSourceLang(langs.sourceLang);
      setTargetLang(langs.targetLang);
    });

    return () => {
      browser.storage.onChanged.removeListener(onStorageChanged);
      unsubLangs();
    };
  }, []);

  const translateText = async (
    text: string,
    explicitSourceLang?: string,
    explicitTargetLang?: string,
  ) => {
    const trimmed = text.trim();
    const srcLang = explicitSourceLang || sourceLangRef.current;
    const dstLang = explicitTargetLang || targetLangRef.current;
    if (!trimmed || !srcLang || !dstLang) return;

    setLoading(true);
    setError(null);
    setTranslation('');

    const res: MessageResponse<TranslateResult> = await browser.runtime.sendMessage({
      type: 'TRANSLATE',
      payload: { text: trimmed, sourceLang: srcLang, targetLang: dstLang },
    });

    setLoading(false);
    if (res.success) {
      setTranslation(res.data.translated);
      const entry: HistoryEntry = {
        id: Date.now(),
        source: trimmed,
        translated: res.data.translated,
        targetLang: dstLang,
        provider: res.data.provider,
        timestamp: Date.now(),
      };
      const deduplicated = historyRef.current.filter(
        (h) => h.source !== trimmed || h.targetLang !== dstLang || h.provider !== res.data.provider,
      );
      const updated = [entry, ...deduplicated].slice(0, 50);
      setHistory(updated);
      try {
        await browser.storage.local.set({ translationHistory: updated });
      } catch (err) {
        if (err instanceof Error && /quota/i.test(err.message)) {
          // Quota exceeded — keep only the most recent half
          const trimmedHistory = updated.slice(0, Math.max(1, Math.floor(updated.length / 2)));
          setHistory(trimmedHistory);
          try {
            await browser.storage.local.set({ translationHistory: trimmedHistory });
          } catch {
            // Give up — in-memory history still works this session
          }
        }
      }
    } else {
      setError(translateError(res.error));
    }
  };

  const handleTranslate = () => void translateText(sourceText);

  // Selection routed from the background but languages not loaded yet — flush it
  // once the pair is known so the routed text always gets translated.
  const pendingRouteRef = useRef<string | null>(null);

  /** Fill the input with a routed selection; translate once languages are known. */
  const routeSelectionToInput = (text: string, srcLang?: string, dstLang?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSourceText(trimmed);
    // Adopt the page-translation language pair for this routed selection so
    // the result matches what the page itself would have translated to.
    if (srcLang) setSourceLang(srcLang);
    if (dstLang) setTargetLang(dstLang);
    textareaRef.current?.focus();
    if ((srcLang || sourceLangRef.current) && (dstLang || targetLangRef.current)) {
      void translateText(trimmed, srcLang, dstLang);
    } else {
      pendingRouteRef.current = trimmed;
    }
  };

  useEffect(() => {
    if (sourceLang === null || targetLang === null) return;
    const pending = pendingRouteRef.current;
    if (!pending) return;
    pendingRouteRef.current = null;
    void translateText(pending);
  }, [sourceLang, targetLang]);

  // Selections routed from the background on pages where content scripts cannot
  // run (e.g. the browser PDF viewer): fill the input and translate immediately.
  useEffect(() => {
    const onMessage = (
      message: Record<string, unknown>,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (message?.type !== 'TRANSLATE_SELECTION_VIA_SIDEPANEL') return;
      const payload = message.payload as {
        text?: string;
        sourceLang?: string;
        targetLang?: string;
      };
      const text = (payload?.text ?? '').trim();
      if (text) routeSelectionToInput(text, payload?.sourceLang, payload?.targetLang);
      sendResponse({ success: true });
    };
    browser.runtime.onMessage.addListener(onMessage);

    // Pull a selection that was routed here while this panel was still loading.
    browser.runtime
      .sendMessage({ type: 'SIDEPANEL_READY' })
      .then((res: MessageResponse<RoutedSidepanelSelection | null> | undefined) => {
        const data = res?.success ? res.data : null;
        if (data?.text) routeSelectionToInput(data.text, data.sourceLang, data.targetLang);
      })
      .catch(() => {});

    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  const swapLanguages = () => {
    if (!langsReady || sourceLang === 'auto') return;
    const nextSource = targetLang;
    const nextTarget = sourceLang;
    setSourceLang(nextSource);
    setTargetLang(nextTarget);
    setSourceText(translation);
    setTranslation(sourceText);
    void setTranslatorLanguages({ sourceLang: nextSource, targetLang: nextTarget });
  };

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setSourceText(entry.source);
    setTranslation(entry.translated);
    setTargetLang(entry.targetLang);
    void setTranslatorLanguages({
      sourceLang: sourceLang ?? 'auto',
      targetLang: entry.targetLang,
    });
    setShowHistory(false);
  };

  const setDefaultProvider = (providerId: string) => {
    if (!settings) return;
    const nextFallbackProviders = settings.fallbackProviders.filter((id) => id !== providerId);
    setSettings({
      ...settings,
      defaultProvider: providerId,
      fallbackProviders: nextFallbackProviders,
    });
    void browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { defaultProvider: providerId, fallbackProviders: nextFallbackProviders },
    });
  };

  return (
    <div className="relative flex flex-col h-full bg-white">
      {/* Brand accent bar */}
      <div
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-blue-500 to-indigo-500"
      />
      {/* Language bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50 min-w-0">
        <select
          value={sourceLang ?? ''}
          disabled={!langsReady}
          onChange={(e) => {
            const next = e.target.value;
            setSourceLang(next);
            if (targetLang) void setTranslatorLanguages({ sourceLang: next, targetLang });
          }}
          className="input ll-select flex-1 min-w-0"
        >
          {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <button
          onClick={swapLanguages}
          disabled={!langsReady}
          className="p-1 text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('sidepanel.swapLanguages')}
          aria-label={t('sidepanel.swapLanguages')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 16 4 4 4-4" /><path d="M11 20V4" /><path d="m17 8-4-4-4 4" /><path d="M13 4v16" />
          </svg>
        </button>
        <select
          value={targetLang ?? ''}
          disabled={!langsReady}
          onChange={(e) => {
            const next = e.target.value;
            setTargetLang(next);
            if (sourceLang) void setTranslatorLanguages({ sourceLang, targetLang: next });
          }}
          className="input ll-select flex-1 min-w-0"
        >
          {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      {/* No-provider guidance */}
      {settings && settings.providers.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-center gap-2">
          <span className="flex-1">{t('sidepanel.noProvider')}</span>
          <button
            type="button"
            onClick={() => browser.runtime.openOptionsPage()}
            className="font-medium text-amber-800 hover:underline shrink-0"
          >
            {t('sidepanel.settings')}
          </button>
        </div>
      )}

      {/* Main content */}
      <div ref={contentRef} className="flex-1 flex flex-col overflow-hidden">
        {showHistory ? (
          <HistoryPanel history={history} onSelect={loadHistoryEntry} onClear={() => { setHistory([]); browser.storage.local.remove('translationHistory'); }} onBack={() => setShowHistory(false)} />
        ) : (
          <>
            {/* Source */}
            <div className="flex flex-col min-h-0" style={{ flex: `${splitRatio} 1 0%` }}>
              <textarea
                ref={textareaRef}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder={t('sidepanel.placeholder')}
                className="flex-1 w-full px-4 py-3 text-sm resize-none focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTranslate();
                }}
              />
              <div className="flex items-center justify-between gap-2 px-4 py-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-gray-400">{t('sidepanel.chars', { count: sourceText.length })}</span>
                  {sourceText && (
                    <button
                      onClick={() => {
                        setSourceText('');
                        setTranslation('');
                        setError(null);
                        textareaRef.current?.focus();
                      }}
                      className="text-[10px] text-gray-400 hover:text-red-400 transition-colors"
                    >
                      {t('sidepanel.clear')}
                    </button>
                  )}
                </div>
                <button
                  onClick={handleTranslate}
                  disabled={loading || !sourceText.trim() || !langsReady}
                  className="ll-btn-primary ll-btn-sm shrink-0"
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <span className="ll-spinner-light" />
                      {t('sidepanel.translating')}
                    </span>
                  ) : `${t('sidepanel.translate')} ${shortcutLabel('↵')}`}
                </button>
              </div>
            </div>

            {/* Draggable divider */}
            <div
              onMouseDown={onDividerMouseDown}
              className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200 transition-colors flex items-center justify-center"
            >
              <div className="w-8 h-0.5 rounded-full bg-gray-300" />
            </div>

            {/* Translation result */}
            <div className="flex flex-col min-h-0" style={{ flex: `${1 - splitRatio} 1 0%` }}>
              {error && <div className="ll-error px-4 py-3 text-sm">{error}</div>}
              {!error && (
                <div className="flex-1 overflow-y-auto px-4 py-3 bg-gray-50/60">
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="ll-spinner" />
                      {t('sidepanel.translating')}
                    </div>
                  ) : translation ? (
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{translation}</p>
                  ) : (
                    <p className="text-sm text-gray-400">{t('sidepanel.translationPlaceholder')}</p>
                  )}
                </div>
              )}
              {translation && !loading && (
                <CopyButton
                  key={translation}
                  text={translation}
                  label={t('sidepanel.copy')}
                  className="self-start mt-1 mb-2 px-4"
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
        <div className="min-w-0 flex-1">
          <ProviderPicker
            settings={settings}
            onChange={setDefaultProvider}
            triggerClassName="max-w-full"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`text-xs font-medium ${showHistory ? 'text-blue-600' : 'text-gray-400 hover:text-blue-500'}`}
          >
            {t('sidepanel.history')}
          </button>
          <button
            onClick={() => browser.runtime.openOptionsPage()}
            className="text-xs text-gray-400 hover:text-blue-500 font-medium"
          >
            {t('sidepanel.settings')}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  onSelect,
  onClear,
  onBack,
}: {
  history: HistoryEntry[];
  onSelect: (e: HistoryEntry) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  if (history.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <svg className="w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
        <p className="text-sm text-gray-400">{t('sidepanel.noHistory')}</p>
        <button onClick={onBack} className="text-xs text-blue-500 hover:text-blue-600">
          ← {t('sidepanel.backToTranslate')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600" title={t('sidepanel.backToTranslate')} aria-label={t('sidepanel.backToTranslate')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="text-xs font-medium text-gray-500">{t('sidepanel.historyCount', { count: history.length })}</span>
        </div>
        <button onClick={onClear} className="text-xs text-red-400 hover:text-red-500">{t('sidepanel.clearAll')}</button>
      </div>
      {history.map((entry) => (
        <div
          key={entry.id}
          onClick={() => onSelect(entry)}
          className="px-4 py-3 border-b border-gray-50 hover:bg-blue-50/50 cursor-pointer transition-colors"
        >
          <p className="ll-hint truncate">{entry.source}</p>
          <p className="text-sm text-gray-800 truncate mt-0.5">{entry.translated}</p>
          <div className="flex items-center gap-2 mt-1 min-w-0">
            {(() => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === entry.targetLang);
              return lang ? <span className="ll-badge ll-badge-brand shrink-0">{lang.name}</span> : null;
            })()}
            <span className="text-[10px] text-gray-400 shrink-0">{entry.provider}</span>
            <span className="text-[10px] text-gray-400 shrink-0">·</span>
            <span className="text-[10px] text-gray-400 truncate">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
