import type { AppSettings, ProviderConfig } from './types';
import { resolveDefaultTargetLang } from './default-target-lang';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translator. Translate the following text from {sourceLang} to {targetLang}. '
  + 'Preserve the original formatting, tone, and style. If the text contains multiple lines, translate '
  + 'each line separately and keep the same number of lines. Only output the translated text, nothing else.';

/**
 * Supplementary prompt appended for selection/popup/side-panel translations.
 * The model decides when it actually applies (e.g. only for single words), so
 * the trigger condition must be phrased explicitly in the template.
 */
export const DEFAULT_ADDITIONAL_PROMPT =
  'If the original text is a single word, output the original text and its pronunciation, along with a detailed translation, just like a real dictionary from {sourceLang} to {targetLang}. Otherwise, output only the translated text.';

export { SUPPORTED_LANGUAGES } from './languages';

export const PROVIDER_PRESETS: Record<string, Omit<ProviderConfig, 'id' | 'enabled'>> = {
  'openai-compat': {
    type: 'openai-compat',
    name: 'OpenAI Compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  ollama: {
    type: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3',
  },
  lmstudio: {
    type: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    model: '',
  },
  openai: {
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    type: 'openai-compat',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  deepl: {
    type: 'deepl',
    name: 'DeepL',
    baseUrl: 'https://api-free.deepl.com',
  },
  google: {
    type: 'google',
    name: 'Google Translate',
    baseUrl: 'https://translation.googleapis.com',
  },
  custom: {
    type: 'custom',
    name: 'Custom API',
    baseUrl: 'https://api.example.com/translate',
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: 'ollama',
  fallbackProviders: [],
  defaultTargetLang: resolveDefaultTargetLang(),
  defaultSourceLang: 'auto',
  additionalPrompt: DEFAULT_ADDITIONAL_PROMPT,
  providers: [
    {
      id: 'ollama',
      type: 'ollama',
      name: 'Ollama',
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      disableThinking: true,
    },
    {
      id: 'lmstudio',
      type: 'lmstudio',
      name: 'LM Studio',
      enabled: true,
      baseUrl: 'http://localhost:1234',
      model: '',
      disableThinking: true,
    },
  ],
  chunkingMode: 'quality',
  selectionTriggerMode: 'icon',
  selectionModifierKey: 'ctrl',
};
