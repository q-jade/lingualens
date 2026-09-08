import type { TranslateResult } from '../shared/types';

interface CacheEntry {
  result: TranslateResult;
  accessedAt: number;
}

const STORAGE_KEY = 'translationCache';
const MAX_ENTRIES = 1000;
const PERSIST_DEBOUNCE_MS = 3000;

let memoryCache: Map<string, CacheEntry> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function getMemoryCache(): Promise<Map<string, CacheEntry>> {
  if (memoryCache) return memoryCache;
  const data = await browser.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY] as Record<string, CacheEntry> | undefined;
  memoryCache = raw ? new Map(Object.entries(raw)) : new Map();
  return memoryCache;
}

function isQuotaError(err: unknown): boolean {
  return err instanceof Error && /quota/i.test(err.message);
}

async function flushCache(): Promise<void> {
  if (!dirty || !memoryCache) return;
  dirty = false;
  try {
    await browser.storage.local.set({
      [STORAGE_KEY]: Object.fromEntries(memoryCache),
    });
  } catch (err) {
    if (!memoryCache || !isQuotaError(err)) return;
    // Quota exceeded — aggressively evict oldest 50% and retry once
    const entries = [...memoryCache.entries()].sort(
      (a, b) => a[1].accessedAt - b[1].accessedAt,
    );
    const keep = Math.max(1, Math.floor(entries.length / 2));
    const toRemove = entries.slice(0, entries.length - keep);
    for (const [key] of toRemove) {
      memoryCache.delete(key);
    }
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: Object.fromEntries(memoryCache),
      });
    } catch {
      // Give up — in-memory cache still works this session
    }
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  dirty = true;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushCache();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * FNV-1a dual hash: two independent 32-bit hashes combined into a 64-bit key.
 * Collision probability ~2.7 × 10⁻¹⁴ for 1000 entries — effectively zero.
 * Same O(n) cost as a single hashCode, no async overhead.
 */
function makeKey(
  text: string,
  sourceLang: string,
  targetLang: string,
  providerId: string,
  promptTag: string,
): string {
  // promptTag covers every user-editable prompt input (base + additional), so
  // editing any prompt invalidates old entries instead of serving them stale.
  const input = `${text}|${sourceLang}|${targetLang}|${providerId}|${promptTag}`;
  let h1 = 0x811c9dc5;
  let h2 = 0xc58f1a7b;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul((h1 ^ c), 0x01000193);
    h2 = Math.imul((h2 ^ ((c >>> 8) | ((c & 0xff) << 24))), 0x01000193);
  }
  return `c_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
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
  promptTag: string,
): Promise<TranslateResult | null> {
  const cache = await getMemoryCache();
  const key = makeKey(text, sourceLang, targetLang, providerId, promptTag);
  const entry = cache.get(key);
  if (!entry) return null;

  entry.accessedAt = Date.now();
  schedulePersist();

  return { ...entry.result, cached: true };
}

export async function setCache(
  text: string,
  sourceLang: string,
  targetLang: string,
  providerId: string,
  result: TranslateResult,
  promptTag: string,
): Promise<void> {
  const cache = await getMemoryCache();
  const key = makeKey(text, sourceLang, targetLang, providerId, promptTag);

  cache.set(key, { result, accessedAt: Date.now() });
  evict(cache);
  schedulePersist();
}

export async function clearCache(): Promise<void> {
  memoryCache = new Map();
  dirty = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await browser.storage.local.remove(STORAGE_KEY);
}

export async function getCacheStats(): Promise<{ size: number; maxSize: number }> {
  const cache = await getMemoryCache();
  return { size: cache.size, maxSize: MAX_ENTRIES };
}
