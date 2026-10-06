import { ProviderManager } from '../providers/manager';
import { getCached, setCache, clearCache as clearTranslationCache, getCacheStats } from './cache';
import type { AppSettings, ProviderConfig, TranslateRequest, TranslateImageRequest, MessageResponse, TranslateResult, SettingsPatch, StreamPortMessage } from '../shared/types';
import type { PromptOverrides, TranslateCallOptions } from '../providers/base';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, DEFAULT_ADDITIONAL_PROMPT, DEFAULT_IMAGE_TRANSLATION_PROMPT } from '../shared/constants';
import { isLlmProvider } from '../providers/thinking';
import { isStreamCapabilityRejection } from '../providers/stream-capability';
import { streamHealth } from './stream-health';
import type { Browser } from '@wxt-dev/browser';

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

/**
 * Resolve the prompt overrides for a text translate request — the single
 * decision point shared by the one-shot and the streaming handler. Additional
 * prompt applies only to requests that opt in (`applyAdditionalPrompt`); an
 * unset setting falls back to the default template, an explicitly cleared
 * (empty) value disables it.
 */
function resolvePrompts(request: TranslateRequest, settings: AppSettings): PromptOverrides {
  const additionalPrompt = request.applyAdditionalPrompt
    ? (settings.additionalPrompt ?? DEFAULT_ADDITIONAL_PROMPT).trim() || undefined
    : undefined;

  return {
    basePrompt: settings.promptTemplate?.trim() || undefined,
    additionalPrompt,
  };
}

/**
 * Cache key tag for a text translation. Must cover every user-editable
 * prompt input (base + additional): editing any prompt would otherwise keep
 * serving stale cached translations. `||` (not `??`) mirrors buildPrompt's
 * fallback so the tag always matches the prompt that is actually rendered.
 */
