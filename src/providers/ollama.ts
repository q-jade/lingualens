import { BaseProvider } from './base';
import type { TranslateRequest, TranslateResult } from '../shared/types';

export class OllamaProvider extends BaseProvider {
  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model || 'llama3',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          'Ollama rejected the request (403 Forbidden). Start Ollama with: OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
        );
      }
      const body = await res.text();
      throw new Error(`Ollama error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return {
      translated: data.message?.content?.trim() ?? '',
      provider: this.config.name,
      cached: false,
      tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
    };
  }

  async *translateStream(request: TranslateRequest): AsyncGenerator<string> {
    const { system, user } = this.buildPrompt(request);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model || 'llama3',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`Ollama error ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) yield parsed.message.content;
          if (parsed.done) return;
        } catch {
          /* skip malformed lines */
        }
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map((m: { name: string }) => m.name);
    } catch {
      return [];
    }
  }
}
