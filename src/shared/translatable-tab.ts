/** Browser extension gallery pages (https); content scripts cannot run there. */
function isExtensionStoreUrl(hostname: string, pathname: string): boolean {
  if (hostname === 'chromewebstore.google.com') return true;
  if (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) return true;
  if (hostname === 'microsoftedge.microsoft.com' && pathname.startsWith('/addons')) return true;
  return false;
}

/** Protocols where Chromium never injects extension content scripts. */
const NON_TRANSLATABLE_PROTOCOLS = new Set([
  'about:',
  'chrome:',
  'chrome-devtools:',
  'chrome-extension:',
  'data:',
  'devtools:',
  'edge:',
  'javascript:',
  'moz-extension:',
  'view-source:',
]);

/**
 * Whether page translate may be offered for this tab URL.
 * Block known impossible cases (browser internals, extension pages, stores);
 * do not whitelist only http(s)/file — other schemes may work when the browser allows injection.
 */
export function isTranslatableTabUrl(url: string | undefined): boolean {
  if (!url) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const { protocol, hostname, pathname } = parsed;

  if (NON_TRANSLATABLE_PROTOCOLS.has(protocol)) return false;

  if (protocol === 'http:' || protocol === 'https:') {
    if (isExtensionStoreUrl(hostname, pathname)) return false;
  }

  return true;
}

export const PAGE_TRANSLATE_UNAVAILABLE =
  'Page translation is not available on this page. Open a normal web page and try again.';
