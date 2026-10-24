import { MAX_RETRY_AFTER_MS } from '@simulador/shared';

/** How the GET that just ended went, as far as the wait before the next one is concerned. */
export type PollOutcome =
  /** An answer and the simulation is still PROCESSING. */
  | { kind: 'ok' }
  /**
   * No answer, a 429, a 5xx or an answer outside the shared schema; the status does not matter
   * here. retryAfterMs: the response's Retry-After, undefined when it had none in seconds or
   * there was no response.
   */
  | { kind: 'failed'; consecutiveFailures: number; retryAfterMs: number | undefined };

const NORMAL_DELAY_MS = 1_000;
const MAX_BACKOFF_MS = 8_000;

/**
 * Milliseconds to wait before the next GET /simulations/:id, counted from the end of the one
 * that just ended (chained setTimeout, see useSimulationPolling).
 *
 * - After `ok`: 1 s.
 * - After a failure with Retry-After (a 429, or a 503 from the API shutting down): the
 *   Retry-After kept between 1 s and MAX_RETRY_AFTER_MS (60 s, from shared), whatever the
 *   backoff below would be.
 *   - Never less than 1 s: the server asked to wait, so it never polls faster than the normal
 *     pace.
 *   - Never more than MAX_RETRY_AFTER_MS: the simulation ends in about 22 s, so a page standing
 *     still for longer does not help the customer. The API refuses at boot a rate-limit window
 *     longer than it, so only a Retry-After our server did not send is cut, whatever the
 *     configuration. And it keeps setTimeout below its limit of 2³¹ − 1 ms, beyond which
 *     (Infinity included) the timer fires at once and the polling would loop.
 * - After a failure without Retry-After, by `consecutiveFailures` (the one just ended included):
 *   1 s after the 1st, 2 s after the 2nd, 4 s after the 3rd, 8 s from the 4th on.
 */
export function nextPollDelay(outcome: PollOutcome): number {
  if (outcome.kind === 'ok') return NORMAL_DELAY_MS;

  if (outcome.retryAfterMs !== undefined) {
    return Math.min(Math.max(NORMAL_DELAY_MS, outcome.retryAfterMs), MAX_RETRY_AFTER_MS);
  }

  return Math.min(NORMAL_DELAY_MS * 2 ** (outcome.consecutiveFailures - 1), MAX_BACKOFF_MS);
}
