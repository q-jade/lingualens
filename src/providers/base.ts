import type { TranslateRequest, TranslateResult, ProviderConfig } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT } from '../shared/constants';

export abstract class BaseProvider {
  constructor(protected config: ProviderConfig) {}

  abstract translate(request: TranslateRequest): Promise<TranslateResult>;

  abstract translateStream(request: TranslateRequest): AsyncGenerator<string>;

  abstract testConnection(): Promise<boolean>;

  getAvailableModels?(): Promise<string[]>;

  protected buildPrompt(request: TranslateRequest): { system: string; user: string } {
    const systemPrompt = (this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace('{sourceLang}', request.sourceLang === 'auto' ? 'the source language' : request.sourceLang)
      .replace('{targetLang}', request.targetLang);

    return { system: systemPrompt, user: request.text };
  }
}
