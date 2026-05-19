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
