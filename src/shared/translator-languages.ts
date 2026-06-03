export interface TranslatorLanguages {
  sourceLang: string;
  targetLang: string;
}

const STORAGE_KEY = 'translatorLanguages';

export async function getTranslatorLanguages(
  fallback: TranslatorLanguages = { sourceLang: 'auto', targetLang: 'zh' },
): Promise<TranslatorLanguages> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<TranslatorLanguages> | undefined;
  if (stored && typeof stored.sourceLang === 'string' && typeof stored.targetLang === 'string') {
    return { sourceLang: stored.sourceLang, targetLang: stored.targetLang };
  }
  return fallback;
}

export async function setTranslatorLanguages(langs: TranslatorLanguages): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: langs });
}

export async function updateTranslatorLanguages(
  updates: Partial<TranslatorLanguages>,
  fallback?: TranslatorLanguages,
): Promise<TranslatorLanguages> {
  const current = await getTranslatorLanguages(fallback);
  const next = { ...current, ...updates };
  await setTranslatorLanguages(next);
  return next;
}
