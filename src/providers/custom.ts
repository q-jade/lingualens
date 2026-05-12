import { BaseProvider } from './base';
import type { TranslateRequest, TranslateResult, ProviderConfig } from '../shared/types';

export interface CustomProviderTemplate {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  bodyTemplate: string;
  responsePath: string;
}

const DEFAULT_TEMPLATE: CustomProviderTemplate = {
  url: '',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  bodyTemplate: '{"text":"{{text}}","source":"{{sourceLang}}","target":"{{targetLang}}"}',
  responsePath: 'data.translation',
};

export interface CustomProviderConfig extends ProviderConfig {
  template?: CustomProviderTemplate;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function getByPath(obj: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : JSON.stringify(current ?? '');
}

export class CustomProvider extends BaseProvider {
  private get template(): CustomProviderTemplate {
    return (this.config as CustomProviderConfig).template ?? DEFAULT_TEMPLATE;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const tpl = this.template;
    const vars: Record<string, string> = {
      text: request.text,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      apiKey: this.config.apiKey ?? '',
      model: this.config.model ?? '',
    };

    const url = interpolate(tpl.url || this.config.baseUrl, vars);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(tpl.headers)) {
      headers[k] = interpolate(v, vars);
    }

    const fetchOpts: RequestInit = { method: tpl.method, headers };
    if (tpl.method !== 'GET') {
      fetchOpts.body = interpolate(tpl.bodyTemplate, vars);
    }

    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Custom API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const translated = getByPath(data, tpl.responsePath);

    return { translated, provider: this.config.name, cached: false };
  }

  async *translateStream(_request: TranslateRequest): AsyncGenerator<string> {
    const result = await this.translate(_request);
    yield result.translated;
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh',
      });
      return result.translated.length > 0;
    } catch {
      return false;
    }
  }
}
