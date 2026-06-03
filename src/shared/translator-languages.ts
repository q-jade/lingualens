import { DEFAULT_TRANSLATOR_LANGUAGES } from './default-target-lang';

export interface TranslatorLanguages {
  sourceLang: string;
  targetLang: string;
}

const STORAGE_KEY = 'translatorLanguages';

function parseTranslatorLanguages(value: unknown): TranslatorLanguages | null {
  const stored = value as Partial<TranslatorLanguages> | undefined;
  if (stored && typeof stored.sourceLang === 'string' && typeof stored.targetLang === 'string') {
    return { sourceLang: stored.sourceLang, targetLang: stored.targetLang };
  }
  return null;
}

export async function getTranslatorLanguages(
  fallback: TranslatorLanguages = { ...DEFAULT_TRANSLATOR_LANGUAGES },
): Promise<TranslatorLanguages> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return parseTranslatorLanguages(result[STORAGE_KEY]) ?? fallback;
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

/** Sync open side panel when popup (or another context) updates translator languages. */
export function subscribeTranslatorLanguages(
  onChange: (langs: TranslatorLanguages) => void,
): () => void {
  const listener = (
    changes: Record<string, Browser.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change?.newValue) return;
    const langs = parseTranslatorLanguages(change.newValue);
    if (langs) onChange(langs);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
