import { BaseProvider, type PromptOverrides, type TranslateCallOptions } from './base';
import { getLmStudioThinkingFields, getLmStudioServerOrigin } from './thinking';
import { StreamCapabilityError } from './stream-capability';
import type { TranslateRequest, TranslateImageRequest, TranslateResult } from '../shared/types';

interface LmStudioOutputItem {
  type?: string;
  content?: string;
}

/** Typed item of the native v1 `input` array (text or image). */
interface LmStudioInputItem {
  type: 'text' | 'image';
  content?: string;
  data_url?: string;
}

interface LmStudioChatResponse {
  output?: LmStudioOutputItem[];
  stats?: {
    input_tokens?: number;
    total_output_tokens?: number;
  };
}

/**
 * Payload of a native v1 streaming event (`event: <type>` + `data: <JSON>`).
 * Only the fields this provider consumes are typed; the rest is ignored.
 */
interface LmStudioStreamEvent {
  type?: string;
  content?: string;
  error?: { message?: string };
}

/**
 * Parse LM Studio's native v1 streaming response: NAMED Server-Sent Events —
 * each event is an `event: <type>` line immediately followed by a
 * `data: <JSON>` line. Unlike the OpenAI SSE format the event type cannot be
 * derived from the data payload alone, so the parser tracks the current event
 * name across lines.
 *
 * Yields only `message.delta` content (the translation). `reasoning.delta`
 * also carries a `content` field but must be skipped (thinking is disabled by
 * default via `getLmStudioThinkingFields`, but a reasoning-capable model may
 * still emit the events). `error` events are thrown; `chat.end` terminates.
 */
async function* parseLmStudioStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Full raw body for the capability-error preview: after split/pop.
  let received = '';
  let currentEvent = '';
  let sawEvent = false;

  const handleData = (data: string): string | null => {
    let parsed: LmStudioStreamEvent | undefined;
    try {
      parsed = JSON.parse(data) as LmStudioStreamEvent;
    } catch {
      return null; // skip malformed payload
    }
    const type = parsed?.type ?? currentEvent;
    if (type === 'message.delta' && parsed.content) return parsed.content;
    if (type === 'error') {
      throw new Error(`LM Studio stream error: ${parsed.error?.message ?? 'unknown'}`);
    }
    // chat.start / message.end / reasoning.* / model_load.* / prompt_processing.* / chat.end: ignored here
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const decoded = decoder.decode(value, { stream: true });
    received += decoded;
    buffer += decoded;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        sawEvent = true;
        const text = handleData(line.slice(5).trim());
        if (text) yield text;
      }
    }
  }

  if (!sawEvent) {
    const preview = received.trim().slice(0, 200);
    throw new StreamCapabilityError(
      `Streaming response contained no SSE events. Body preview: ${preview}`,
    );
  }
}

function extractTranslatedText(output: LmStudioOutputItem[] | undefined): string {
  if (!output?.length) return '';
  const messages = output
    .filter((item) => item.type === 'message' && item.content)
    .map((item) => item.content!.trim())
    .filter(Boolean);
  return messages.at(-1) ?? '';
}

export class LmStudioProvider extends BaseProvider {
  private get serverOrigin(): string {
    return getLmStudioServerOrigin(this.config.baseUrl);
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  private buildChatBody(
    system: string,
    input: string | LmStudioInputItem[],
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      system_prompt: system,
      input,
      temperature: 0.3,
      stream,
      ...getLmStudioThinkingFields(this.config),
    };
    if (this.config.model?.trim()) {
      body.model = this.config.model.trim();
    }
    return body;
  }

  async translate(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.serverOrigin}/api/v1/chat`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
      body: JSON.stringify(this.buildChatBody(system, user, false)),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LM Studio error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as LmStudioChatResponse;
    const translated = extractTranslatedText(data.output);
    if (!translated) {
      throw new Error('LM Studio returned empty translation');
    }

    const stats = data.stats;
    const tokensUsed = stats
      ? (stats.input_tokens ?? 0) + (stats.total_output_tokens ?? 0)
      : undefined;

    return {
      translated,
      provider: this.config.name,
      cached: false,
      tokensUsed,
    };
  }

  async *translateStream(
    request: TranslateRequest,
    prompts?: PromptOverrides,
    options?: TranslateCallOptions,
  ): AsyncGenerator<string> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.serverOrigin}/api/v1/chat`, {
      method: 'POST',
      headers: this.headers,
      signal: options?.signal,
      body: JSON.stringify(this.buildChatBody(system, user, true)),
    });

    if (!res.ok) {
      // 4xx on a streaming request: the endpoint rejects the stream parameter
      // itself — a capability rejection the non-stream fallback can recover
      // from. 5xx/429 stay transient and must not poison the health memory.
      const body = await res.text();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new StreamCapabilityError(`LM Studio error ${res.status}: ${body}`);
      }
      throw new Error(`LM Studio error ${res.status}: ${body}`);
    }

    if (!res.body) throw new Error('No response body');

    yield* parseLmStudioStream(res.body);
  }

  /**
   * Vision request via LM Studio's native v1 REST API: `input` accepts an
   * array of typed items — text and image (a base64 data URL). No
   * OpenAI-compatible endpoint involved.
   */
  async translateImage(
    request: TranslateImageRequest,
    prompt: string,
  ): Promise<TranslateResult> {
    if (!request.image) throw new Error('Image data missing');

    // The instruction rides ONLY in system_prompt — duplicating it in the
    // input would double the tokens and risk the model treating it as content.
    // The input array carries just the image.
    const input: LmStudioInputItem[] = [
      { type: 'image', data_url: request.image },
    ];

    const res = await fetch(`${this.serverOrigin}/api/v1/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(this.buildChatBody(prompt, input, false)),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LM Studio error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as LmStudioChatResponse;
    const translated = extractTranslatedText(data.output);
    if (!translated) {
      throw new Error('LM Studio returned empty translation');
    }

    const stats = data.stats;
    const tokensUsed = stats
      ? (stats.input_tokens ?? 0) + (stats.total_output_tokens ?? 0)
      : undefined;

    return {
      translated,
      provider: this.config.name,
      cached: false,
      tokensUsed,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverOrigin}/api/v1/models`, { headers: this.headers });
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
    const res = await fetch(`${this.serverOrigin}/api/v1/models`, { headers: this.headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models?: { key?: string; type?: string }[] };
    return (data.models ?? [])
      .filter((m) => m.type === 'llm' && m.key)
      .map((m) => m.key!);
  }
}
