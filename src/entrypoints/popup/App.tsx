import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, TranslateResult, MessageResponse, SelectionTriggerMode, SelectionModifierKey } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { AppLogo } from '../../shared/AppLogo';
import { ModeIcon } from '../../shared/ModeIcon';
import { shortcutLabel } from '../../shared/shortcut';
import { getTranslatorLanguages, updateTranslatorLanguages } from '../../shared/translator-languages';
import { getLanguageName } from '../../shared/languages';
import { isTranslatableTabUrl } from '../../shared/translatable-tab';
import { ProviderPicker } from '../../shared/ProviderPicker';
import { CopyButton } from '../../shared/CopyButton';

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
  const [pageTranslatePhase, setPageTranslatePhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [pageTranslateSupported, setPageTranslateSupported] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the input as soon as the popup opens so the user can start typing immediately.
  useEffect(() => {
    textareaRef.current?.focus();
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
      payload: { text, sourceLang: 'auto', targetLang, applyAdditionalPrompt: true },
    });

    setLoading(false);
    if (res.success) {
      setResult(res.data.translated);
    } else {
      setError(translateError(res.error));
    }
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
    <div className="relative p-4 bg-white min-h-[200px]">
      {/* Brand accent bar */}
      <div
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-400 to-indigo-400"
      />
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
                     border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
          title={t('popup.sidePanelTitle')}
        >
          {t('popup.sidePanel')}
        </button>
      </div>

      {/* No-provider guidance */}
      {settings && settings.providers.length === 0 && (
        <div className="mb-2 p-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 flex items-center gap-2">
          <span className="flex-1">{t('popup.noProvider')}</span>
          <button
            type="button"
            onClick={() => browser.runtime.openOptionsPage()}
            className="font-medium text-amber-800 hover:underline shrink-0"
          >
            {t('popup.settings')}
          </button>
        </div>
      )}

      {/* Target language */}
      <select
        value={targetLang ?? ''}
        disabled={targetLang === null}
        onChange={(e) => {
          const next = e.target.value;
          setTargetLang(next);
          void updateTranslatorLanguages({ targetLang: next });
        }}
        className="input ll-select w-full mb-2"
      >
        {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => (
          <option key={lang.code} value={lang.code}>{lang.name}</option>
        ))}
      </select>

      {/* Input */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('popup.placeholder')}
        className="input w-full resize-none"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTranslate();
        }}
      />

      {/* Translate button */}
      <button
        onClick={handleTranslate}
        disabled={loading || !text.trim() || targetLang === null}
        className="ll-btn-primary w-full mt-2"
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <span className="ll-spinner-light" />
            {t('popup.translating')}
          </span>
        ) : `${t('popup.translate')} ${shortcutLabel('↵')}`}
      </button>

      {/* Error */}
      {error && (
        <div className="ll-error mt-2 p-2 text-xs rounded-lg">{error}</div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200/70">
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result}</p>
          <CopyButton key={result} text={result} label={t('popup.copy')} className="mt-1" />
        </div>
      )}

      {/* Selection mode quick-toggle & page translation */}
      {settings && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          {/* Page translate — uses the web-page language preference (defaultTargetLang) */}
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
            className={`w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border
                       ${!pageTranslateSupported
                ? 'border-gray-200 text-gray-400 opacity-50 cursor-not-allowed'
                : pageTranslatePhase === 'running'
                  ? 'll-warn'
                  : pageTranslatePhase === 'done'
                    ? 'll-success'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
          >
            {!pageTranslateSupported
              ? t('popup.notAvailable')
              : pageTranslatePhase === 'running'
                ? t('popup.stopPageTranslation')
                : pageTranslatePhase === 'done'
                  ? t('popup.restoreOriginalPage')
                  : t('popup.translatePageTo', { lang: getLanguageName(settings.defaultTargetLang) })}
          </button>
          <div className="flex items-center gap-2 mt-3 mb-1.5">
            <span className="text-[11px] font-medium text-gray-500">{t('popup.selectionMode')}</span>
          </div>
          <div className="flex items-center gap-1">
            {([
              { mode: 'icon' as SelectionTriggerMode, label: t('options.triggerModeIcon') },
              { mode: 'instant' as SelectionTriggerMode, label: t('options.triggerModeInstant') },
              { mode: 'modifier' as SelectionTriggerMode, label: t('options.triggerModeModifier') },
              { mode: 'off' as SelectionTriggerMode, label: t('options.triggerModeOff') },
            ]).map(({ mode: m, label }) => (
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
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-300'
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                  }`}
              >
                <span className="flex justify-center"><ModeIcon mode={m} /></span>
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
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-300'
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
        <ProviderPicker
          settings={settings}
          onChange={setDefaultProvider}
          triggerClassName="max-w-[180px]"
        />
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