function textCachePromptTag(prompts: PromptOverrides): string {
  const effectiveBase = prompts.basePrompt || DEFAULT_SYSTEM_PROMPT;
  return prompts.additionalPrompt
    ? `${effectiveBase}\n===\n${prompts.additionalPrompt}`
    : effectiveBase;
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
  // The cache tag covers every user-editable prompt input — see
  // textCachePromptTag.
  const promptTag = textCachePromptTag(prompts);
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
  // (applyAdditionalPrompt is true) — shared with the streaming handler, see
  // resolvePrompts.
  const prompts = resolvePrompts(request, settings);

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

/**
 * Image translation: only vision-capable LLM providers participate. The prompt
 * is the built-in image template — promptTemplate / additionalPrompt settings
 * never apply. The cache key uses the image URL (not the pixel data) plus an
 * `image:` prompt-tag namespace, so image and text translations never collide.
 */
export async function handleTranslateImage(
  request: TranslateImageRequest,
): Promise<MessageResponse<TranslateResult>> {
  const settings = await getSettings();
  const chain = buildProviderChain(settings).filter(
    (p) => isLlmProvider(p.type) && p.supportsImage !== false,
  );

  if (chain.length === 0) {
    return { success: false, error: 'NO_IMAGE_PROVIDER' };
  }
  if (!request.image) {
    return { success: false, error: 'IMAGE_FETCH_FAILED' };
  }

  const promptTag = `image:${DEFAULT_IMAGE_TRANSLATION_PROMPT}`;
  let lastError = '';

  for (const providerConfig of chain) {
    try {
      const cached = await getCached(
        request.imageUrl, request.sourceLang, request.targetLang, providerConfig.id, promptTag,
      );
      if (cached) return { success: true, data: cached };

      const provider = providerManager.getProvider(providerConfig);
      if (!provider.translateImage) continue;

      const prompt = provider.buildImagePrompt(request);
      const result = await provider.translateImage(request, prompt);

      await setCache(
        request.imageUrl, request.sourceLang, request.targetLang, providerConfig.id, result, promptTag,
      );
      return { success: true, data: result };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'TRANSLATION_FAILED';
    }
  }

  return { success: false, error: lastError || 'TRANSLATION_FAILED' };
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

/**
 * List the models a provider offers (LLM providers only). A fresh, uncached
 * provider instance is used so recently edited baseUrl/apiKey take effect
 * without a save round-trip.
 */
export async function handleListModels(
  providerConfig: ProviderConfig,
): Promise<MessageResponse<string[]>> {
  try {
    const provider = providerManager.getProvider(providerConfig, { useCache: false });
    if (!provider.getAvailableModels) {
      return { success: false, error: 'MODELS_NOT_SUPPORTED' };
    }
    return { success: true, data: await provider.getAvailableModels() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to list models' };
  }
}

export async function handleMessage(message: Record<string, unknown>): Promise<MessageResponse> {
  switch (message.type) {
    case 'TRANSLATE':
      return handleTranslate(message.payload as TranslateRequest);
    case 'TRANSLATE_IMAGE':
      return handleTranslateImage(message.payload as TranslateImageRequest);
    case 'VERIFY_CONFIG':
      return handleVerifyConfig((message.payload as { providerConfig: ProviderConfig }).providerConfig);
    case 'LIST_MODELS':
      return handleListModels((message.payload as { providerConfig: ProviderConfig }).providerConfig);
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

/**
 * Streaming translation over a long-lived `translate-stream` Port. The port
 * is required because `runtime.sendMessage` can only answer once and cannot
 * carry a stream: the provider's AsyncGenerator is forwarded chunk by chunk.
 *
 * Orchestration per provider in the fallback chain:
 * 1. Cache hit → degrade to a single `chunk` + `done` (identical client
 *    behavior, no special casing needed on the UI side).
 * 2. `streamHealth.shouldTryStream` gate → try `translateStream`, forwarding
 *    every delta as a `chunk` message.
 * 3. Failure BEFORE the first delivered chunk → record capability failures
 *    in the health memory (transient ones are NOT recorded — see
 *    stream-health.ts) and transparently retry non-streaming on the SAME
 *    provider. Still failing → the next provider in the chain.
 * 4. Failure AFTER chunks were delivered → `error` only. Retrying would
 *    splice provider A's partial text together with provider B's text.
 *
 * The AbortController's signal follows both the streaming attempt and the
 * non-stream fallback: UI `port.disconnect()` (panel closed, new request)
 * cancels the whole orchestration.
 */
export function handleTranslateStreamPort(port: Browser.runtime.Port): void {
  port.onMessage.addListener(async (raw: unknown) => {
    const msg = raw as StreamPortMessage;
    if (msg?.type !== 'start') return;
    const request = msg.payload as TranslateRequest;

    try {
      const settings = await getSettings();
      const chain = buildProviderChain(settings);
      if (chain.length === 0) {
        port.postMessage({ type: 'error', error: 'NO_PROVIDER' } satisfies StreamPortMessage);
        return;
      }
      const prompts = resolvePrompts(request, settings);
      const promptTag = textCachePromptTag(prompts);
      const options: TranslateCallOptions = {};

      // Disconnect = cancel: abort the in-flight fetches of THIS request.
      const controller = new AbortController();
      options.signal = controller.signal;
      port.onDisconnect.addListener(() => controller.abort());

      let lastError = '';

      for (const providerConfig of chain) {
        // 1. Cache hit — degrade to one chunk + done.
        try {
          const cached = await getCached(
            request.text, request.sourceLang, request.targetLang, providerConfig.id, promptTag,
          );
          if (cached) {
            port.postMessage({ type: 'chunk', delta: cached.translated } satisfies StreamPortMessage);
            port.postMessage({ type: 'done', result: cached } satisfies StreamPortMessage);
            return;
          }
        } catch {
          /* cache read failure is non-fatal — proceed to the provider */
        }

        const provider = providerManager.getProvider(providerConfig);
        const tryStream = isLlmProvider(providerConfig.type)
          && streamHealth.shouldTryStream(providerConfig.id);

        // 2. Streaming attempt with per-chunk forwarding.
        if (tryStream) {
          let delivered = false;
          let full = '';
          try {
            for await (const delta of provider.translateStream(request, prompts, options)) {
              // Forward EVERY non-empty delta verbatim — a whitespace-only
              // delta is real content (paragraph breaks often arrive as a
              // standalone "\n"); trimming here would swallow them.
              if (delta) {
                delivered = true;
                full += delta;
                port.postMessage({ type: 'chunk', delta } satisfies StreamPortMessage);
              }
            }
            if (!full.trim()) throw new Error('Provider returned an empty stream');

            streamHealth.recordSuccess(providerConfig.id);
            const result: TranslateResult = {
              translated: full.trim(),
              provider: providerConfig.name,
              cached: false,
            };
            // Same cache semantics as the one-shot path — written only after
            // the full text is known.
            await setCache(
              request.text, request.sourceLang, request.targetLang, providerConfig.id, result, promptTag,
            );
            port.postMessage({ type: 'done', result } satisfies StreamPortMessage);
            return;
          } catch (err) {
            if (controller.signal.aborted) return; // UI cancelled — stay silent
            if (delivered) {
              // 4. Mid-stream failure: chunks are already on the wire, a
              // retry would splice two translations together.
              port.postMessage({
                type: 'error',
                error: err instanceof Error ? err.message : 'TRANSLATION_FAILED',
              } satisfies StreamPortMessage);
              return;
            }
            // 3. Failed before the first chunk → transparent fallback below.
            if (isStreamCapabilityRejection(err)) {
              streamHealth.recordCapabilityFailure(providerConfig.id);
            }
            lastError = err instanceof Error ? err.message : 'TRANSLATION_FAILED';
          }
        }

        // 3. Non-stream fallback on the SAME provider (first-chunk window
        // only — delivered === true never reaches here). The signal keeps
        // the degraded attempt cancellable too.
        try {
          const result = await provider.translate(request, prompts, options);
          await setCache(
            request.text, request.sourceLang, request.targetLang, providerConfig.id, result, promptTag,
          );
          // Degrade to one chunk + done so the client renders identically.
          port.postMessage({ type: 'chunk', delta: result.translated } satisfies StreamPortMessage);
          port.postMessage({ type: 'done', result } satisfies StreamPortMessage);
          return;
        } catch (err) {
          if (controller.signal.aborted) return;
          lastError = err instanceof Error ? err.message : 'TRANSLATION_FAILED';
          // Next provider in the chain.
        }
      }

      if (!controller.signal.aborted) {
        port.postMessage({ type: 'error', error: lastError || 'TRANSLATION_FAILED' } satisfies StreamPortMessage);
      }
    } catch (err) {
      // Outer guard: settings/provider construction failed. A disconnected
      // port throws on postMessage — swallow that, surface anything else.
      try {
        port.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : 'TRANSLATION_FAILED',
        } satisfies StreamPortMessage);
      } catch {
        /* port already disconnected */
      }
    }
  });
}
