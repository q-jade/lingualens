import { BaseProvider } from './base';
import { toDeepLLang } from '../shared/languages';
import type { TranslateRequest, TranslateResult } from '../shared/types';

export class DeepLProvider extends BaseProvider {
  private get apiUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/v2/translate`;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `DeepL-Auth-Key ${this.config.apiKey || ''}`,
    };
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const body: Record<string, unknown> = {
      text: [request.text],
      target_lang: toDeepLLang(request.targetLang),
    };
    if (request.sourceLang !== 'auto') {
      body.source_lang = toDeepLLang(request.sourceLang);
    }

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`DeepL error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const translated = data.translations?.[0]?.text ?? '';

    return {
      translated,
      provider: this.config.name,
      cached: false,
    };
  }

  async *translateStream(_request: TranslateRequest): AsyncGenerator<string> {
    const result = await this.translate(_request);
    yield result.translated;
  }

  async testConnection(): Promise<boolean> {
    try {
      const base = this.config.baseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/v2/usage`, { headers: this.headers });
      return res.ok;
    } catch {
      return false;
    }
  }
}
