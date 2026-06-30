import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, TranslateResult, MessageResponse, SelectionTriggerMode, SelectionModifierKey } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { AppLogo } from '../../shared/AppLogo';
import { getTranslatorLanguages, updateTranslatorLanguages } from '../../shared/translator-languages';
import { isTranslatableTabUrl } from '../../shared/translatable-tab';

async function openExtensionSidePanel(): Promise<string | null> {
  type ChromeSidePanel = {
    windows: { getCurrent: () => Promise<{ id?: number }> };
    sidePanel: { open: (opts: { windowId: number }) => Promise<void> };
  };
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeSidePanel }).chrome;
  if (!chromeApi?.sidePanel?.open) {
    return 'sidePanelNotAvailable';
  }
  const win = await chromeApi.windows.getCurrent();
  if (win.id == null) return 'cannotDetectWindow';
  try {
    await chromeApi.sidePanel.open({ windowId: win.id });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'cannotOpenSidePanel';
  }
}

const ERROR_KEYS: Record<string, string> = {
  NO_PROVIDER: 'popup.noProvider',
  TRANSLATION_FAILED: 'popup.translationFailed',
  PAGE_TRANSLATE_UNAVAILABLE: 'popup.pageTranslateUnavailable',
};

export function App() {
  const { t } = useTranslation();

  const translateError = (err: string | undefined): string =>
    err ? (ERROR_KEYS[err] ? t(ERROR_KEYS[err]) : err) : t('popup.translationFailed');

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pageTranslatePhase, setPageTranslatePhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [pageTranslateSupported, setPageTranslateSupported] = useState(true);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      async (res: MessageResponse<AppSettings>) => {
        if (res.success) setSettings(res.data);
        const langs = await getTranslatorLanguages(
          res.success
            ? { sourceLang: res.data.defaultSourceLang, targetLang: res.data.defaultTargetLang }
            : undefined,
        );
        setTargetLang(langs.targetLang);
      },
    );

    browser.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const supported = isTranslatableTabUrl(tab?.url);
        setPageTranslateSupported(supported);
        if (!tab?.id || !supported) return;
        return browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_STATUS' });
      })
      .then((res: { phase?: string } | undefined) => {
        const phase = res?.phase;
        if (phase === 'running' || phase === 'done') setPageTranslatePhase(phase);
      })
      .catch(() => { });
  }, []);

  const handleTranslate = async () => {
    if (!text.trim() || !targetLang) return;
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
      setError(translateError(res.error));
    }
  };

  const providerName =
    settings?.providers.find((p) => p.id === settings.defaultProvider)?.name ?? '—';

  return (
    <div className="p-4 bg-white min-h-[200px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <AppLogo className="w-7 h-7 shrink-0" />
        <h1 className="text-base font-semibold text-gray-800 flex-1 min-w-0 truncate">LinguaLens</h1>
        <button
          type="button"
          onClick={async () => {
            const errKey = await openExtensionSidePanel();
            if (errKey) {
              setError(t(`popup.${errKey}`));
              return;
            }
            window.close();
          }}
          className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide
                     border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100
                     focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
          title={t('popup.sidePanelTitle')}
        >
          {t('popup.sidePanel')}
        </button>
      </div>

      {/* Target language */}
      <select
        value={targetLang ?? ''}
        disabled={targetLang === null}
        onChange={(e) => {
          const next = e.target.value;
          setTargetLang(next);
          void updateTranslatorLanguages({ targetLang: next });
        }}
        className="w-full mb-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm
                   bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400
                   disabled:opacity-60 disabled:cursor-wait"
      >
        {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => (
          <option key={lang.code} value={lang.code}>{lang.name}</option>
        ))}
      </select>

      {/* Input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('popup.placeholder')}
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
        disabled={loading || !text.trim() || targetLang === null}
        className="w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white
                   bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {loading
          ? t('popup.translating')
          : `${t('popup.translate')} ${/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'}↵`}
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
            onClick={() => {
              navigator.clipboard.writeText(result).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => { });
            }}
            className={`mt-1 text-xs ${copied ? 'text-green-500' : 'text-blue-500 hover:text-blue-600'}`}
          >
            {copied ? '✓' : t('popup.copy')}
          </button>
        </div>
      )}

      {/* Page translate */}
      <button
        onClick={async () => {
          if (!pageTranslateSupported) return;
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id || !isTranslatableTabUrl(tab.url)) {
            setPageTranslateSupported(false);
            setError(t('popup.pageTranslateUnavailable'));
            return;
          }
          try {
            if (pageTranslatePhase === 'running') {
              await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_STOP' });
              setPageTranslatePhase('done');
            } else if (pageTranslatePhase === 'done') {
              await browser.tabs.sendMessage(tab.id, { type: 'PAGE_TRANSLATE_RESTORE' });
              setPageTranslatePhase('idle');
            } else {
              const res = await browser.runtime.sendMessage({
                type: 'PAGE_TRANSLATE_PAGE',
                payload: { tabId: tab.id },
              });
              if (res?.success) {
                window.close();
              } else {
                if (res?.error === 'PAGE_TRANSLATE_ALREADY_ACTIVE') setPageTranslatePhase('running');
                setError(t('popup.pageTranslateUnavailable'));
              }
            }
          } catch {
            setError(t('popup.pageTranslateUnavailable'));
          }
        }}
        disabled={!pageTranslateSupported}
        title={!pageTranslateSupported ? t('popup.pageTranslateUnavailable') : undefined}
        className={`w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                   ${!pageTranslateSupported
            ? 'border border-gray-200 text-gray-400 opacity-50 cursor-not-allowed'
            : pageTranslatePhase === 'running'
              ? 'border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
              : pageTranslatePhase === 'done'
                ? 'border border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
      >
        {!pageTranslateSupported
          ? t('popup.notAvailable')
          : pageTranslatePhase === 'running'
            ? t('popup.stopPageTranslation')
            : pageTranslatePhase === 'done'
              ? t('popup.restoreOriginalPage')
              : t('popup.translatePage')}
      </button>

      {/* Selection mode quick-toggle */}
      {settings && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-medium text-gray-500">{t('popup.selectionMode')}</span>
          </div>
          <div className="flex items-center gap-1">
            {([
              { mode: 'icon' as SelectionTriggerMode, label: t('options.triggerModeIcon'), icon: '🔘' },
              { mode: 'instant' as SelectionTriggerMode, label: t('options.triggerModeInstant'), icon: '⚡' },
              { mode: 'modifier' as SelectionTriggerMode, label: t('options.triggerModeModifier'), icon: '⌨' },
              { mode: 'off' as SelectionTriggerMode, label: t('options.triggerModeOff'), icon: '○' },
            ]).map(({ mode: m, label, icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setSettings((s) => s ? { ...s, selectionTriggerMode: m } : s);
                  void browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { selectionTriggerMode: m } });
                  browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                    if (tab?.id) {
                      browser.tabs.sendMessage(tab.id, {
                        type: 'SELECTION_MODE_CHANGED',
                        payload: { mode: m, modifierKey: settings.selectionModifierKey },
                      }).catch(() => { });
                    }
                  });
                }}
                title={label}
                className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
                  ${settings.selectionTriggerMode === m
                    ? 'bg-blue-100 text-blue-700 border border-blue-300'
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                  }`}
              >
                <span className="block text-center">{icon}</span>
                <span className="block text-center text-[10px] leading-tight mt-0.5 truncate">{label}</span>
              </button>
            ))}
          </div>
          {settings.selectionTriggerMode === 'modifier' && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-gray-400">{t('options.selectionModifierKey')}:</span>
              {(['ctrl', 'alt', 'shift'] as SelectionModifierKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setSettings((s) => s ? { ...s, selectionModifierKey: k } : s);
                    void browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { selectionModifierKey: k } });
                    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                      if (tab?.id) {
                        browser.tabs.sendMessage(tab.id, {
                          type: 'SELECTION_MODE_CHANGED',
                          payload: { mode: settings.selectionTriggerMode, modifierKey: k },
                        }).catch(() => { });
                      }
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors
                    ${settings.selectionModifierKey === k
                      ? 'bg-blue-100 text-blue-700 border border-blue-300'
                      : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                    }`}
                >
                  {k}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[11px] text-gray-400 truncate max-w-[180px]">{providerName}</span>
        <button
          type="button"
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-xs text-blue-500 hover:text-blue-600 font-medium shrink-0"
        >
          {t('popup.settings')}
        </button>
      </div>
    </div>
  );
}
