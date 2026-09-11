import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, ProviderConfig, MessageResponse, ChunkingMode, SelectionTriggerMode, SelectionModifierKey, SettingsPatch } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, DEFAULT_ADDITIONAL_PROMPT, SUPPORTED_LANGUAGES, PROVIDER_PRESETS } from '../../shared/constants';
import { clearOnboardingPending, isOnboardingPending } from '../../shared/onboarding';
import { isLlmProvider } from '../../providers/thinking';
import { AppLogo } from '../../shared/AppLogo';
import { ProviderIcon } from '../../shared/ProviderIcon';
import { shortcutLabel } from '../../shared/shortcut';
import { version as EXT_VERSION, repository } from '../../../package.json';
import { AVAILABLE_UI_LANGUAGES, setUILanguage, getUILanguage } from '../../shared/i18n';

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [uiLang, setUiLang] = useState(getUILanguage());
  const [activeSection, setActiveSection] = useState('ui-language');
  const welcomeRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Record<string, HTMLElement | null>>({});

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  const registerSection = (id: string, el: HTMLElement | null) => {
    sectionEls.current[id] = el;
  };

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const NAV_ITEMS: { id: string; labelKey: string }[] = [
    { id: 'ui-language', labelKey: 'options.uiLanguage' },
    { id: 'translation', labelKey: 'options.selectionPageTranslation' },
    { id: 'providers', labelKey: 'options.providers' },
    { id: 'prompt', labelKey: 'options.promptTemplate' },
    { id: 'page', labelKey: 'options.pageTranslation' },
    { id: 'shortcuts', labelKey: 'options.keyboardShortcuts' },
  ];

  useEffect(() => {
    isOnboardingPending().then(setShowWelcome);
  }, []);

  useEffect(() => {
    if (showWelcome) {
      setActiveSection('providers');
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
    markDirty();
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
    markDirty();
  };

  const setDefaultProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      defaultProvider: id,
      fallbackProviders: s.fallbackProviders.filter((fid) => fid !== id),
    }));
    markDirty();
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
    markDirty();
  };

  const addFallbackProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      fallbackProviders: [...s.fallbackProviders, id],
    }));
    markDirty();
  };

  const removeFallbackProvider = (id: string) => {
    setSettings((s) => ({
      ...s,
      fallbackProviders: s.fallbackProviders.filter((fid) => fid !== id),
    }));
    markDirty();
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
    markDirty();
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
    // An empty base prompt is almost certainly accidental: unlike the
    // additional prompt (empty = disabled), the base prompt has no "off"
    // state — an empty value merely falls back to the built-in default at
    // runtime. Offer a reset instead of silently storing a dead override.
    let promptTemplate = settings.promptTemplate;
    if (promptTemplate !== undefined && promptTemplate.trim() === '') {
      if (!window.confirm(t('options.basePromptEmptyWarning'))) return;
      promptTemplate = undefined;
      setSettings((s) => ({ ...s, promptTemplate: undefined }));
    }
    setSaving(true);
    // Unset prompt fields are sent as an explicit `null` (= reset to the
    // built-in default): `undefined` is dropped by message serialization, so
    // the background would otherwise keep the previously stored override.
    const payload: SettingsPatch = {
      ...settings,
      promptTemplate: promptTemplate ?? null,
      additionalPrompt: settings.additionalPrompt ?? null,
    };
    await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload });
    setSaving(false);
    setSaved(true);
    setDirty(false);
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

  // Highlight the sidebar nav item for the section currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveSection(topmost.target.id);
      },
      { rootMargin: '-15% 0px -75% 0px', threshold: 0 },
    );
    for (const el of Object.values(sectionEls.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settings.providers.length]);

  // Ctrl/Cmd+S saves the form (only when there are unsaved changes).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, handleSave]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const needsModel = (type: ProviderConfig['type']) =>
    ['openai-compat', 'ollama', 'openai', 'lmstudio'].includes(type);

  const handleUiLangChange = async (lang: string) => {
    setUiLang(lang);
    await setUILanguage(lang);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto py-10 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <AppLogo className="w-10 h-10 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">LinguaLens</h1>
            <p className="text-sm text-gray-400">{t('options.settings')}</p>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-8 lg:items-start">
          {/* Section navigation */}
          <nav className="lg:sticky lg:top-8 mb-6 lg:mb-0" aria-label={t('options.settings')}>
            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
              {NAV_ITEMS.map((item) => {
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`shrink-0 text-left text-sm rounded-lg px-3 py-1.5 whitespace-nowrap lg:whitespace-normal transition-colors ${active
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                      }`}
                  >
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0">
            {/* UI Language */}
            <Section id="ui-language" registerRef={registerSection} title={t('options.uiLanguage')}>
              <select
                value={uiLang}
                onChange={(e) => void handleUiLangChange(e.target.value)}
                className="input ll-select w-full"
              >
                {AVAILABLE_UI_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </Section>

            {/* Language — selection & page translation */}
            <Section id="translation" registerRef={registerSection} title={t('options.selectionPageTranslation')}>
              <p className="text-sm text-gray-500 mb-4">
                {t('options.selectionPageDesc')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('options.sourceLanguage')}>
                  <select value={settings.defaultSourceLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultSourceLang: e.target.value })); markDirty(); }} className="input ll-select w-full">
                    {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </Field>
                <Field label={t('options.targetLanguage')}>
                  <select value={settings.defaultTargetLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultTargetLang: e.target.value })); markDirty(); }} className="input ll-select w-full">
                    {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </Field>
              </div>

              <hr className="my-4 border-gray-200" />

              <Field label={t('options.selectionTriggerMode')}>
                <p className="ll-hint mb-2">{t('options.selectionTriggerModeDesc')}</p>
                <div className="space-y-2 mt-1">
                  {([
                    { value: 'icon' as SelectionTriggerMode, labelKey: 'options.triggerModeIcon', descKey: 'options.triggerModeIconDesc' },
                    { value: 'instant' as SelectionTriggerMode, labelKey: 'options.triggerModeInstant', descKey: 'options.triggerModeInstantDesc' },
                    { value: 'modifier' as SelectionTriggerMode, labelKey: 'options.triggerModeModifier', descKey: 'options.triggerModeModifierDesc' },
                    { value: 'off' as SelectionTriggerMode, labelKey: 'options.triggerModeOff', descKey: 'options.triggerModeOffDesc' },
                  ]).map((opt) => (
                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <input
                        type="radio"
                        name="selectionTriggerMode"
                        checked={settings.selectionTriggerMode === opt.value}
                        onChange={() => { setSettings((s) => ({ ...s, selectionTriggerMode: opt.value })); markDirty(); }}
                        className="mt-0.5 w-4 h-4 text-blue-500 focus:ring-blue-500/40"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">{t(opt.labelKey)}</span>
                        <p className="ll-hint mt-0.5">{t(opt.descKey)}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {settings.selectionTriggerMode === 'modifier' && (
                  <div className="mt-3 ml-7">
                    <label className="block text-sm font-medium text-gray-500 mb-1.5">{t('options.selectionModifierKey')}</label>
                    <p className="ll-hint mb-2">{t('options.selectionModifierKeyDesc')}</p>
                    <select
                      value={settings.selectionModifierKey}
                      onChange={(e) => { setSettings((s) => ({ ...s, selectionModifierKey: e.target.value as SelectionModifierKey })); markDirty(); }}
                      className="input ll-select w-32"
                    >
                      {(['ctrl', 'alt', 'shift'] as SelectionModifierKey[]).map((k) => (
                        <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </Field>
            </Section>

            {/* Default + fallback + provider list (one nav anchor) */}
            <div id="providers" ref={(el) => registerSection('providers', el)}>
              {/* Default Provider */}
              {settings.providers.length > 1 && (
                <Section title={t('options.defaultProvider')}>
                  <select
                    value={settings.defaultProvider}
                    onChange={(e) => setDefaultProvider(e.target.value)}
                    className="input ll-select w-full"
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
                  <p className="ll-hint mb-3">
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
                              <span className="ll-badge ll-badge-warn shrink-0">{t('options.disabled')}</span>
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
                      className="input ll-select w-full"
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
                  <AddProviderMenu onAdd={(type) => addProvider(type)} />
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
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${provider.enabled ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                            <ProviderIcon type={provider.type} name={provider.name} size={14} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${provider.enabled ? 'bg-green-500' : 'bg-gray-300'}`} aria-hidden="true" />
                              <span className="text-sm font-medium text-gray-800 truncate">{provider.name}</span>
                              <span className="text-xs text-gray-400 shrink-0">{t(`providerTypes.${provider.type}`)}</span>
                            </div>
                          </div>
                          {settings.defaultProvider === provider.id && (
                            <span className="ll-badge ll-badge-brand">{t('options.default')}</span>
                          )}
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                        </div>

                        {/* Provider details */}
                        {expanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                            <Field label={t('options.providerName')}>
                              <input type="text" value={provider.name} onChange={(e) => updateProvider(provider.id, { name: e.target.value })} className="input w-full" />
                            </Field>
                            <Field label={provider.type === 'lmstudio' ? t('options.serverUrl') : t('options.apiBaseUrl')}>
                              <input
                                type="text"
                                value={provider.baseUrl}
                                onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                                placeholder={provider.type === 'lmstudio' ? 'http://localhost:1234' : undefined}
                                className="input font-mono w-full"
                              />
                            </Field>
                            {provider.type === 'lmstudio' && (
                              <p className="ll-hint -mt-1" dangerouslySetInnerHTML={{ __html: t('options.lmStudioNote') }} />
                            )}
                            {needsApiKey(provider.type) && (
                              <Field label={t('options.apiKey')}>
                                <input type="password" value={provider.apiKey || ''} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} placeholder="sk-…" className="input font-mono w-full" />
                              </Field>
                            )}
                            {needsModel(provider.type) && (
                              <Field label={t('options.model')}>
                                <input type="text" value={provider.model || ''} onChange={(e) => updateProvider(provider.id, { model: e.target.value })} placeholder={provider.type === 'ollama' ? 'llama3' : provider.type === 'lmstudio' ? 'loaded model' : 'gpt-4o-mini'} className="input font-mono w-full" />
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
                                  <p className="ll-hint mt-0.5">
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
            </div>

            {/* Prompt Template */}
            <Section id="prompt" registerRef={registerSection} title={t('options.promptTemplate')}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('options.basePrompt')}</label>
              <p className="ll-hint mb-3">
                {t('options.promptTemplateDesc')} <code className="bg-gray-100 px-1 rounded">{'{sourceLang}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{targetLang}'}</code>
              </p>
              <textarea
                value={settings.promptTemplate ?? DEFAULT_SYSTEM_PROMPT}
                onChange={(e) => { setSettings((s) => ({ ...s, promptTemplate: e.target.value })); markDirty(); }}
                rows={4}
                className="input font-mono leading-relaxed w-full"
              />
              <button
                onClick={() => { setSettings((s) => ({ ...s, promptTemplate: undefined })); markDirty(); }}
                className="mt-2 text-xs text-gray-400 hover:text-gray-600"
              >
                {t('options.resetToDefault')}
              </button>

              {/* Additional prompt — selection / popup / side panel only */}
              <div className="mt-5 pt-5 border-t border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('options.additionalPrompt')}</label>
                <p className="ll-hint mb-3">
                  {t('options.additionalPromptDesc')} <code className="bg-gray-100 px-1 rounded">{'{sourceLang}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{targetLang}'}</code>
                </p>
                <textarea
                  value={settings.additionalPrompt ?? DEFAULT_ADDITIONAL_PROMPT}
                  onChange={(e) => { setSettings((s) => ({ ...s, additionalPrompt: e.target.value })); markDirty(); }}
                  rows={4}
                  className="input font-mono leading-relaxed w-full"
                />
                <button
                  onClick={() => { setSettings((s) => ({ ...s, additionalPrompt: undefined })); markDirty(); }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                >
                  {t('options.resetToDefault')}
                </button>
              </div>
            </Section>

            {/* Page Translation */}
            <Section id="page" registerRef={registerSection} title={t('options.pageTranslation')}>
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
                        onChange={() => { setSettings((s) => ({ ...s, chunkingMode: opt.value })); markDirty(); }}
                        className="mt-0.5 w-4 h-4 text-blue-500 focus:ring-blue-500/40"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">{t(opt.labelKey)}</span>
                        <p className="ll-hint mt-0.5">{t(opt.descKey)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>
            </Section>

            {/* Keyboard shortcuts */}
            <Section id="shortcuts" registerRef={registerSection} title={t('options.keyboardShortcuts')}>
              <p className="text-sm text-gray-600 leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: t('options.keyboardShortcutsDesc') }} />
              <button
                type="button"
                onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('options.openShortcutSettings')}
              </button>
            </Section>

            {/* Save bar — sticky so unsaved changes never get lost off-screen */}
            <div className="sticky bottom-0 z-10 -mx-6 mt-6 px-6 py-3 bg-white/95 backdrop-blur-sm border-t border-gray-200 flex items-center gap-3">
              {dirty ? (
                <span className="text-xs font-medium text-amber-600 flex items-center gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                  {t('options.unsavedChanges')}
                </span>
              ) : saved ? (
                <span className="text-xs font-medium text-green-600 flex items-center gap-1 shrink-0">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
                  {t('options.saved')}
                </span>
              ) : null}
              <span className="flex-1 text-center text-xs text-gray-400 min-w-0 truncate">
                LinguaLens v{EXT_VERSION}
                <span className="mx-1.5 text-gray-300">·</span>
                <a
                  href={repository.url.replace(/\.git$/, '')}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-500 hover:text-blue-600"
                >
                  GitHub
                </a>
              </span>
              <button onClick={handleSave} disabled={saving} className="ll-btn-primary ll-btn-lg shrink-0">
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <span className="ll-spinner-light" />
                    {t('options.saving')}
                  </span>
                ) : `${t('options.save')} ${shortcutLabel('S')}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddProviderMenu({ onAdd }: { onAdd: (type: ProviderConfig['type']) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-blue-500 hover:text-blue-600 font-medium"
      >
        {t('options.addProvider')}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-md border border-gray-200 py-1 w-48 z-10">
          {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => { onAdd(key as ProviderConfig['type']); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2 transition-colors"
            >
              <span className="text-gray-400 shrink-0"><ProviderIcon type={key as ProviderConfig['type']} name={preset.name} size={14} /></span>
              {preset.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ id, registerRef, title, action, children }: { id?: string; registerRef?: (id: string, el: HTMLElement | null) => void; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      id={id}
      ref={id && registerRef ? (el) => registerRef(id, el) : undefined}
      className="bg-white rounded-xl border border-gray-200 p-6 mb-6 scroll-mt-4"
    >
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
