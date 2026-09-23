import { BaseProvider, type PromptOverrides } from './base';
import { getOpenAICompatExtraBody } from './thinking';
import type { TranslateRequest, TranslateImageRequest, TranslateResult } from '../shared/types';

/** OpenAI vision content part: text or image (data URL or https URL). */
type ChatContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export class OpenAICompatProvider extends BaseProvider {
  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) h['Authorization'] = `Bearer ${this.config.apiKey}`;
    return h;
  }

  private buildChatCompletionBody(
    messages: { role: string; content: ChatContent }[],
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model: this.config.model,
      messages,
      temperature: 0.3,
      stream,
      // Same as OpenAI SDK extra_body: merged into the request JSON root.
      ...getOpenAICompatExtraBody(this.config),
    };
  }

  async translate(request: TranslateRequest, prompts?: PromptOverrides): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(
        this.buildChatCompletionBody(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          false,
        ),
      ),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return {
      translated: data.choices?.[0]?.message?.content?.trim() ?? '',
      provider: this.config.name,
      cached: false,
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async *translateStream(request: TranslateRequest, prompts?: PromptOverrides): AsyncGenerator<string> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(
        this.buildChatCompletionBody(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          true,
        ),
      ),
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);

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
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          /* skip malformed chunks */
        }
      }
    }
  }

  /**
   * Vision request: the built-in image prompt as the system message, the image
   * as an image_url content part (data URLs are accepted by every
   * OpenAI-compatible vision endpoint).
   */
  async translateImage(
    request: TranslateImageRequest,
    prompt: string,
  ): Promise<TranslateResult> {
    if (!request.image) throw new Error('Image data missing');

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(
        this.buildChatCompletionBody(
          [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: request.image } }],
            },
          ],
          false,
        ),
      ),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return {
      translated: data.choices?.[0]?.message?.content?.trim() ?? '',
      provider: this.config.name,
      cached: false,
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((m: { id: string }) => m.id);
    } catch {
      return [];
    }
  }
}
