import { useState, useEffect } from 'react';
import type { AppSettings, TranslateResult, MessageResponse } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('zh');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      (res: MessageResponse<AppSettings>) => {
        if (res.success) {
          setSettings(res.data);
          setTargetLang(res.data.defaultTargetLang);
        }
      },
    );
  }, []);

  const handleTranslate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);

    const res: MessageResponse<TranslateResult> = await browser.runtime.sendMessage({
      type: 'TRANSLATE',
      payload: { text, sourceLang: 'auto', targetLang },
    });

    setLoading(false);
    if (res.success) {
      setResult(res.data.translated);
    } else {
      setError(res.error);
    }
  };

  const providerName =
    settings?.providers.find((p) => p.id === settings.defaultProvider)?.name ?? '—';

  return (
    <div className="p-4 bg-white min-h-[200px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
          </svg>
        </div>
        <h1 className="text-base font-semibold text-gray-800">LinguaLens</h1>
      </div>

      {/* Target language */}
      <select
        value={targetLang}
        onChange={(e) => setTargetLang(e.target.value)}
        className="w-full mb-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm
                   bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
      >
        {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => (
          <option key={lang.code} value={lang.code}>{lang.name}</option>
        ))}
      </select>

      {/* Input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text to translate…"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none
                   focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTranslate();
        }}
      />

      {/* Translate button */}
      <button
        onClick={handleTranslate}
        disabled={loading || !text.trim()}
        className="w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white
                   bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {loading ? 'Translating…' : 'Translate'}
      </button>

      {/* Error */}
      {error && (
        <div className="mt-2 p-2 bg-red-50 text-red-600 text-xs rounded-lg">{error}</div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result}</p>
          <button
            onClick={() => navigator.clipboard.writeText(result)}
            className="mt-1 text-xs text-blue-500 hover:text-blue-600"
          >
            Copy
          </button>
        </div>
      )}

      {/* Page translate */}
      <button
        onClick={async () => {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return;
          try {
            const res = await browser.runtime.sendMessage({
              type: 'PAGE_TRANSLATE_PAGE',
              payload: { tabId: tab.id },
            });
            if (res?.success) {
              window.close();
            } else {
              setError(res?.error || 'Cannot reach this page.');
            }
          } catch {
            setError('Cannot reach this page. Reload the page and try again.');
          }
        }}
        className="w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium
                   border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Translate This Page
      </button>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[11px] text-gray-400 truncate max-w-[180px]">{providerName}</span>
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-xs text-blue-500 hover:text-blue-600 font-medium"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
