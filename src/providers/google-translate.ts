import { BaseProvider } from './base';
import type { TranslateRequest, TranslateResult } from '../shared/types';

const LANG_MAP: Record<string, string> = {
  zh: 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  ru: 'ru',
  ar: 'ar',
};

export class GoogleTranslateProvider extends BaseProvider {
  private get apiUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/language/translate/v2`;
  }

  private mapLang(code: string): string {
    return LANG_MAP[code] || code;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const params = new URLSearchParams({
      q: request.text,
      target: this.mapLang(request.targetLang),
      format: 'text',
      key: this.config.apiKey || '',
    });
    if (request.sourceLang !== 'auto') {
      params.set('source', this.mapLang(request.sourceLang));
    }

    const res = await fetch(`${this.apiUrl}?${params}`, { method: 'POST' });

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

  async *translateStream(_request: TranslateRequest): AsyncGenerator<string> {
    const result = await this.translate(_request);
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
