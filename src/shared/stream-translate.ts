import type { TranslateRequest, StreamPortMessage } from './types';

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
 * Open a `translate-stream` port, send the request, and wire the streaming
 * protocol to simple callbacks. Shared by the popup, side panel, and
 * selection panel so the port state machine lives in exactly one place.
 *
 * Returns a cancel function: it disconnects the port (which the background
 * turns into an AbortController abort) and makes subsequent protocol
 * messages no-ops. Safe to call multiple times. Calling it does NOT fire
 * onError/onDone — the caller owns the UI state after cancelling.
 */
export function startStreamTranslate(
  payload: TranslateRequest,
  handlers: StreamTranslateHandlers,
): () => void {
  // `browser.runtime.connect` with an options object is Chrome MV3; Firefox
  // accepts the same signature through the polyfill, but the string overload
  // is the universally supported form.
  const port = browser.runtime.connect({ name: 'translate-stream' });

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
    const msg = raw as StreamPortMessage;
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

  port.postMessage({ type: 'start', payload } satisfies StreamPortMessage);

  return finish;
}
