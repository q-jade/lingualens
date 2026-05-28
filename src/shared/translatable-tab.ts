/** Browser extension gallery pages (https); content scripts cannot run there. */
function isExtensionStoreUrl(hostname: string, pathname: string): boolean {
  if (hostname === 'chromewebstore.google.com') return true;
  if (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) return true;
  if (hostname === 'microsoftedge.microsoft.com' && pathname.startsWith('/addons')) return true;
  return false;
}

/** Content scripts cannot run on these URLs (chrome://, extension pages, Web Store, etc.). */
export function isTranslatableTabUrl(url: string | undefined): boolean {
  if (!url) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const { protocol, hostname, pathname } = parsed;

  if (protocol === 'http:' || protocol === 'https:') {
    if (isExtensionStoreUrl(hostname, pathname)) return false;
    return true;
  }

  return false;
}

export const PAGE_TRANSLATE_UNAVAILABLE =
  'Page translation is not available on this page. Open a normal http(s) page and try again.';
