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

/**
 * Translate the text inside an image (selection covering an image, or the
 * image context menu). Page translation never carries images; the popup and
 * side panel have no image entry point yet, but the request shape is already
 * prepared for them (`cacheKey` for URL-less images plus the streaming port),
 * so adding one needs no protocol change.
 */
export interface TranslateImageRequest {
  /** Image URL (http/https/data/blob) — panel preview and default cache key. */
  imageUrl: string;
  /**
   * Image as a data URL. Filled in by the background (fetch, or content-script
   * canvas extraction as fallback) before the provider call — providers must
   * not read `imageUrl` directly (blob: URLs are page-scoped).
   */
  image?: string;
  /**
   * Cache identity for images that have no stable URL — entry points reading a
   * local file (file picker, paste, drag & drop) pass the data URL here, since
   * the pixels are the only identity they have. The cache layer hashes this
   * value, so a multi-megabyte data URL is never persisted verbatim. Falls back
   * to `imageUrl` when omitted (the page-image case).
   */
  cacheKey?: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslateResult {
  translated: string;
  provider: string;
  cached: boolean;
  tokensUsed?: number;
}

/** Snapshot of the background translation cache, shown on the options page. */
export interface CacheStats {
  /** Number of cached entries currently held in memory. */
  size: number;
  /** Entry limit after which the oldest entries are evicted. */
  maxSize: number;
  /**
   * Bytes used by the persisted cache in `storage.local`. Approximate: the
   * debounced write is flushed before measuring, but browser bookkeeping may
   * differ slightly between engines.
   */
  bytes: number;
}

/**
 * Port names of the two long-lived streaming channels. Text and image
 * translation use separate ports because their orchestration differs (provider
 * chain filter, prompt, cache namespace) — and because it keeps the existing
 * text protocol untouched.
 */
export const STREAM_PORT_NAME = 'translate-stream';
export const IMAGE_STREAM_PORT_NAME = 'translate-image-stream';

/**
 * Messages exchanged on a streaming runtime Port (long-lived connection): the
 * UI sends `start` once, the background answers with any number of `chunk`
 * messages followed by exactly one `done` or `error`. Ports are needed because
 * `runtime.sendMessage` can only return a single response and cannot carry a
 * stream.
 *
 * Generic over the request type so text and image streaming share one protocol
 * definition instead of duplicating the chunk/done/error shape.
 */
export type StreamPortMessages<P> =
  | { type: 'start'; payload: P }
  | { type: 'chunk'; delta: string }
  | { type: 'done'; result: TranslateResult }
  | { type: 'error'; error: string };

export type StreamPortMessage = StreamPortMessages<TranslateRequest>;
export type ImageStreamPortMessage = StreamPortMessages<TranslateImageRequest>;

export interface ProviderConfig {
  id: string;
  /**
   * The wire protocol, not the vendor. A provider's brand (logo, per-vendor
   * request quirks) is derived from `baseUrl` — see `shared/provider-brand.ts`,
   * which is why OpenAI needs no type of its own.
   */
  type: 'openai-compat' | 'ollama' | 'lmstudio' | 'deepl' | 'google' | 'custom';
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /** LLM providers only. Default true — skip chain-of-thought for faster translation. */
  disableThinking?: boolean;
  /** LLM providers only. Default true — the provider accepts images (vision model). */
  supportsImage?: boolean;
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
  | { type: 'TRANSLATE_IMAGE'; payload: TranslateImageRequest }
  | { type: 'VERIFY_CONFIG'; payload: { providerConfig: ProviderConfig } }
  | { type: 'LIST_MODELS'; payload: { providerConfig: ProviderConfig } }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: SettingsPatch }
  | { type: 'CLEAR_CACHE' }
  | { type: 'GET_CACHE_STATS' };

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** A selection routed to the side panel from a page without a content script. */
export interface RoutedSidepanelSelection {
  text: string;
  sourceLang: string;
  targetLang: string;
}
