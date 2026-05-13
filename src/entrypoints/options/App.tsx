import { useState, useEffect } from 'react';
import type { AppSettings, ProviderConfig, MessageResponse } from '../../shared/types';
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES, PROVIDER_PRESETS } from '../../shared/constants';

const PROVIDER_TYPE_LABELS: Record<ProviderConfig['type'], string> = {
  'openai-compat': 'OpenAI Compatible',
  ollama: 'Ollama',
  openai: 'OpenAI',
  lmstudio: 'LM Studio',
  deepl: 'DeepL',
  google: 'Google Translate',
  custom: 'Custom',
};

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

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
    const newProvider: ProviderConfig = { ...preset, id, enabled: true };
    setSettings((s) => ({ ...s, providers: [...s.providers, newProvider] }));
    setExpandedProvider(id);
    setSaved(false);
  };

  const removeProvider = (id: string) => {
    setSettings((s) => {
      const providers = s.providers.filter((p) => p.id !== id);
      const defaultProvider = s.defaultProvider === id
        ? (providers[0]?.id ?? '')
        : s.defaultProvider;
      return { ...s, providers, defaultProvider };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: settings });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async (provider: ProviderConfig) => {
    setTesting(provider.id);
    setTestResults((r) => ({ ...r, [provider.id]: undefined! }));
    try {
      const res: MessageResponse<boolean> = await browser.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: { providerConfig: provider },
      });
      if (!res) {
        setTestResults((r) => ({ ...r, [provider.id]: { ok: false, msg: 'No response from background' } }));
        return;
      }
      const result = res.success
        ? { ok: res.data, msg: res.data ? 'Connected!' : 'Connection failed' }
        : { ok: false, msg: res.error };
      setTestResults((r) => ({ ...r, [provider.id]: result }));
    } catch (err) {
      setTestResults((r) => ({
        ...r,
        [provider.id]: { ok: false, msg: err instanceof Error ? err.message : 'Test failed' },
      }));
    } finally {
      setTesting(null);
    }
  };

  const needsApiKey = (type: ProviderConfig['type']) =>
    type !== 'ollama';

  const needsModel = (type: ProviderConfig['type']) =>
    ['openai-compat', 'ollama', 'openai', 'lmstudio'].includes(type);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
              <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">LinguaLens</h1>
            <p className="text-sm text-gray-400">Settings</p>
          </div>
        </div>

        {/* Language */}
        <Section title="Language">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Source Language">
              <select value={settings.defaultSourceLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultSourceLang: e.target.value })); setSaved(false); }} className="input">
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Target Language">
              <select value={settings.defaultTargetLang} onChange={(e) => { setSettings((s) => ({ ...s, defaultTargetLang: e.target.value })); setSaved(false); }} className="input">
                {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* Default Provider */}
        {settings.providers.length > 1 && (
          <Section title="Default Provider">
            <select
              value={settings.defaultProvider}
              onChange={(e) => { setSettings((s) => ({ ...s, defaultProvider: e.target.value })); setSaved(false); }}
              className="input"
            >
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({PROVIDER_TYPE_LABELS[p.type]})</option>
              ))}
            </select>
          </Section>
        )}

        {/* Providers */}
        <Section
          title="Translation Providers"
          action={
            <div className="relative group">
              <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">+ Add Provider</button>
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
            <p className="text-sm text-gray-400 text-center py-6">No providers configured. Add one above.</p>
          )}
          <div className="space-y-3">
            {settings.providers.map((provider) => {
              const expanded = expandedProvider === provider.id;
              const tr = testResults[provider.id];
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
                      <span className="ml-2 text-xs text-gray-400">{PROVIDER_TYPE_LABELS[provider.type]}</span>
                    </div>
                    {settings.defaultProvider === provider.id && (
                      <span className="text-[10px] font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">DEFAULT</span>
                    )}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                  </div>

                  {/* Provider details */}
                  {expanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                      <Field label="Provider Name">
                        <input type="text" value={provider.name} onChange={(e) => updateProvider(provider.id, { name: e.target.value })} className="input" />
                      </Field>
                      <Field label="API Base URL">
                        <input type="text" value={provider.baseUrl} onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })} className="input font-mono text-xs" />
                      </Field>
                      {needsApiKey(provider.type) && (
                        <Field label="API Key">
                          <input type="password" value={provider.apiKey || ''} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} placeholder="sk-…" className="input font-mono text-xs" />
                        </Field>
                      )}
                      {needsModel(provider.type) && (
                        <Field label="Model">
                          <input type="text" value={provider.model || ''} onChange={(e) => updateProvider(provider.id, { model: e.target.value })} placeholder={provider.type === 'ollama' ? 'llama3' : provider.type === 'lmstudio' ? 'loaded model' : 'gpt-4o-mini'} className="input font-mono text-xs" />
                        </Field>
                      )}
                      {provider.type === 'ollama' && (
                        <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                          Ollama requires CORS configuration for browser extensions. Start Ollama with: <code className="bg-amber-100 px-1 rounded">OLLAMA_ORIGINS="chrome-extension://*" ollama serve</code>
                        </p>
                      )}
                      <div className="flex items-center gap-3 pt-1">
                        <button onClick={() => handleTest(provider)} disabled={testing === provider.id} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50 transition-colors">
                          {testing === provider.id ? 'Testing…' : 'Test Connection'}
                        </button>
                        {settings.defaultProvider !== provider.id && (
                          <button onClick={() => { setSettings((s) => ({ ...s, defaultProvider: provider.id })); setSaved(false); }} className="px-3 py-1.5 text-xs text-blue-500 hover:text-blue-600">Set as Default</button>
                        )}
                        <button onClick={() => removeProvider(provider.id)} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-500 ml-auto">Remove</button>
                        {tr && <span className={`text-xs font-medium ${tr.ok ? 'text-green-600' : 'text-red-500'}`}>{tr.msg}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* Prompt Template */}
        <Section title="Translation Prompt Template">
          <p className="text-xs text-gray-400 mb-3">
            Customize the system prompt for LLM-based providers. Available variables: <code className="bg-gray-100 px-1 rounded">{'{sourceLang}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{targetLang}'}</code>
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
            Reset to default
          </button>
        </Section>

        {/* Save */}
        <div className="flex items-center gap-3 mt-6">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 transition-all shadow-sm">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && (
            <span className="text-sm font-medium text-green-600 flex items-center gap-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
              Saved
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
