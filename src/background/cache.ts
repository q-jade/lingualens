import type { TranslateResult } from '../shared/types';

interface CacheEntry {
  result: TranslateResult;
  accessedAt: number;
}

const STORAGE_KEY = 'translationCache';
const MAX_ENTRIES = 1000;

async function loadCache(): Promise<Map<string, CacheEntry>> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY] as Record<string, CacheEntry> | undefined;
  return raw ? new Map(Object.entries(raw)) : new Map();
}

async function persistCache(cache: Map<string, CacheEntry>): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: Object.fromEntries(cache),
  });
}

function makeKey(text: string, sourceLang: string, targetLang: string, providerId: string): string {
  let hash = 0;
  const input = `${text}|${sourceLang}|${targetLang}|${providerId}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `c_${hash.toString(36)}`;
}

function evict(cache: Map<string, CacheEntry>): void {
  if (cache.size <= MAX_ENTRIES) return;

  const entries = [...cache.entries()].sort(
    (a, b) => a[1].accessedAt - b[1].accessedAt,
  );
  const toRemove = entries.slice(0, cache.size - MAX_ENTRIES);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

export async function getCached(
  text: string,
  sourceLang: string,
  targetLang: string,
  providerId: string,
): Promise<TranslateResult | null> {
  const cache = await loadCache();
  const key = makeKey(text, sourceLang, targetLang, providerId);
  const entry = cache.get(key);
  if (!entry) return null;

  entry.accessedAt = Date.now();
  cache.set(key, entry);
  await persistCache(cache);

  return { ...entry.result, cached: true };
}

export async function setCache(
  text: string,
  sourceLang: string,
  targetLang: string,
  providerId: string,
  result: TranslateResult,
): Promise<void> {
  const cache = await loadCache();
  const key = makeKey(text, sourceLang, targetLang, providerId);

  cache.set(key, { result, accessedAt: Date.now() });
  evict(cache);
  await persistCache(cache);
}

export async function clearCache(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

export async function getCacheStats(): Promise<{ size: number; maxSize: number }> {
  const cache = await loadCache();
  return { size: cache.size, maxSize: MAX_ENTRIES };
}
