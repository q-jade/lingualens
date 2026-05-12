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
  type: 'openai-compat' | 'ollama' | 'openai' | 'deepl' | 'google' | 'custom';
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export interface AppSettings {
  defaultProvider: string;
  defaultTargetLang: string;
  defaultSourceLang: string;
  providers: ProviderConfig[];
  promptTemplate?: string;
}

export type MessageType =
  | { type: 'TRANSLATE'; payload: TranslateRequest }
  | { type: 'TEST_CONNECTION'; payload: { providerId: string } }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<AppSettings> };

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
