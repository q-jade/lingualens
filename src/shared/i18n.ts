import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

const STORAGE_KEY = 'lingualens_ui_language';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const;

export const AVAILABLE_UI_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文 (简体)' },
] as const;

function detectLanguage(): string {
  try {
    if (typeof browser !== 'undefined' && browser.i18n?.getUILanguage) {
      const locale = browser.i18n.getUILanguage();
      if (locale.startsWith('zh')) return 'zh-CN';
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
