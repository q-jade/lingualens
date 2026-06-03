import { SUPPORTED_LANGUAGES } from './languages';

const SUPPORTED_TARGET_CODES = new Set(
  SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => l.code),
);

/** BCP-47 tags (normalized) → LinguaLens language codes. */
const LOCALE_OVERRIDES: Record<string, string> = {
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  'zh-hant': 'zh-TW',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-PT',
};

const FALLBACK_TARGET = 'en';

function normalizeLocaleTag(tag: string): string {
  return tag.trim().replace(/_/g, '-').toLowerCase();
}

/** Map a BCP-47 locale tag to a supported target language code. */
export function localeTagToTargetLang(tag: string): string | null {
  const normalized = normalizeLocaleTag(tag);
  if (!normalized) return null;

  const override = LOCALE_OVERRIDES[normalized];
  if (override && SUPPORTED_TARGET_CODES.has(override)) return override;

  const parts = normalized.split('-');
  const lang = parts[0];
  if (!lang) return null;

  if (lang === 'zh') {
    const region = parts[1];
    if (region === 'tw' || region === 'hk' || region === 'mo' || parts.includes('hant')) {
      return SUPPORTED_TARGET_CODES.has('zh-TW') ? 'zh-TW' : 'zh';
    }
    return SUPPORTED_TARGET_CODES.has('zh') ? 'zh' : null;
  }

  if (lang === 'pt') {
    const region = parts[1];
    if (region === 'br' && SUPPORTED_TARGET_CODES.has('pt-BR')) return 'pt-BR';
    if (region === 'pt' && SUPPORTED_TARGET_CODES.has('pt-PT')) return 'pt-PT';
    if (SUPPORTED_TARGET_CODES.has('pt')) return 'pt';
    if (SUPPORTED_TARGET_CODES.has('pt-BR')) return 'pt-BR';
    return null;
  }

  if (SUPPORTED_TARGET_CODES.has(lang)) return lang;

  return null;
}

function readExtensionUiLocale(): string | undefined {
  try {
    if (typeof browser !== 'undefined' && browser.i18n?.getUILanguage) {
      return browser.i18n.getUILanguage();
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Default translation target from the user's preferred content languages. */
export function resolveDefaultTargetLang(): string {
  if (typeof navigator !== 'undefined' && navigator.languages?.length) {
    for (const tag of navigator.languages) {
      const matched = localeTagToTargetLang(tag);
      if (matched) return matched;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    const matched = localeTagToTargetLang(navigator.language);
    if (matched) return matched;
  }

  const ui = readExtensionUiLocale();
  if (ui) {
    const matched = localeTagToTargetLang(ui);
    if (matched) return matched;
  }

  return FALLBACK_TARGET;
}

export const DEFAULT_TRANSLATOR_LANGUAGES = {
  sourceLang: 'auto',
  targetLang: resolveDefaultTargetLang(),
} as const;
