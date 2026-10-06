/**
 * Streaming-health memory for LLM providers (module-level singleton; lives as
 * long as the MV3 service worker does — SW recycle clears it, which doubles
 * as a self-healing mechanism, so no persistence is needed).
 *
 * Design (see the streaming rollout notes):
 * - Only CAPABILITY failures ("this endpoint does not support streaming",
 *   `StreamCapabilityError`) are recorded. Transient failures (network
 *   errors, 5xx, 429, mid-stream disconnects) must never be recorded — one
 *   network hiccup must not disable streaming.
 * - A single capability failure only puts the provider under suspicion: the
 *   next request still tries streaming first. Only `FAILURE_THRESHOLD`
 *   consecutive capability failures flip the provider to the downgraded
 *   state, where requests skip streaming until the probe cooldown elapses.
 * - Any streaming success fully resets the provider's state.
 */

const FAILURE_THRESHOLD = 2;
const PROBE_COOLDOWN_MS = 5 * 60_000;

interface HealthState {
  consecutiveFailures: number;
  lastFailureAt: number;
}

export class StreamHealth {
  private states = new Map<string, HealthState>();

  /**
   * Whether the next request may attempt streaming. Downgraded providers are
   * kept there only for the cooldown window; once it elapses exactly one
   * probe request is let through (half-open) — if it succeeds the provider
   * fully recovers, if it fails the downgrade renews for another window.
   */
  shouldTryStream(providerId: string): boolean {
    const state = this.states.get(providerId);
    if (!state || state.consecutiveFailures < FAILURE_THRESHOLD) return true;
    return Date.now() - state.lastFailureAt >= PROBE_COOLDOWN_MS;
  }

  recordSuccess(providerId: string): void {
    this.states.delete(providerId);
  }

  /** Capability failure only — see the module doc. */
  recordCapabilityFailure(providerId: string): void {
    const state = this.states.get(providerId) ?? { consecutiveFailures: 0, lastFailureAt: 0 };
    state.consecutiveFailures++;
    state.lastFailureAt = Date.now();
    this.states.set(providerId, state);
  }

  /** Diagnostic hook (options page / tests) — not used by the hot path. */
  getStats(providerId: string): { consecutiveFailures: number; downgraded: boolean } {
    const state = this.states.get(providerId);
    return {
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      downgraded: (state?.consecutiveFailures ?? 0) >= FAILURE_THRESHOLD
        && Date.now() - (state?.lastFailureAt ?? 0) < PROBE_COOLDOWN_MS,
    };
  }
}

/** Module-level singleton — one health memory per service worker lifetime. */
export const streamHealth = new StreamHealth();
