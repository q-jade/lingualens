import { BaseProvider, type PromptOverrides, type TranslateCallOptions } from './base';
import { getThinkingDisableRequestFields } from './thinking';
import { StreamCapabilityError } from './stream-capability';
import type { TranslateRequest, TranslateImageRequest, TranslateResult } from '../shared/types';

export class OllamaProvider extends BaseProvider {
  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async translate(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { temperature: 0.3 },
        stream: false,
        ...getThinkingDisableRequestFields(this.config),
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

  async *translateStream(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): AsyncGenerator<string> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { temperature: 0.3 },
        stream: true,
        ...getThinkingDisableRequestFields(this.config),
      }),
    });

    if (!res.ok) {
      // 4xx on a streaming request: the endpoint rejects the stream parameter
      // itself — a capability rejection the non-stream fallback can recover
      // from. 5xx/429 stay transient and must not poison the health memory.
      const body = await res.text();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new StreamCapabilityError(`Ollama error ${res.status}: ${body}`);
      }
      throw new Error(`Ollama error ${res.status}: ${body}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    // Capability detection: Ollama streams NDJSON — a body with no parseable
    // non-empty line at all means `stream:true` was ignored (proxy/older
    // server answered a plain JSON or error object instead).
    let sawNdjson = false;
    let received = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const decoded = decoder.decode(value, { stream: true });
      received += decoded;
      buffer += decoded;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          sawNdjson = true;
          if (parsed.message?.content) yield parsed.message.content;
          if (parsed.done) return;
        } catch {
          /* skip malformed lines */
        }
      }
    }

    if (!sawNdjson) {
      const preview = received.trim().slice(0, 200);
      throw new StreamCapabilityError(
        `Streaming response contained no NDJSON lines. Body preview: ${preview}`,
      );
    }
  }

  /**
   * Vision request: Ollama takes images as base64 (WITHOUT the data-URL
   * prefix) in an `images` array on the message.
   */
  async translateImage(
    request: TranslateImageRequest,
    prompt: string,
  ): Promise<TranslateResult> {
    if (!request.image) throw new Error('Image data missing');
    const base64 = request.image.replace(/^data:[^,]*,/, '');

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: '', images: [base64] },
        ],
        options: { temperature: 0.3 },
        stream: false,
        ...getThinkingDisableRequestFields(this.config),
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

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Throws on failure (network error, non-2xx) so the caller can show the
   * cause; an empty list only means the server is reachable but has no models.
   */
  async getAvailableModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  }
}
