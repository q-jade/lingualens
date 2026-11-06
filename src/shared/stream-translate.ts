import {
  IMAGE_STREAM_PORT_NAME,
  STREAM_PORT_NAME,
  type ImageStreamPortMessage,
  type StreamPortMessage,
  type StreamPortMessages,
  type TranslateImageRequest,
  type TranslateRequest,
} from './types';

export interface StreamTranslateHandlers {
  /** Raw delta — the UI appends it to its accumulated text. */
  onChunk: (delta: string) => void;
  /**
   * Terminal success. `result.translated` is the trim()'d full text and MUST
   * be used to overwrite the accumulated chunks: the deltas are raw model
   * output while the one-shot path (and the cache) store trimmed text, so
   * this keeps streaming and non-streaming renders identical.
   */
  onDone: (result: { translated: string; provider: string; cached: boolean }) => void;
  /** Terminal failure (translated error key or raw provider message). */
  onError: (error: string) => void;
}

/**
 * Open a streaming port, send the request, and wire the protocol to simple
 * callbacks. The port state machine lives here exactly once, so every entry
 * point (selection panel, popup, side panel — and future image entry points)
 * behaves identically.
 *
 * Returns a cancel function: it disconnects the port (which the background
 * turns into an AbortController abort) and makes subsequent protocol
 * messages no-ops. Safe to call multiple times. Calling it does NOT fire
 * onError/onDone — the caller owns the UI state after cancelling.
 */
function startStreamOverPort<P extends TranslateRequest | TranslateImageRequest>(
  portName: string,
  payload: P,
  handlers: StreamTranslateHandlers,
): () => void {
  // `browser.runtime.connect` with an options object is Chrome MV3; Firefox
  // accepts the same signature through the polyfill, but the string overload
  // is the universally supported form.
  let port: ReturnType<typeof browser.runtime.connect>;
  try {
    port = browser.runtime.connect({ name: portName });
  } catch {
    // Throws when the extension context is invalidated — the extension was
    // reloaded or updated while this page stayed open. Report it as a terminal
    // error so the caller resets its loading state (there is no port whose
    // `onDisconnect` could do it), and hand back a no-op cancel.
    handlers.onError('TRANSLATION_FAILED');
    return () => { };
  }

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    try {
      port.disconnect();
    } catch {
      /* already disconnected */
    }
  };

  port.onMessage.addListener((raw: unknown) => {
    if (closed) return;
    const msg = raw as StreamPortMessage | ImageStreamPortMessage;
    switch (msg?.type) {
      case 'chunk':
        if (msg.delta) handlers.onChunk(msg.delta);
        break;
      case 'done':
        closed = true; // handlers must not run after the terminal message
        try {
          port.disconnect();
        } catch {
          /* already disconnected */
        }
        handlers.onDone(msg.result);
        break;
      case 'error':
        closed = true;
        try {
          port.disconnect();
        } catch {
          /* already disconnected */
        }
        handlers.onError(msg.error);
        break;
    }
  });

  // A disconnect without a terminal message means the background died (SW
  // recycle, crash): surface it as an error so the UI never hangs on loading.
  port.onDisconnect.addListener(() => {
    if (closed) return;
    closed = true;
    handlers.onError('TRANSLATION_FAILED');
  });

  port.postMessage({ type: 'start', payload } satisfies StreamPortMessages<P>);

  return finish;
}

/** Streaming text translation over the `translate-stream` port. */
export function startStreamTranslate(
  payload: TranslateRequest,
  handlers: StreamTranslateHandlers,
): () => void {
  return startStreamOverPort(STREAM_PORT_NAME, payload, handlers);
}

/**
 * Streaming image translation over the `translate-image-stream` port. The
 * background resolves the vision-capable provider chain, serves cache hits as
 * a single chunk, and falls back to the one-shot vision request when the
 * endpoint rejects streaming — so callers need no capability check of their
 * own and must not also send `TRANSLATE_IMAGE`.
 */
export function startImageStreamTranslate(
  payload: TranslateImageRequest,
  handlers: StreamTranslateHandlers,
): () => void {
  return startStreamOverPort(IMAGE_STREAM_PORT_NAME, payload, handlers);
}
