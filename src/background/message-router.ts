import { ProviderManager } from '../providers/manager';
import { getCached, setCache, clearCache as clearTranslationCache, getCacheStats } from './cache';
import type { AppSettings, ProviderConfig, TranslateRequest, MessageResponse, TranslateResult, SettingsPatch } from '../shared/types';
import type { PromptOverrides } from '../providers/base';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, DEFAULT_ADDITIONAL_PROMPT } from '../shared/constants';

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

export async function saveSettings(partial: SettingsPatch): Promise<AppSettings> {
  const current = await getSettings();
  // The prompt fields are applied manually: the options page sends an explicit
  // `null` ("reset to default") to remove the stored override — `undefined`
  // can't express that because message serialization drops undefined-valued
  // keys. A missing key means "leave unchanged" (partial saves from popup,
  // content script, and background must keep working). An empty string is a
  // real value and is stored as-is: for `additionalPrompt` it means
  // "disabled", which is distinct from unset (= built-in default applies).
  const { promptTemplate, additionalPrompt, ...rest } = partial;
  const updated = { ...current, ...rest };
  if (promptTemplate === null) delete updated.promptTemplate;
  else if (promptTemplate !== undefined) updated.promptTemplate = promptTemplate;
  if (additionalPrompt === null) delete updated.additionalPrompt;
  else if (additionalPrompt !== undefined) updated.additionalPrompt = additionalPrompt;

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
  prompts: PromptOverrides,
): Promise<TranslateResult> {
  // The cache key must cover every user-editable prompt input (base +
  // additional). Otherwise editing any prompt would keep serving stale cached
  // translations. `||` (not `??`) mirrors buildPrompt's fallback so the tag
  // always matches the prompt that is actually rendered.
  const effectiveBase = prompts.basePrompt || DEFAULT_SYSTEM_PROMPT;
  const promptTag = prompts.additionalPrompt
    ? `${effectiveBase}\n===\n${prompts.additionalPrompt}`
    : effectiveBase;

  const cached = await getCached(
    request.text, request.sourceLang, request.targetLang, providerConfig.id, promptTag,
  );
  if (cached) return cached;

  const provider = providerManager.getProvider(providerConfig);
  // Prompt inputs are explicit arguments (resolved once in handleTranslate),
  // NOT fields on the request or the config: provider instances are cached by
  // ID in ProviderManager, so either would leak across requests.
  const result = await provider.translate(request, prompts);

  await setCache(request.text, request.sourceLang, request.targetLang, providerConfig.id, result, promptTag);

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

  // Additional prompt applies only to requests that opt in
  // (applyAdditionalPrompt is true). An unset setting falls back to the
  // default template; an explicitly cleared (empty) value disables it.
  const additionalPrompt = request.applyAdditionalPrompt
    ? (settings.additionalPrompt ?? DEFAULT_ADDITIONAL_PROMPT).trim() || undefined
    : undefined;

  const prompts: PromptOverrides = {
    basePrompt: settings.promptTemplate?.trim() || undefined,
    additionalPrompt,
  };

  let lastError = '';

  for (const providerConfig of chain) {
    try {
      const result = await translateWithProvider(request, providerConfig, prompts);
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
      return { success: true, data: await saveSettings(message.payload as SettingsPatch) };
    case 'CLEAR_CACHE':
      await clearTranslationCache();
      return { success: true, data: null };
    case 'GET_CACHE_STATS':
      return { success: true, data: await getCacheStats() };
    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}
