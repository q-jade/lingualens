import type { ProviderConfig } from '../shared/types';

const LLM_PROVIDER_TYPES: ProviderConfig['type'][] = [
  'openai-compat',
  'ollama',
  'openai',
  'lmstudio',
];

export function isLlmProvider(type: ProviderConfig['type']): boolean {
  return LLM_PROVIDER_TYPES.includes(type);
}

/** Default true when unset — disable thinking for faster translation. */
export function isThinkingDisabled(config: ProviderConfig): boolean {
  return config.disableThinking !== false;
}

export function isDeepSeekProvider(config: ProviderConfig): boolean {
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return /deepseek\.com/i.test(config.baseUrl);
  }
}

/** Zhipu (BigModel open platform / Z.ai international) GLM endpoints. */
export function isZhipuProvider(config: ProviderConfig): boolean {
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return host === 'open.bigmodel.cn' || host.endsWith('.bigmodel.cn')
      || host === 'api.z.ai' || host.endsWith('.z.ai');
  } catch {
    return /bigmodel\.cn|z\.ai/i.test(config.baseUrl);
  }
}

/** OpenRouter gateway (unified `reasoning` parameter). */
export function isOpenRouterProvider(config: ProviderConfig): boolean {
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return /openrouter\.ai/i.test(config.baseUrl);
  }
}

/** Google Gemini (its OpenAI-compatibility layer). */
export function isGeminiProvider(config: ProviderConfig): boolean {
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return host === 'generativelanguage.googleapis.com';
  } catch {
    return /generativelanguage\.googleapis\.com/i.test(config.baseUrl);
  }
}

/**
 * Alibaba Cloud Bailian (Model Studio) OpenAI-compatible gateway. The Qwen
 * preset uses the classic `dashscope.aliyuncs.com/compatible-mode/v1` host, but
 * the platform is migrating to workspace-scoped
 * `{WorkspaceId}.{region}.maas.aliyuncs.com` URLs — so match on the
 * aliyuncs.com host plus the Bailian-only `/compatible-mode` path instead of a
 * brand-specific hostname.
 */
export function isBailianProvider(config: ProviderConfig): boolean {
  try {
    const url = new URL(config.baseUrl);
    return /(^|\.)aliyuncs\.com$/i.test(url.hostname)
      && url.pathname.includes('/compatible-mode');
  } catch {
    return /aliyuncs\.com\/compatible-mode/i.test(config.baseUrl);
  }
}

/**
 * MiniMax (China `api.minimax.cn` / international `api.minimax.io`). The
 * `minimaxi.*` hosts are the same service under its legacy API domains, so
 * accept them too for people pasting an older base URL.
 */
export function isMiniMaxProvider(config: ProviderConfig): boolean {
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return host === 'api.minimax.cn' || host.endsWith('.minimax.cn')
      || host === 'api.minimax.io' || host.endsWith('.minimax.io')
      || host === 'api.minimaxi.com' || host.endsWith('.minimaxi.com')
      || host === 'api.minimaxi.chat' || host.endsWith('.minimaxi.chat');
  } catch {
    return /minimax(i)?\.(cn|io|com|chat)/i.test(config.baseUrl);
  }
}

/**
 * Extra fields merged into OpenAI-compatible chat/completions JSON (SDK `extra_body` semantics:
 * top-level keys, not a nested `"extra_body"` object).
 */
export function getOpenAICompatExtraBody(config: ProviderConfig): Record<string, unknown> {
  if (!isThinkingDisabled(config)) {
    return {};
  }

  if (isDeepSeekProvider(config)) {
    return { thinking: { type: 'disabled' } };
  }

  // GLM-5.3 / GLM-5.3-FLASH: thinking is always on and cannot be disabled;
  // its intensity is controlled by `reasoning_effort` (official docs).
  if (isZhipuProvider(config)) {
    if (/^glm-5\.3(-flash\w*)?($|[-.])/i.test(config.model ?? '')) {
      return { reasoning_effort: 'low' };
    }
    return { thinking: { type: 'disabled' } };
  }

  // OpenRouter normalises everything into a unified `reasoning` object whose
  // Chat Completions body accepts only `effort` / `summary`; `none` disables
  // reasoning entirely.
  if (isOpenRouterProvider(config)) {
    return { reasoning: { effort: 'none' } };
  }

  // Gemini's compat layer maps `reasoning_effort` onto its own per-model levels
  // (`minimal` is the lowest tier it accepts; models without a native minimal
  // level, e.g. 3.x Pro, downgrade it to low). Only the 2.5 Flash family can
  // turn reasoning off with `none`; 2.5 Pro and every 3.x model always reason.
  if (isGeminiProvider(config)) {
    if (/^gemini-2\.5-flash/i.test(config.model ?? '')) {
      return { reasoning_effort: 'none' };
    }
    return { reasoning_effort: 'minimal' };
  }

  // Bailian takes a top-level `enable_thinking` boolean (not nested under
  // `chat_template_kwargs`). It applies to hybrid-reasoning models; the default
  // Qwen preset is one of those. Thinking-only models never read it.
  if (isBailianProvider(config)) {
    return { enable_thinking: false };
  }

  // MiniMax's thinking controls differ per model family (official OpenAI-compat
  // docs): `reasoning_effort` is honoured by M3.1-Flash-Preview only, and that
  // model always reasons — `thinking.type = "disabled"` fails with a 400
  // ("requires adaptive thinking"), so the lowest effort tier is the closest
  // thing to switching it off. Plain M3 does accept the explicit disable and
  // then answers without thinking. M2.x accepts `disabled` but ignores it, so
  // the field is left out rather than sent as a no-op.
  if (isMiniMaxProvider(config)) {
    const model = config.model ?? '';
    if (/^minimax-m3\.1/i.test(model)) {
      return { reasoning_effort: 'low' };
    }
    if (/^minimax-m3($|[-.])/i.test(model)) {
      return { thinking: { type: 'disabled' } };
    }
    return {};
  }

  return {
    chat_template_kwargs: { enable_thinking: false },
    reasoning_effort: 'none',
  };
}

/** LM Studio native `/api/v1/chat` — see capabilities.reasoning on GET /api/v1/models. */
export function getLmStudioServerOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function getLmStudioThinkingFields(config: ProviderConfig): Record<string, unknown> {
  if (!isThinkingDisabled(config)) {
    return {};
  }
  return { reasoning: 'off' };
}

/** Extra JSON fields merged into LLM chat request bodies when thinking is disabled. */
export function getThinkingDisableRequestFields(
  config: ProviderConfig,
): Record<string, unknown> {
  if (!isLlmProvider(config.type) || !isThinkingDisabled(config)) {
    return {};
  }

  switch (config.type) {
    case 'ollama':
      return { think: false };
    case 'openai-compat':
    case 'openai':
      return getOpenAICompatExtraBody(config);
    case 'lmstudio':
      return getLmStudioThinkingFields(config);
    default:
      return {};
  }
}
