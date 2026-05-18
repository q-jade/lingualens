import type { AppSettings, ProviderConfig } from './types';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translator. Translate the following text from {sourceLang} to {targetLang}. Preserve the original formatting, tone, and style. Only output the translated text, nothing else.';

export const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
] as const;

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
    baseUrl: 'http://localhost:1234/v1',
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
  defaultTargetLang: 'zh',
  defaultSourceLang: 'auto',
  providers: [
    {
      id: 'ollama',
      type: 'ollama',
      name: 'Ollama',
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    },
    {
      id: 'lmstudio',
      type: 'lmstudio',
      name: 'LM Studio',
      enabled: true,
      baseUrl: 'http://localhost:1234/v1',
      model: '',
    },
  ],
  chunkingMode: 'quality',
};
