import type { TranslateRequest, TranslateResult, ProviderConfig } from '../shared/types';
import { DEFAULT_SYSTEM_PROMPT } from '../shared/constants';
import { getLanguageName } from '../shared/languages';

export abstract class BaseProvider {
  constructor(protected config: ProviderConfig) {}

  abstract translate(request: TranslateRequest): Promise<TranslateResult>;

  abstract translateStream(request: TranslateRequest): AsyncGenerator<string>;

  abstract testConnection(): Promise<boolean>;

  getAvailableModels?(): Promise<string[]>;

  protected buildPrompt(request: TranslateRequest): { system: string; user: string } {
    const sourceLabel = request.sourceLang === 'auto'
      ? 'the source language'
      : getLanguageName(request.sourceLang);
    const targetLabel = getLanguageName(request.targetLang);

    const systemPrompt = (this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace('{sourceLang}', sourceLabel)
      .replace('{targetLang}', targetLabel);

    return { system: systemPrompt, user: request.text };
  }
}
