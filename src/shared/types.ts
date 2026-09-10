export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  /**
   * True when the request comes from a source that supports the supplementary
   * prompt (selection, popup, side panel). Page translation omits it, so the
   * additional prompt never applies there.
   */
  applyAdditionalPrompt?: boolean;
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
  /** LLM providers only. Default true — skip chain-of-thought for faster translation. */
  disableThinking?: boolean;
}

export type ChunkingMode = 'quality' | 'speed';

export type SelectionTriggerMode = 'icon' | 'instant' | 'modifier' | 'off';
export type SelectionModifierKey = 'ctrl' | 'alt' | 'shift';

export interface AppSettings {
  defaultProvider: string;
  /** Ordered provider IDs to try when the default provider fails. May be empty. */
  fallbackProviders: string[];
  defaultTargetLang: string;
  defaultSourceLang: string;
  providers: ProviderConfig[];
  promptTemplate?: string;
  /**
   * Supplementary prompt appended for selection/popup/side-panel translations
   * (never page translation). Empty string disables it; unset falls back to
   * the default template.
   */
  additionalPrompt?: string;
  chunkingMode: ChunkingMode;
  selectionTriggerMode: SelectionTriggerMode;
  selectionModifierKey: SelectionModifierKey;
}

/**
 * Payload for SAVE_SETTINGS. The two prompt fields additionally accept an
 * explicit `null`: it clears the stored override so the built-in default
 * applies again. `undefined` cannot carry that intent — message serialization
 * (Chrome/Edge) drops undefined-valued keys before the background sees them,
 * so a missing key must mean "leave unchanged" for partial updates.
 */
export type SettingsPatch = Omit<Partial<AppSettings>, 'promptTemplate' | 'additionalPrompt'> & {
  promptTemplate?: string | null;
  additionalPrompt?: string | null;
};

export type MessageType =
  | { type: 'TRANSLATE'; payload: TranslateRequest }
  | { type: 'VERIFY_CONFIG'; payload: { providerConfig: ProviderConfig } }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: SettingsPatch };

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** A selection routed to the side panel from a page without a content script. */
export interface RoutedSidepanelSelection {
  text: string;
  sourceLang: string;
  targetLang: string;
}
