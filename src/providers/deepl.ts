import { BaseProvider } from './base';
import type { TranslateRequest, TranslateResult } from '../shared/types';

const LANG_MAP: Record<string, string> = {
  en: 'EN',
  zh: 'ZH',
  ja: 'JA',
  ko: 'KO',
  fr: 'FR',
  de: 'DE',
  es: 'ES',
  pt: 'PT',
  ru: 'RU',
  ar: 'AR',
};

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

  private mapLang(code: string): string {
    return LANG_MAP[code] || code.toUpperCase();
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const body: Record<string, unknown> = {
      text: [request.text],
      target_lang: this.mapLang(request.targetLang),
    };
    if (request.sourceLang !== 'auto') {
      body.source_lang = this.mapLang(request.sourceLang);
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
