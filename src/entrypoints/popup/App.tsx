import { useState, useEffect } from 'react';
import type { AppSettings, TranslateResult, MessageResponse } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { AppLogo } from '../../shared/AppLogo';

/** Chrome 114+ only; must run from a user gesture (e.g. click). */
async function openExtensionSidePanel(): Promise<string | null> {
  type ChromeSidePanel = {
    windows: { getCurrent: () => Promise<{ id?: number }> };
    sidePanel: { open: (opts: { windowId: number }) => Promise<void> };
  };
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeSidePanel }).chrome;
  if (!chromeApi?.sidePanel?.open) {
    return 'Side panel is not available in this browser. Try recent Chrome or Edge (Chromium).';
  }
  const win = await chromeApi.windows.getCurrent();
  if (win.id == null) return 'Could not detect the browser window.';
  try {
    await chromeApi.sidePanel.open({ windowId: win.id });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not open side panel.';
  }
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('zh');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageTranslateActive, setPageTranslateActive] = useState(false);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      (res: MessageResponse<AppSettings>) => {
        if (res.success) {
          setSettings(res.data);
          setTargetLang(res.data.defaultTargetLang);
        }
      },
    );

    browser.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!tab?.id) return;
        return browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_STATUS' });
      })
      .then((res: { active?: boolean } | undefined) => {
        setPageTranslateActive(Boolean(res?.active));
      })
      .catch(() => {
        setPageTranslateActive(false);
      });
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
      {/* Header — side panel control here so it stays visible without scrolling the popup */}
      <div className="flex items-center gap-2 mb-3">
        <AppLogo className="w-7 h-7 shrink-0" />
        <h1 className="text-base font-semibold text-gray-800 flex-1 min-w-0 truncate">LinguaLens</h1>
        <button
          type="button"
          onClick={async () => {
            const errMsg = await openExtensionSidePanel();
            if (errMsg) {
              setError(errMsg);
              return;
            }
            window.close();
          }}
          className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide
                     border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100
                     focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
          title="Opens the full translator in Chrome’s side panel (Chrome 114+)"
        >
          Side panel
        </button>
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
          if (pageTranslateActive) return;
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
              if (res?.error === 'Page translation is already active.') setPageTranslateActive(true);
              setError(res?.error || 'Cannot reach this page.');
            }
          } catch {
            setError('Cannot reach this page. Reload the page and try again.');
          }
        }}
        disabled={pageTranslateActive}
        className="w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium
                   border border-gray-200 text-gray-700 hover:bg-gray-50
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pageTranslateActive ? 'Page Already Translated' : 'Translate This Page'}
      </button>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[11px] text-gray-400 truncate max-w-[180px]">{providerName}</span>
        <button
          type="button"
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-xs text-blue-500 hover:text-blue-600 font-medium shrink-0"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
