import { useState, useEffect, useRef } from 'react';
import type { AppSettings, TranslateResult, MessageResponse } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { AppLogo } from '../../shared/AppLogo';
import { getTranslatorLanguages, setTranslatorLanguages, subscribeTranslatorLanguages } from '../../shared/translator-languages';

interface HistoryEntry {
  id: number;
  source: string;
  translated: string;
  targetLang: string;
  provider: string;
  timestamp: number;
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('zh');
  const [sourceText, setSourceText] = useState('');
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      async (res: MessageResponse<AppSettings>) => {
        if (res.success) {
          setSettings(res.data);
          const langs = await getTranslatorLanguages({
            sourceLang: res.data.defaultSourceLang,
            targetLang: res.data.defaultTargetLang,
          });
          setSourceLang(langs.sourceLang);
          setTargetLang(langs.targetLang);
        }
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
    if (!text) return;

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
        source: text.slice(0, 200),
        translated: res.data.translated.slice(0, 200),
        targetLang,
        provider: res.data.provider,
        timestamp: Date.now(),
      };
      const updated = [entry, ...history].slice(0, 50);
      setHistory(updated);
      browser.storage.local.set({ translationHistory: updated });
    } else {
      setError(res.error);
    }
  };

  const swapLanguages = () => {
    if (sourceLang === 'auto') return;
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
    void setTranslatorLanguages({ sourceLang, targetLang: entry.targetLang });
    setShowHistory(false);
  };

  const providerName =
    settings?.providers.find((p) => p.id === settings.defaultProvider)?.name ?? '—';

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-500 to-indigo-500">
        <AppLogo className="w-6 h-6 shrink-0" />
        <h1 className="text-sm font-semibold text-white flex-1">LinguaLens</h1>
        <button onClick={() => setShowHistory(!showHistory)} className="text-white/80 hover:text-white" title="History">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" /><path d="M12 7v5l4 2" />
          </svg>
        </button>
      </div>

      {/* Language bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50">
        <select
          value={sourceLang}
          onChange={(e) => {
            const next = e.target.value;
            setSourceLang(next);
            void setTranslatorLanguages({ sourceLang: next, targetLang });
          }}
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <button onClick={swapLanguages} className="p-1 text-gray-400 hover:text-blue-500 transition-colors" title="Swap languages">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 16 4 4 4-4" /><path d="M11 20V4" /><path d="m17 8-4-4-4 4" /><path d="M13 4v16" />
          </svg>
        </button>
        <select
          value={targetLang}
          onChange={(e) => {
            const next = e.target.value;
            setTargetLang(next);
            void setTranslatorLanguages({ sourceLang, targetLang: next });
          }}
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showHistory ? (
          <HistoryPanel history={history} onSelect={loadHistoryEntry} onClear={() => { setHistory([]); browser.storage.local.remove('translationHistory'); }} />
        ) : (
          <>
            {/* Source */}
            <div className="flex-1 flex flex-col border-b border-gray-100 min-h-0">
              <textarea
                ref={textareaRef}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Enter text to translate…"
                className="flex-1 w-full px-4 py-3 text-sm resize-none focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTranslate();
                }}
              />
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-[10px] text-gray-300">{sourceText.length} chars</span>
                <button
                  onClick={handleTranslate}
                  disabled={loading || !sourceText.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium text-white
                             bg-gradient-to-r from-blue-500 to-indigo-500
                             hover:from-blue-600 hover:to-indigo-600
                             disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? 'Translating…' : 'Translate ⌘↵'}
                </button>
              </div>
            </div>

            {/* Translation result */}
            <div className="flex-1 flex flex-col min-h-0">
              {error && <div className="px-4 py-3 text-sm text-red-500 bg-red-50">{error}</div>}
              {!error && (
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      Translating…
                    </div>
                  ) : translation ? (
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{translation}</p>
                  ) : (
                    <p className="text-sm text-gray-300">Translation will appear here</p>
                  )}
                </div>
              )}
              {translation && !loading && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
                  <span className="text-[10px] text-gray-300">{providerName}</span>
                  <button onClick={() => navigator.clipboard.writeText(translation)} className="text-xs text-blue-500 hover:text-blue-600">Copy</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  onSelect,
  onClear,
}: {
  history: HistoryEntry[];
  onSelect: (e: HistoryEntry) => void;
  onClear: () => void;
}) {
  if (history.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">No translation history</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500">History ({history.length})</span>
        <button onClick={onClear} className="text-xs text-red-400 hover:text-red-500">Clear All</button>
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
