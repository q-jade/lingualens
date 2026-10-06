/**
 * Marker error distinguishing "this server does not support streaming" from
 * transient failures (network errors, 5xx, 429, mid-stream disconnects).
 *
 * Only capability rejections count toward the streaming-health circuit
 * breaker in the background (`stream-health.ts`); transient failures must
 * never poison the memory — a single network hiccup would otherwise disable
 * streaming for the provider.
 *
 * Detection points:
 * - The server answers a `stream:true` request with a non-2xx status that a
 *   non-streaming retry can plausibly succeed on (4xx validation of the
 *   stream parameter), while 5xx/429 stay transient.
 * - The server ignored `stream:true` and answered 200 with a plain JSON
 *   body (no SSE `data:` lines at all) — the SSE parser finds nothing.
 */
export class StreamCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamCapabilityError';
  }
}

/**
 * True when the error means "streaming not supported by this endpoint".
 * Thrown and checked in the same background context, so instanceof is
 * reliable — no string tagging needed.
 */
export function isStreamCapabilityRejection(err: unknown): boolean {
  return err instanceof StreamCapabilityError;
}
