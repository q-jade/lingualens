import { BaseProvider, type PromptOverrides } from './base';
import { getLmStudioThinkingFields, getLmStudioServerOrigin } from './thinking';
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

  private buildChatBody(system: string, input: string | LmStudioInputItem[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      system_prompt: system,
      input,
      temperature: 0.3,
      stream: false,
      ...getLmStudioThinkingFields(this.config),
    };
    if (this.config.model?.trim()) {
      body.model = this.config.model.trim();
    }
    return body;
  }

  async translate(request: TranslateRequest, prompts?: PromptOverrides): Promise<TranslateResult> {
    const { system, user } = this.buildPrompt(request, prompts);

    const res = await fetch(`${this.serverOrigin}/api/v1/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(this.buildChatBody(system, user)),
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

  async *translateStream(request: TranslateRequest, prompts?: PromptOverrides): AsyncGenerator<string> {
    const result = await this.translate(request, prompts);
    yield result.translated;
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
      body: JSON.stringify(this.buildChatBody(prompt, input)),
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

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.serverOrigin}/api/v1/models`, { headers: this.headers });
      if (!res.ok) return [];
      const data = await res.json() as { models?: { key?: string; type?: string }[] };
      return (data.models ?? [])
        .filter((m) => m.type === 'llm' && m.key)
        .map((m) => m.key!);
    } catch {
      return [];
    }
  }
}
