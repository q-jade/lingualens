import type { TranslateRequest, TranslateImageRequest, TranslateResult, ProviderConfig } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_IMAGE_TRANSLATION_PROMPT } from '../shared/constants';
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
   * Translate the text inside an image. Optional: only vision-capable LLM
   * providers implement it (text-only APIs like DeepL/Google never do). The
   * prompt is the built-in image template with placeholders already
   * substituted — providers must not apply PromptOverrides to it.
   */
  translateImage?(
    request: TranslateImageRequest,
    prompt: string,
  ): Promise<TranslateResult>;

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

  /**
   * Substitute {sourceLang}/{targetLang} in the built-in image prompt. Same
   * placeholder semantics as buildPrompt (auto → "the detected source
   * language"), but no PromptOverrides: the image prompt is built-in and
   * never user-editable.
   */
  buildImagePrompt(request: TranslateImageRequest): string {
    const sourceLabel = request.sourceLang === 'auto'
      ? 'the detected source language'
      : getLanguageName(request.sourceLang);
    const targetLabel = getLanguageName(request.targetLang);
    return DEFAULT_IMAGE_TRANSLATION_PROMPT
      .replace(/\{sourceLang\}/g, sourceLabel)
      .replace(/\{targetLang\}/g, targetLabel);
  }
}
