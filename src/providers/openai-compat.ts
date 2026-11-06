import { BaseProvider, type PromptOverrides, type TranslateCallOptions } from './base';
import { getOpenAICompatExtraBody } from './thinking';
import { StreamCapabilityError } from './stream-capability';
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

  async translate(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
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

  /**
   * Classify a failed streaming response: 4xx (except 429) means the endpoint
   * rejects the `stream` parameter itself (gateways that only do plain
   * request/response) — a capability rejection the non-stream fallback can
   * recover from. 5xx/429 stay generic: they are transient and must not poison
   * the streaming-health memory.
   */
  private streamFailure(status: number, detail: string): Error {
    if (status >= 400 && status < 500 && status !== 429) {
      return new StreamCapabilityError(`API error ${status}: ${detail}`);
    }
    return new Error(`API error ${status}: ${detail}`);
  }

  /**
   * Parse an OpenAI-compatible SSE body, yielding `choices[0].delta.content`.
   * A 200 response carrying NO `data:` line at all means the server ignored
   * `stream:true` and answered plain JSON (or an error object) — reported as a
   * capability rejection so the caller can fall back to the one-shot request.
   */
  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Capability detection: did any `data:` line arrive at all?
    let sawDataLine = false;
    // Full raw body for the capability-error preview (after split/pop).
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
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        sawDataLine = true;
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

    if (!sawDataLine) {
      const preview = received.trim().slice(0, 200);
      throw new StreamCapabilityError(
        `Streaming response contained no SSE events. Body preview: ${preview}`,
      );
    }
  }

  async *translateStream(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): AsyncGenerator<string> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
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

    if (!res.ok) throw this.streamFailure(res.status, await res.text());

    if (!res.body) throw new Error('No response body');

    yield* this.parseSSEStream(res.body);
  }

  /**
   * Vision messages: the built-in image prompt as the system message, the image
   * as an image_url content part (data URLs are accepted by every
   * OpenAI-compatible vision endpoint). Shared by the one-shot and streaming
   * image paths so they cannot drift apart.
   */
  private buildImageMessages(
    prompt: string,
    image: string,
  ): { role: string; content: ChatContent }[] {
    return [
      { role: 'system', content: prompt },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] },
    ];
  }

  /** Vision request: one-shot, no deltas. */
  async translateImage(
    request: TranslateImageRequest,
    prompt: string,
    options?: TranslateCallOptions,
  ): Promise<TranslateResult> {
    if (!request.image) throw new Error('Image data missing');

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
      body: JSON.stringify(
        this.buildChatCompletionBody(this.buildImageMessages(prompt, request.image), false),
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

  /**
   * Vision request with `stream:true`, parsed with the same SSE loop as text
   * translation. Deltas are the model's raw output — the caller trims the
   * accumulated text before caching or reporting it.
   */
  async *translateImageStream(
    request: TranslateImageRequest,
    prompt: string,
    options?: TranslateCallOptions,
  ): AsyncGenerator<string> {
    if (!request.image) throw new Error('Image data missing');

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
      body: JSON.stringify(
        this.buildChatCompletionBody(this.buildImageMessages(prompt, request.image), true),
      ),
    });

    if (!res.ok) throw this.streamFailure(res.status, await res.text());

    if (!res.body) throw new Error('No response body');

    yield* this.parseSSEStream(res.body);
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
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
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((m: { id: string }) => m.id);
  }
}
