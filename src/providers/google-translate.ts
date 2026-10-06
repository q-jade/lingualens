import { BaseProvider, type PromptOverrides, type TranslateCallOptions } from './base';
import { toGoogleLang } from '../shared/languages';
import type { TranslateRequest, TranslateResult } from '../shared/types';

export class GoogleTranslateProvider extends BaseProvider {
  private get apiUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/language/translate/v2`;
  }

  async translate(
    request: TranslateRequest,
    _prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): Promise<TranslateResult> {
    const params = new URLSearchParams({
      q: request.text,
      target: toGoogleLang(request.targetLang),
      format: 'text',
      key: this.config.apiKey || '',
    });
    if (request.sourceLang !== 'auto') {
      params.set('source', toGoogleLang(request.sourceLang));
    }

    const res = await fetch(`${this.apiUrl}?${params}`, {
      method: 'POST',
      signal: options?.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Translate error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const translated = data.data?.translations?.[0]?.translatedText ?? '';

    return {
      translated,
      provider: this.config.name,
      cached: false,
    };
  }

  async *translateStream(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): AsyncGenerator<string> {
    const result = await this.translate(request, prompts, options);
    yield result.translated;
  }

  async testConnection(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        q: 'hello',
        target: 'zh-CN',
        format: 'text',
        key: this.config.apiKey || '',
      });
      const res = await fetch(`${this.apiUrl}?${params}`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }
}
