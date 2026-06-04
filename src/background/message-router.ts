import { ProviderManager } from '../providers/manager';
import { getCached, setCache, clearCache as clearTranslationCache, getCacheStats } from './cache';
import type { AppSettings, ProviderConfig, TranslateRequest, MessageResponse, TranslateResult } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';

const providerManager = new ProviderManager();

function normalizeSettings(settings: AppSettings): AppSettings {
  if (!settings.defaultProvider) return settings;
  return {
    ...settings,
    fallbackProviders: (settings.fallbackProviders ?? []).filter(
      (id) => id !== settings.defaultProvider,
    ),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const result = await browser.storage.local.get('settings');
  if (!result.settings) return DEFAULT_SETTINGS;
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(result.settings as AppSettings) });
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  if (partial.providers) updated.providers = partial.providers;
  if (partial.fallbackProviders) updated.fallbackProviders = partial.fallbackProviders;
  const normalized = normalizeSettings(updated);
  await browser.storage.local.set({ settings: normalized });
  providerManager.clearCache();
  return normalized;
}

function getEnabledProvider(settings: AppSettings, id: string): ProviderConfig | undefined {
  return settings.providers.find((p) => p.id === id && p.enabled);
}

function buildProviderChain(settings: AppSettings): ProviderConfig[] {
  const chain: ProviderConfig[] = [];
  const seen = new Set<string>();

  const defaultConfig = getEnabledProvider(settings, settings.defaultProvider);
  if (defaultConfig) {
    chain.push(defaultConfig);
    seen.add(defaultConfig.id);
  }

  for (const id of settings.fallbackProviders ?? []) {
    if (seen.has(id)) continue;
    const config = getEnabledProvider(settings, id);
    if (config) {
      chain.push(config);
      seen.add(config.id);
    }
  }

  return chain;
}

async function translateWithProvider(
  request: TranslateRequest,
  providerConfig: ProviderConfig,
  promptTemplate?: string,
): Promise<TranslateResult> {
  const cached = await getCached(
    request.text, request.sourceLang, request.targetLang, providerConfig.id,
  );
  if (cached) return cached;

  let config = providerConfig;
  if (promptTemplate && !config.systemPrompt) {
    config = { ...config, systemPrompt: promptTemplate };
  }

  const provider = providerManager.getProvider(config);
  const result = await provider.translate(request);

  await setCache(request.text, request.sourceLang, request.targetLang, config.id, result);

  return result;
}

export async function handleTranslate(
  request: TranslateRequest,
): Promise<MessageResponse<TranslateResult>> {
  const settings = await getSettings();
  const chain = buildProviderChain(settings);

  if (chain.length === 0) {
    return { success: false, error: 'NO_PROVIDER' };
  }

  let lastError = '';

  for (const providerConfig of chain) {
    try {
      const result = await translateWithProvider(request, providerConfig, settings.promptTemplate);
      return { success: true, data: result };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'TRANSLATION_FAILED';
    }
  }

  return { success: false, error: lastError };
}

export async function handleVerifyConfig(
  providerConfig: ProviderConfig,
): Promise<MessageResponse<string>> {
  try {
    const provider = providerManager.getProvider(providerConfig, { useCache: false });
    const result = await provider.translate({
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'zh',
    });
    if (!result.translated.trim()) {
      return { success: false, error: 'Provider returned empty translation' };
    }
    return { success: true, data: result.translated };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Verification failed' };
  }
}

export async function handleMessage(message: Record<string, unknown>): Promise<MessageResponse> {
  switch (message.type) {
    case 'TRANSLATE':
      return handleTranslate(message.payload as TranslateRequest);
    case 'VERIFY_CONFIG':
      return handleVerifyConfig((message.payload as { providerConfig: ProviderConfig }).providerConfig);
    case 'GET_SETTINGS':
      return { success: true, data: await getSettings() };
    case 'SAVE_SETTINGS':
      return { success: true, data: await saveSettings(message.payload as Partial<AppSettings>) };
    case 'CLEAR_CACHE':
      await clearTranslationCache();
      return { success: true, data: null };
    case 'GET_CACHE_STATS':
      return { success: true, data: await getCacheStats() };
    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}
