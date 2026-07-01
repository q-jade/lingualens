import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, TranslateResult, MessageResponse } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { getTranslatorLanguages, setTranslatorLanguages, subscribeTranslatorLanguages } from '../../shared/translator-languages';

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
  const [copied, setCopied] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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

    return subscribeTranslatorLanguages((langs) => {
      setSourceLang(langs.sourceLang);
      setTargetLang(langs.targetLang);
    });
  }, []);

  const handleTranslate = async () => {
    const text = sourceText.trim();
    if (!text || !langsReady) return;

    setLoading(true);
    setError(null);
    setTranslation('');

    const res: MessageResponse<TranslateResult> = await browser.runtime.sendMessage({
      type: 'TRANSLATE',
      payload: { text, sourceLang, targetLang },
    });

    setLoading(false);
    if (res.success) {
      setTranslation(res.data.translated);
      const entry: HistoryEntry = {
        id: Date.now(),
        source: text,
        translated: res.data.translated,
        targetLang,
        provider: res.data.provider,
        timestamp: Date.now(),
      };
      const deduplicated = history.filter(
        (h) => h.source !== text || h.targetLang !== targetLang || h.provider !== res.data.provider,
      );
      const updated = [entry, ...deduplicated].slice(0, 50);
      setHistory(updated);
      browser.storage.local.set({ translationHistory: updated });
    } else {
      setError(translateError(res.error));
    }
  };

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

  const providerName =
    settings?.providers.find((p) => p.id === settings.defaultProvider)?.name ?? '—';

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Language bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50">
        <select
          value={sourceLang ?? ''}
          disabled={!langsReady}
          onChange={(e) => {
            const next = e.target.value;
            setSourceLang(next);
            if (targetLang) void setTranslatorLanguages({ sourceLang: next, targetLang });
          }}
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400
                     disabled:opacity-60 disabled:cursor-wait"
        >
          {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <button
          onClick={swapLanguages}
          disabled={!langsReady}
          className="p-1 text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('sidepanel.swapLanguages')}
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
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400
                     disabled:opacity-60 disabled:cursor-wait"
        >
          {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

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
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-300">{t('sidepanel.chars', { count: sourceText.length })}</span>
                  {sourceText && (
                    <button
                      onClick={() => {
                        setSourceText('');
                        setTranslation('');
                        setError(null);
                        setCopied(false);
                        textareaRef.current?.focus();
                      }}
                      className="text-[10px] text-gray-300 hover:text-red-400 transition-colors"
                    >
                      {t('sidepanel.clear')}
                    </button>
                  )}
                </div>
                <button
                  onClick={handleTranslate}
                  disabled={loading || !sourceText.trim() || !langsReady}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium text-white
                             bg-gradient-to-r from-blue-500 to-indigo-500
                             hover:from-blue-600 hover:to-indigo-600
                             disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {loading
                    ? t('sidepanel.translating')
                    : `${t('sidepanel.translate')} ${/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'}↵`}
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
              {error && <div className="px-4 py-3 text-sm text-red-500 bg-red-50">{error}</div>}
              {!error && (
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      {t('sidepanel.translating')}
                    </div>
                  ) : translation ? (
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{translation}</p>
                  ) : (
                    <p className="text-sm text-gray-300">{t('sidepanel.translationPlaceholder')}</p>
                  )}
                </div>
              )}
              {translation && !loading && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(translation).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }).catch(() => { });
                  }}
                  className={`self-start mt-1 mb-2 px-4 text-xs ${copied ? 'text-green-500' : 'text-blue-500 hover:text-blue-600'}`}
                >
                  {copied ? '✓' : t('sidepanel.copy')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
        <span className="text-[11px] text-gray-400 truncate flex-1 min-w-0">{providerName}</span>
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
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
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
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600" title={t('sidepanel.backToTranslate')}>
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
          <p className="text-xs text-gray-400 truncate">{entry.source}</p>
          <p className="text-sm text-gray-800 truncate mt-0.5">{entry.translated}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-gray-300">{entry.provider}</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-300">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
