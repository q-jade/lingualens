import type { ProviderConfig } from '../shared/types';
import { getProviderBrand } from '../shared/provider-brand';

const LLM_PROVIDER_TYPES: ProviderConfig['type'][] = [
  'openai-compat',
  'ollama',
  'lmstudio',
];

export function isLlmProvider(type: ProviderConfig['type']): boolean {
  return LLM_PROVIDER_TYPES.includes(type);
}

/** Default true when unset — disable thinking for faster translation. */
export function isThinkingDisabled(config: ProviderConfig): boolean {
  return config.disableThinking !== false;
}

/**
 * Extra fields merged into OpenAI-compatible chat/completions JSON (SDK `extra_body` semantics:
 * top-level keys, not a nested `"extra_body"` object).
 */
export function getOpenAICompatExtraBody(config: ProviderConfig): Record<string, unknown> {
  if (!isThinkingDisabled(config)) {
    return {};
  }

  // The vendor is resolved from the base URL (`shared/provider-brand`), so a
  // hand-entered URL gets the same treatment as a preset. Only one brand can
  // match, so these branches are order-independent.
  const brand = getProviderBrand(config.baseUrl);

  if (brand === 'deepseek') {
    return { thinking: { type: 'disabled' } };
  }

  // GLM-5.3 / GLM-5.3-FLASH: thinking is always on and cannot be disabled;
  // its intensity is controlled by `reasoning_effort` (official docs).
  if (brand === 'zhipu') {
    if (/^glm-5\.3(-flash\w*)?($|[-.])/i.test(config.model ?? '')) {
      return { reasoning_effort: 'low' };
    }
    return { thinking: { type: 'disabled' } };
  }

  // OpenRouter normalises everything into a unified `reasoning` object whose
  // Chat Completions body accepts only `effort` / `summary`; `none` disables
  // reasoning entirely.
  if (brand === 'openrouter') {
    return { reasoning: { effort: 'none' } };
  }

  // Gemini's compat layer maps `reasoning_effort` onto its own per-model levels
  // (`minimal` is the lowest tier it accepts; models without a native minimal
  // level, e.g. 3.x Pro, downgrade it to low). Only the 2.5 Flash family can
  // turn reasoning off with `none`; 2.5 Pro and every 3.x model always reason.
  if (brand === 'gemini') {
    if (/^gemini-2\.5-flash/i.test(config.model ?? '')) {
      return { reasoning_effort: 'none' };
    }
    return { reasoning_effort: 'minimal' };
  }

  // The Qwen preset is served by the Bailian gateway, which takes a top-level
  // `enable_thinking` boolean (not nested under `chat_template_kwargs`). It
  // applies to hybrid-reasoning models; the default Qwen preset is one of
  // those. Thinking-only models never read it.
  if (brand === 'qwen') {
    return { enable_thinking: false };
  }

  // MiniMax's thinking controls differ per model family (official OpenAI-compat
  // docs): `reasoning_effort` is honoured by M3.1-Flash-Preview only, and that
  // model always reasons — `thinking.type = "disabled"` fails with a 400
  // ("requires adaptive thinking"), so the lowest effort tier is the closest
  // thing to switching it off. Plain M3 does accept the explicit disable and
  // then answers without thinking. M2.x accepts `disabled` but ignores it, so
  // the field is left out rather than sent as a no-op.
  if (brand === 'minimax') {
    const model = config.model ?? '';
    if (/^minimax-m3\.1/i.test(model)) {
      return { reasoning_effort: 'low' };
    }
    if (/^minimax-m3($|[-.])/i.test(model)) {
      return { thinking: { type: 'disabled' } };
    }
    return {};
  }

  // NVIDIA NIM's reasoning switch is per model family. The Nemotron family
  // reads `chat_template_kwargs.enable_thinking` (its own snippets translate
  // `reasoning_effort: "none"` into exactly that, and nemotron-3.5-lightning
  // declares no `reasoning_effort` field at all), so send only that key there.
  // gpt-oss is the exception: its `reasoning_effort` enum is
  // low|medium|high with no `none`, so reasoning cannot be switched off and
  // the lowest tier is the best available.
  if (brand === 'nvidia') {
    if (/^openai\/gpt-oss/i.test(config.model ?? '')) {
      return { reasoning_effort: 'low' };
    }
    return { chat_template_kwargs: { enable_thinking: false } };
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
      return getOpenAICompatExtraBody(config);
    case 'lmstudio':
      return getLmStudioThinkingFields(config);
    default:
      return {};
  }
}
