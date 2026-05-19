export interface LanguageOption {
  code: string;
  name: string;
}

/** UI language list — covers DeepL core targets and Google Translate NMT codes. */
export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'auto', name: 'Auto Detect' },

  // Widely used
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },

  // A–C
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Shqip' },
  { code: 'am', name: 'አማርኛ' },
  { code: 'hy', name: 'Հայերեն' },
  { code: 'az', name: 'Azərbaycan' },
  { code: 'eu', name: 'Euskara' },
  { code: 'be', name: 'Беларуская' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'bs', name: 'Bosanski' },
  { code: 'bg', name: 'Български' },
  { code: 'my', name: 'မြန်မာ' },
  { code: 'ca', name: 'Català' },
  { code: 'ceb', name: 'Cebuano' },
  { code: 'ny', name: 'Chichewa' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'cs', name: 'Čeština' },

  // D–G
  { code: 'da', name: 'Dansk' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'et', name: 'Eesti' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fi', name: 'Suomi' },
  { code: 'fy', name: 'Frysk' },
  { code: 'gl', name: 'Galego' },
  { code: 'ka', name: 'ქართული' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'gu', name: 'ગુજરાતી' },
  { code: 'ht', name: 'Kreyòl ayisyen' },
  { code: 'ha', name: 'Hausa' },
  { code: 'he', name: 'עברית' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'hmn', name: 'Hmong' },
  { code: 'hu', name: 'Magyar' },

  // I–L
  { code: 'is', name: 'Íslenska' },
  { code: 'ig', name: 'Igbo' },
  { code: 'id', name: 'Indonesia' },
  { code: 'ga', name: 'Gaeilge' },
  { code: 'it', name: 'Italiano' },
  { code: 'jv', name: 'Basa Jawa' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
  { code: 'kk', name: 'Қазақ' },
  { code: 'km', name: 'ខ្មែរ' },
  { code: 'rw', name: 'Kinyarwanda' },
  { code: 'ku', name: 'Kurdî' },
  { code: 'ky', name: 'Кыргызча' },
  { code: 'lo', name: 'ລາວ' },
  { code: 'la', name: 'Latina' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'lb', name: 'Lëtzebuergesch' },

  // M–P
  { code: 'mk', name: 'Македонски' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'ml', name: 'മലയാളം' },
  { code: 'mt', name: 'Malti' },
  { code: 'mi', name: 'Māori' },
  { code: 'mr', name: 'मराठी' },
  { code: 'mn', name: 'Монгол' },
  { code: 'ne', name: 'नेपाली' },
  { code: 'no', name: 'Norsk' },
  { code: 'nb', name: 'Norsk Bokmål' },
  { code: 'or', name: 'ଓଡ଼ିଆ' },
  { code: 'ps', name: 'پښتو' },
  { code: 'fa', name: 'فارسی' },
  { code: 'pl', name: 'Polski' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ' },

  // R–T
  { code: 'ro', name: 'Română' },
  { code: 'sm', name: 'Gagana Samoa' },
  { code: 'gd', name: 'Gàidhlig' },
  { code: 'sr', name: 'Српски' },
  { code: 'st', name: 'Sesotho' },
  { code: 'sn', name: 'ChiShona' },
  { code: 'sd', name: 'سنڌي' },
  { code: 'si', name: 'සිංහල' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'so', name: 'Soomaali' },
  { code: 'su', name: 'Basa Sunda' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'sv', name: 'Svenska' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'tg', name: 'Тоҷикӣ' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'tt', name: 'Татар' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'th', name: 'ไทย' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'tk', name: 'Türkmen' },

  // U–Z
  { code: 'uk', name: 'Українська' },
  { code: 'ur', name: 'اردو' },
  { code: 'ug', name: 'ئۇيغۇرچە' },
  { code: 'uz', name: 'Oʻzbek' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'cy', name: 'Cymraeg' },
  { code: 'xh', name: 'isiXhosa' },
  { code: 'yi', name: 'ייִדיש' },
  { code: 'yo', name: 'Yorùbá' },
  { code: 'zu', name: 'isiZulu' },
];

/** Google Cloud Translation v2 language codes (exceptions to ISO 639-1). */
const GOOGLE_LANG_MAP: Record<string, string> = {
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  fil: 'fil',
  he: 'iw',
  jv: 'jv',
  nb: 'nb',
};

/** DeepL API language codes (exceptions to uppercase ISO 639-1). */
const DEEPL_LANG_MAP: Record<string, string> = {
  zh: 'ZH',
  'zh-TW': 'ZH-HANT',
  el: 'EL',
  nb: 'NB',
  no: 'NB',
  'pt-BR': 'PT-BR',
  'pt-PT': 'PT-PT',
  en: 'EN',
};

export function toGoogleLang(code: string): string {
  return GOOGLE_LANG_MAP[code] ?? code;
}

export function toDeepLLang(code: string): string {
  const mapped = DEEPL_LANG_MAP[code];
  if (mapped) return mapped;
  if (code.includes('-')) return code.toUpperCase();
  return code.toUpperCase();
}

export function getLanguageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
