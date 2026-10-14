/**
 * The service a base URL actually points at, resolved from the URL alone.
 *
 * This is deliberately separate from `ProviderConfig['type']`, which only
 * describes the **wire protocol** (OpenAI-compatible `/chat/completions`,
 * Ollama's native API, …). Two orthogonal questions live here:
 *
 * - "How do I talk to it?" → `type`. Chosen by the user, safe to store.
 * - "Who is it?" → `baseUrl`. The URL is the only authority on where the
 *   request goes, so the brand is *derived*, never stored. Renaming a provider
 *   or pointing it at a different host therefore cannot leave a stale brand
 *   behind — which is why `type: 'openai'` was removed from the union.
 *
 * Consumers: `ProviderIcon` picks the brand glyph from it, and
 * `providers/thinking.ts` picks the vendor's reasoning-control fields from it.
 * Both must agree, so there is exactly one implementation.
 */
export type ProviderBrand =
  | 'openai'
  | 'deepseek'
  | 'zhipu'
  | 'openrouter'
  | 'gemini'
  | 'qwen'
  | 'minimax'
  | 'nvidia';

interface ParsedUrl {
  host: string;
  path: string;
}

/**
 * Tolerant URL split. Falls back to assuming `https://` so a bare host or a
 * host-with-path typed into the options page (`api.deepseek.com/v1`) still
 * resolves; only a blank string is unresolvable.
 */
function parseUrl(baseUrl: string): ParsedUrl | null {
  const raw = (baseUrl ?? '').trim();
  if (!raw) return null;
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const url = new URL(candidate);
      return { host: url.hostname.toLowerCase(), path: url.pathname.toLowerCase() };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** True when `host` is `domain` itself or a subdomain of it (never a lookalike). */
function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Resolve the brand, or `null` when the URL is unknown (custom/self-hosted
 * endpoints) — callers then fall back to their protocol-level default.
 */
export function getProviderBrand(baseUrl: string): ProviderBrand | null {
  const parsed = parseUrl(baseUrl);
  if (!parsed) return null;
  const { host, path } = parsed;

  // Two anchoring styles, picked per vendor:
  //
  // - **Registrable domain** — the vendor owns the whole domain, so anchoring
  //   on it makes both the apex and any subdomain resolve (`deepseek.com`
  //   covers `deepseek.com` *and* `api.deepseek.com`).
  // - **Exact API host**, sometimes plus a path — the parent domain is shared
  //   with unrelated services and would collide. `googleapis.com` also serves
  //   Google Translate and Vertex, and `aliyuncs.com` also serves OSS, so
  //   Gemini pins `generativelanguage.googleapis.com` and Qwen additionally
  //   requires the `/compatible-mode` path. OpenAI and NVIDIA pin their API
  //   host for the same reason: `openai.com` / `nvidia.com` are marketing
  //   sites, not endpoints.
  if (isHost(host, 'api.openai.com')) return 'openai';
  if (isHost(host, 'deepseek.com')) return 'deepseek';
  if (isHost(host, 'bigmodel.cn') || isHost(host, 'z.ai')) return 'zhipu';
  if (isHost(host, 'openrouter.ai')) return 'openrouter';
  if (isHost(host, 'generativelanguage.googleapis.com')) return 'gemini';
  if (isHost(host, 'integrate.api.nvidia.com')) return 'nvidia';
  // The `minimaxi.*` hosts are MiniMax's legacy API domains; accept them so an
  // older base URL still gets the brand.
  if (
    isHost(host, 'minimax.cn')
    || isHost(host, 'minimax.io')
    || isHost(host, 'minimaxi.com')
    || isHost(host, 'minimaxi.chat')
  ) return 'minimax';

  // Alibaba Cloud Bailian (Qwen) is matched by host **and** path rather than a
  // single brand hostname, because the platform is migrating to
  // workspace-scoped `{WorkspaceId}.{region}.maas.aliyuncs.com` URLs.
  if (isHost(host, 'aliyuncs.com') && path.includes('/compatible-mode')) return 'qwen';

  return null;
}
