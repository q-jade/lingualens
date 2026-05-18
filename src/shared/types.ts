export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  context?: string;
}

export interface TranslateResult {
  translated: string;
  provider: string;
  cached: boolean;
  tokensUsed?: number;
}

export interface ProviderConfig {
  id: string;
  type: 'openai-compat' | 'ollama' | 'openai' | 'lmstudio' | 'deepl' | 'google' | 'custom';
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  /** LLM providers only. Default true — skip chain-of-thought for faster translation. */
  disableThinking?: boolean;
}

export type ChunkingMode = 'quality' | 'speed';

export interface AppSettings {
  defaultProvider: string;
  /** Ordered provider IDs to try when the default provider fails. May be empty. */
  fallbackProviders: string[];
  defaultTargetLang: string;
  defaultSourceLang: string;
  providers: ProviderConfig[];
  promptTemplate?: string;
  chunkingMode: ChunkingMode;
}

export type MessageType =
  | { type: 'TRANSLATE'; payload: TranslateRequest }
  | { type: 'VERIFY_CONFIG'; payload: { providerConfig: ProviderConfig } }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<AppSettings> };

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
