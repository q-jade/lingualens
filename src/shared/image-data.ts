/**
 * Image → data URL helpers, shared by the background service worker and the
 * extension pages (the side panel loads images itself).
 *
 * The browser context matters: in the background, MV3 host permissions bypass
 * page CSP/CORS and cross-origin pixels cannot be read from a page canvas
 * (taint). Page-scoped `blob:` URLs are therefore rejected here — the content
 * script resolves those by rasterizing the image it already displays.
 */

/** Longest edge sent to a vision model, in pixels. */
const MAX_IMAGE_EDGE = 1568;

/** Maximum accepted source image size, in bytes. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Encode a blob as a data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale an image blob so its longest edge is at most 1568 px. Vision
 * models resize to ~1568 px on the long edge internally anyway, so this
 * loses no translation fidelity while cutting the payload (and token
 * cost) dramatically for large screenshots. Returns the original blob
 * when it is already small enough or cannot be decoded here (e.g. SVG) —
 * the caller then sends it as-is.
 */
export async function downscaleImageBlob(blob: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return blob;
  }
  try {
    const maxEdge = Math.max(bitmap.width, bitmap.height);
    if (maxEdge <= MAX_IMAGE_EDGE) return blob;
    const scale = MAX_IMAGE_EDGE / maxEdge;
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNG preserves alpha (transparent screenshots); JPEG is far leaner
    // for everything else.
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return await canvas.convertToBlob({ type, quality: 0.9 });
  } catch {
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Download an image and return it as a data URL. `data:` URLs are returned
 * as-is; `blob:` URLs are rejected because they are page-scoped and must be
 * resolved by the page instead (see `resolveImageDataUrl` in the background
 * entry point). Large images are downscaled before encoding.
 */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  if (url.startsWith('blob:')) throw new Error('BLOB_IMAGE');
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[LinguaLens] Image fetch failed: ${res.status} ${url}`);
    throw new Error('IMAGE_FETCH_FAILED');
  }
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('NOT_AN_IMAGE');
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const scaled = await downscaleImageBlob(blob);
  return blobToDataUrl(scaled);
}
