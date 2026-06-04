import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, ProviderConfig, MessageResponse, ChunkingMode } from '../../shared/types';
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES, PROVIDER_PRESETS } from '../../shared/constants';
import { clearOnboardingPending, isOnboardingPending } from '../../shared/onboarding';
import { isLlmProvider } from '../../providers/thinking';
import { AppLogo } from '../../shared/AppLogo';
import { AVAILABLE_UI_LANGUAGES, setUILanguage, getUILanguage } from '../../shared/i18n';

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [uiLang, setUiLang] = useState(getUILanguage());
  const welcomeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isOnboardingPending().then(setShowWelcome);
  }, []);

  useEffect(() => {
    if (showWelcome) {
      welcomeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showWelcome]);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      (res: MessageResponse<AppSettings>) => {
        if (res.success) {
          setSettings(res.data);
          if (res.data.providers.length > 0) {
            setExpandedProvider(res.data.providers[0].id);
          }
        }
      },
    );
  }, []);

  const updateProvider = (id: string, updates: Partial<ProviderConfig>) => {
    setSettings((s) => ({
      ...s,
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    setSaved(false);
  };

  const addProvider = (type: ProviderConfig['type']) => {
    const preset = PROVIDER_PRESETS[type];
    if (!preset) return;
    const id = `${type}-${Date.now()}`;
    const newProvider: ProviderConfig = {
      ...preset,
      id,
      enabled: true,
      ...(isLlmProvider(type) ? { disableThinking: true } : {}),
    };
    setSettings((s) => ({ ...s, providers: [...s.providers, newProvider] }));
    setExpandedProvider(id);
    setSaved(false);
  };

  const setDefaultProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      defaultProvider: id,
      fallbackProviders: s.fallbackProviders.filter((fid) => fid !== id),
    }));
    setSaved(false);
  };

  const removeProvider = (id: string) => {
    setSettings((s) => {
      const providers = s.providers.filter((p) => p.id !== id);
      let defaultProvider = s.defaultProvider;
      let fallbackProviders = s.fallbackProviders.filter((fid) => fid !== id);
      if (s.defaultProvider === id) {
        defaultProvider = providers[0]?.id ?? '';
        if (defaultProvider) {
          fallbackProviders = fallbackProviders.filter((fid) => fid !== defaultProvider);
        }
      }
      return { ...s, providers, defaultProvider, fallbackProviders };
    });
    setSaved(false);
  };

  const addFallbackProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      fallbackProviders: [...s.fallbackProviders, id],
    }));
    setSaved(false);
  };

  const removeFallbackProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      fallbackProviders: s.fallbackProviders.filter((fid) => fid !== id),
    }));
    setSaved(false);
  };

  const moveFallbackProvider = (index: number, direction: -1 | 1) => {
    setSettings((s) => {
      const next = index + direction;
      if (next < 0 || next >= s.fallbackProviders.length) return s;
      const fallbackProviders = [...s.fallbackProviders];
      [fallbackProviders[index], fallbackProviders[next]] =
        [fallbackProviders[next], fallbackProviders[index]];
      return { ...s, fallbackProviders };
    });
    setSaved(false);
  };

  const availableFallbackProviders = settings.providers.filter(
    (p) =>
      p.enabled &&
      p.id !== settings.defaultProvider &&
      !settings.fallbackProviders.includes(p.id),
  );

  const dismissWelcome = () => {
    setShowWelcome(false);
    void clearOnboardingPending();
  };

  const handleSave = async () => {
    setSaving(true);
    await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: settings });
    setSaving(false);
    setSaved(true);
    setShowWelcome(false);
    void clearOnboardingPending();
    setTimeout(() => setSaved(false), 2000);
  };

  const handleVerify = async (provider: ProviderConfig) => {
    setVerifying(provider.id);
    setVerifyResults((r) => ({ ...r, [provider.id]: undefined! }));
    try {
      const res: MessageResponse<string> = await browser.runtime.sendMessage({
        type: 'VERIFY_CONFIG',
        payload: { providerConfig: provider },
      });
      if (!res) {
        setVerifyResults((r) => ({ ...r, [provider.id]: { ok: false, msg: t('options.noResponseFromBackground') } }));
        return;
      }
      const result = res.success
        ? { ok: true, msg: t('options.verifiedResult', { result: res.data }) }
        : { ok: false, msg: res.error };
      setVerifyResults((r) => ({ ...r, [provider.id]: result }));
    } catch (err) {
      setVerifyResults((r) => ({
        ...r,
        [provider.id]: { ok: false, msg: err instanceof Error ? err.message : t('options.verificationFailed') },
      }));
    } finally {
      setVerifying(null);
    }
  };

  const needsApiKey = (type: ProviderConfig['type']) =>
    type !== 'ollama';

  const needsModel = (type: ProviderConfig['type']) =>
    ['openai-compat', 'ollama', 'openai', 'lmstudio'].includes(type);

  const handleUiLangChange = async (lang: string) => {
    setUiLang(lang);
    await setUILanguage(lang);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <AppLogo className="w-10 h-10 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">LinguaLens</h1>
            <p className="text-sm text-gray-400">{t('options.settings')}</p>
          </div>
        </div>

        {/* UI Language */}
        <Section title={t('options.uiLanguage')}>
          <select
            value={uiLang}
            onChange={(e) => void handleUiLangChange(e.target.value)}
            className="input"
          >
            {AVAILABLE_UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </Section>

        {/* Language — selection & page translation */}
        <Section title={t('options.selectionPageTranslation')}>
          <p className="text-sm text-gray-500 mb-4">
            {t('options.selectionPageDesc')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('options.sourceLanguage')}>
              <select value={settings.defaultSourceLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultSourceLang: e.target.value })); setSaved(false); }} className="input">
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
            <Field label={t('options.targetLanguage')}>
              <select value={settings.defaultTargetLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultTargetLang: e.target.value })); setSaved(false); }} className="input">
                {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* Default Provider */}
        {settings.providers.length > 1 && (
          <Section title={t('options.defaultProvider')}>
            <select
              value={settings.defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value)}
              className="input"
            >
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({t(`providerTypes.${p.type}`)})</option>
              ))}
            </select>
          </Section>
        )}

        {/* Fallback Providers */}
        {settings.providers.length > 1 && (
          <Section title={t('options.fallbackProviders')}>
            <p className="text-xs text-gray-400 mb-3">
              {t('options.fallbackDesc')}
            </p>
            {settings.fallbackProviders.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3">{t('options.noFallback')}</p>
            ) : (
              <ol className="space-y-2 mb-3">
                {settings.fallbackProviders.map((id, index) => {
                  const provider = settings.providers.find((p) => p.id === id);
                  if (!provider) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50"
                    >
                      <span className="text-xs text-gray-400 w-5 shrink-0">{index + 1}.</span>
                      <span className="flex-1 text-sm text-gray-800 truncate">
                        {provider.name}
                        <span className="ml-2 text-xs text-gray-400">{t(`providerTypes.${provider.type}`)}</span>
                      </span>
                      {!provider.enabled && (
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">{t('options.disabled')}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => moveFallbackProvider(index, -1)}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        aria-label={t('options.moveUp')}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFallbackProvider(index, 1)}
                        disabled={index === settings.fallbackProviders.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        aria-label={t('options.moveDown')}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFallbackProvider(id)}
                        className="p-1 text-red-400 hover:text-red-500"
                        aria-label={t('options.remove')}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {availableFallbackProviders.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addFallbackProvider(e.target.value);
                }}
                className="input"
              >
                <option value="">{t('options.addFallback')}</option>
                {availableFallbackProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({t(`providerTypes.${p.type}`)})</option>
                ))}
              </select>
            )}
          </Section>
        )}

        {showWelcome && (
          <div
            ref={welcomeRef}
            className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5"
            role="status"
          >
            <h2 className="text-base font-semibold text-blue-900">{t('options.welcomeTitle')}</h2>
            <p className="mt-2 text-sm text-blue-800/90 leading-relaxed">
              {t('options.welcomeDesc')}
            </p>
            <ol className="mt-3 space-y-1.5 text-sm text-blue-900/90 list-decimal list-inside">
              <li>{t('options.welcomeStep1')}</li>
              <li dangerouslySetInnerHTML={{ __html: t('options.welcomeStep2') }} />
              <li dangerouslySetInnerHTML={{ __html: t('options.welcomeStep3') }} />
            </ol>
            <button
              type="button"
              onClick={dismissWelcome}
              className="mt-4 text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              {t('options.dismiss')}
            </button>
          </div>
        )}

        {/* Providers */}
        <Section
          title={t('options.providers')}
          action={
            <div className="relative group">
              <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">{t('options.addProvider')}</button>
              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => addProvider(key as ProviderConfig['type'])}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {settings.providers.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">{t('options.noProviders')}</p>
          )}
          <div className="space-y-3">
            {settings.providers.map((provider) => {
              const expanded = expandedProvider === provider.id;
              return (
                <div key={provider.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Provider header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedProvider(expanded ? null : provider.id)}
                  >
                    <label className="flex items-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/40"
                      />
                    </label>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-800">{provider.name}</span>
                      <span className="ml-2 text-xs text-gray-400">{t(`providerTypes.${provider.type}`)}</span>
                    </div>
                    {settings.defaultProvider === provider.id && (
                      <span className="text-[10px] font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">{t('options.default')}</span>
                    )}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                  </div>

                  {/* Provider details */}
                  {expanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                      <Field label={t('options.providerName')}>
                        <input type="text" value={provider.name} onChange={(e) => updateProvider(provider.id, { name: e.target.value })} className="input" />
                      </Field>
                      <Field label={provider.type === 'lmstudio' ? t('options.serverUrl') : t('options.apiBaseUrl')}>
                        <input
                          type="text"
                          value={provider.baseUrl}
                          onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                          placeholder={provider.type === 'lmstudio' ? 'http://localhost:1234' : undefined}
                          className="input font-mono text-xs"
                        />
                      </Field>
                      {provider.type === 'lmstudio' && (
                        <p className="text-xs text-gray-400 -mt-1" dangerouslySetInnerHTML={{ __html: t('options.lmStudioNote') }} />
                      )}
                      {needsApiKey(provider.type) && (
                        <Field label={t('options.apiKey')}>
                          <input type="password" value={provider.apiKey || ''} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} placeholder="sk-…" className="input font-mono text-xs" />
                        </Field>
                      )}
                      {needsModel(provider.type) && (
                        <Field label={t('options.model')}>
                          <input type="text" value={provider.model || ''} onChange={(e) => updateProvider(provider.id, { model: e.target.value })} placeholder={provider.type === 'ollama' ? 'llama3' : provider.type === 'lmstudio' ? 'loaded model' : 'gpt-4o-mini'} className="input font-mono text-xs" />
                        </Field>
                      )}
                      {isLlmProvider(provider.type) && (
                        <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={provider.disableThinking !== false}
                            onChange={(e) => updateProvider(provider.id, { disableThinking: e.target.checked })}
                            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/40"
                          />
                          <div>
                            <span className="text-sm font-medium text-gray-700">{t('options.disableThinking')}</span>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {t('options.disableThinkingDesc')}
                            </p>
                          </div>
                        </label>
                      )}
                      {provider.type === 'ollama' && (
                        <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                          {t('options.ollamaCorsWarning')} <code className="bg-amber-100 px-1 rounded">OLLAMA_ORIGINS="chrome-extension://*" ollama serve</code>
                        </p>
                      )}
                      <div className="flex items-center gap-3 pt-1 flex-wrap">
                        <button onClick={() => handleVerify(provider)} disabled={verifying === provider.id} className="px-3 py-1.5 border border-blue-200 bg-blue-50 rounded-lg text-xs text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                          {verifying === provider.id ? t('options.verifying') : t('options.verifyConfig')}
                        </button>
                        {settings.defaultProvider !== provider.id && (
                          <button onClick={() => setDefaultProvider(provider.id)} className="px-3 py-1.5 text-xs text-blue-500 hover:text-blue-600">{t('options.setAsDefault')}</button>
                        )}
                        <button onClick={() => removeProvider(provider.id)} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-500 ml-auto">{t('options.remove')}</button>
                      </div>
                      {verifyResults[provider.id] && (
                        <span className={`text-xs font-medium pt-1 ${verifyResults[provider.id].ok ? 'text-green-600' : 'text-red-500'}`}>{verifyResults[provider.id].msg}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* Prompt Template */}
        <Section title={t('options.promptTemplate')}>
          <p className="text-xs text-gray-400 mb-3">
            {t('options.promptTemplateDesc')} <code className="bg-gray-100 px-1 rounded">{'{sourceLang}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{targetLang}'}</code>
          </p>
          <textarea
            value={settings.promptTemplate ?? 'You are a professional translator. Translate the following text from {sourceLang} to {targetLang}. Preserve the original formatting, tone, and style. Only output the translated text, nothing else.'}
            onChange={(e) => { setSettings((s) => ({ ...s, promptTemplate: e.target.value })); setSaved(false); }}
            rows={4}
            className="input font-mono text-xs leading-relaxed"
          />
          <button
            onClick={() => { setSettings((s) => ({ ...s, promptTemplate: undefined })); setSaved(false); }}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600"
          >
            {t('options.resetToDefault')}
          </button>
        </Section>

        {/* Page Translation */}
        <Section title={t('options.pageTranslation')}>
          <Field label={t('options.translationStrategy')}>
            <div className="space-y-2 mt-1">
              {([
                { value: 'quality' as ChunkingMode, labelKey: 'options.strategyQuality', descKey: 'options.strategyQualityDesc' },
                { value: 'speed' as ChunkingMode, labelKey: 'options.strategySpeed', descKey: 'options.strategySpeedDesc' },
              ]).map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="chunkingMode"
                    checked={settings.chunkingMode === opt.value}
                    onChange={() => { setSettings((s) => ({ ...s, chunkingMode: opt.value })); setSaved(false); }}
                    className="mt-0.5 w-4 h-4 text-blue-500 focus:ring-blue-500/40"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">{t(opt.labelKey)}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{t(opt.descKey)}</p>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        </Section>

        {/* Keyboard shortcuts */}
        <Section title={t('options.keyboardShortcuts')}>
          <p className="text-sm text-gray-600 leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: t('options.keyboardShortcutsDesc') }} />
          <button
            type="button"
            onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t('options.openShortcutSettings')}
          </button>
        </Section>

        {/* Save */}
        <div className="flex items-center gap-3 mt-6">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 transition-all shadow-sm">
            {saving ? t('options.saving') : t('options.save')}
          </button>
          {saved && (
            <span className="text-sm font-medium text-green-600 flex items-center gap-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
              {t('options.saved')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
