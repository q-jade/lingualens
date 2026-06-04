import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import ru from '../locales/ru.json';

const STORAGE_KEY = 'lingualens_ui_language';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
  fr: { translation: fr },
  de: { translation: de },
  es: { translation: es },
  ru: { translation: ru },
} as const;

export const AVAILABLE_UI_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
] as const;

function detectLanguage(): string {
  try {
    if (typeof browser !== 'undefined' && browser.i18n?.getUILanguage) {
      const locale = browser.i18n.getUILanguage();
      if (locale.startsWith('zh-TW') || locale.startsWith('zh-HK') || locale === 'zh-Hant') return 'zh-TW';
      if (locale.startsWith('zh')) return 'zh-CN';
      if (locale.startsWith('ja')) return 'ja';
      if (locale.startsWith('ko')) return 'ko';
      if (locale.startsWith('fr')) return 'fr';
      if (locale.startsWith('de')) return 'de';
      if (locale.startsWith('es')) return 'es';
      if (locale.startsWith('ru')) return 'ru';
      return 'en';
    }
  } catch { /* ignore */ }
  return 'en';
}

let initPromise: Promise<void> | null = null;

export function initI18n(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let savedLang: string | undefined;
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      savedLang = result[STORAGE_KEY] as string | undefined;
    } catch { /* ignore */ }

    const lng = savedLang || detectLanguage();

    await i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
  })();

  return initPromise;
}

export async function setUILanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang);
  await browser.storage.local.set({ [STORAGE_KEY]: lang });
}

export function getUILanguage(): string {
  return i18n.language || 'en';
}

export default i18n;
