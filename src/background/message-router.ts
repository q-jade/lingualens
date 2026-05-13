import { ProviderManager } from '../providers/manager';
import { getCached, setCache, clearCache as clearTranslationCache, getCacheStats } from './cache';
import type { AppSettings, ProviderConfig, TranslateRequest, MessageResponse, TranslateResult } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';

const providerManager = new ProviderManager();

export async function getSettings(): Promise<AppSettings> {
  const result = await browser.storage.local.get('settings');
  return (result.settings as AppSettings) || DEFAULT_SETTINGS;
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  if (partial.providers) updated.providers = partial.providers;
  await browser.storage.local.set({ settings: updated });
  providerManager.clearCache();
  return updated;
}

export async function handleTranslate(
  request: TranslateRequest,
): Promise<MessageResponse<TranslateResult>> {
  try {
    const settings = await getSettings();
    let providerConfig = settings.providers.find(
      (p) => p.id === settings.defaultProvider && p.enabled,
    );
    if (!providerConfig) {
      return { success: false, error: 'No active provider configured. Open Settings to add one.' };
    }

    const cached = await getCached(
      request.text, request.sourceLang, request.targetLang, providerConfig.id,
    );
    if (cached) return { success: true, data: cached };

    if (settings.promptTemplate && !providerConfig.systemPrompt) {
      providerConfig = { ...providerConfig, systemPrompt: settings.promptTemplate };
    }

    const provider = providerManager.getProvider(providerConfig);
    const result = await provider.translate(request);

    await setCache(request.text, request.sourceLang, request.targetLang, providerConfig.id, result);

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Translation failed' };
  }
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
