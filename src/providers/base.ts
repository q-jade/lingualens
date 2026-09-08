import type { TranslateRequest, TranslateResult, ProviderConfig } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT } from '../shared/constants';
import { getLanguageName } from '../shared/languages';

/**
 * Prompt inputs resolved by the background (single decision point) and passed
 * explicitly to the provider call — never carried on the request or the config.
 */
export interface PromptOverrides {
  /** Base system prompt (global template ?? default). */
  basePrompt?: string;
  /** Supplementary prompt (selection/popup/side panel only). */
  additionalPrompt?: string;
}

export abstract class BaseProvider {
  constructor(protected config: ProviderConfig) {}

  abstract translate(
    request: TranslateRequest,
    prompts?: PromptOverrides,
  ): Promise<TranslateResult>;

  abstract translateStream(
    request: TranslateRequest,
    prompts?: PromptOverrides,
  ): AsyncGenerator<string>;

  abstract testConnection(): Promise<boolean>;

  getAvailableModels?(): Promise<string[]>;

  /**
   * Compose the system prompt: base prompt (global template ?? default) plus
   * the optional additional prompt. Pure composition — whether/what to attach
   * is decided upstream, never here.
   */
  protected buildPrompt(
    request: TranslateRequest,
    prompts?: PromptOverrides,
  ): { system: string; user: string } {
    const sourceLabel = request.sourceLang === 'auto'
      ? 'the detected source language'
      : getLanguageName(request.sourceLang);
    const targetLabel = getLanguageName(request.targetLang);

    // Global flags: a template may reference a placeholder more than once.
    const substitute = (template: string) =>
      template
        .replace(/\{sourceLang\}/g, sourceLabel)
        .replace(/\{targetLang\}/g, targetLabel);

    let systemPrompt = substitute(prompts?.basePrompt || DEFAULT_SYSTEM_PROMPT);

    if (prompts?.additionalPrompt) {
      systemPrompt += ` ${substitute(prompts.additionalPrompt)}`;
    }

    return { system: systemPrompt, user: request.text };
  }
}
