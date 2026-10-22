/** Transient statuses: the bank (or a proxy in front of it) may answer differently soon. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export type AttemptFailureReason = 'TIMEOUT' | 'NETWORK' | 'ABORTED';

/**
 * Transient transport failures. An allowlist, like RETRYABLE_STATUSES: a failure reason added
 * later is NOT retried until someone decides it should be.
 */
export const RETRYABLE_FAILURES: ReadonlySet<AttemptFailureReason> = new Set([
  'TIMEOUT',
  'NETWORK',
]);

/** What a single attempt produced, as far as the retry decision is concerned. */
export type AttemptOutcome =
  { kind: 'response'; status: number } | { kind: 'failure'; reason: AttemptFailureReason };

export interface RetryPolicy {
  /** Total attempts allowed, including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryInput {
  outcome: AttemptOutcome;
  /** 1-based number of the attempt that just finished. */
  attempt: number;
  /** Time left in the call's total budget, after this attempt. */
  remainingMs: number;
  /** Parsed Retry-After of this attempt's response, when it had one. */
  retryAfterMs?: number;
}

export type RetryDecision = { retry: false } | { retry: true; delayMs: number };

function isTransient(outcome: AttemptOutcome): boolean {
  return outcome.kind === 'response'
    ? RETRYABLE_STATUSES.has(outcome.status)
    : RETRYABLE_FAILURES.has(outcome.reason);
}

/**
 * Decides whether to try again after an attempt, and how long to wait first.
 *
 * - Retry only after RETRYABLE_FAILURES (TIMEOUT, NETWORK) or RETRYABLE_STATUSES (502/503/504).
 *   Never after ABORTED (the caller gave up) or any other status (4xx, 500, 2xx, 3xx).
 * - Never beyond `policy.maxAttempts`.
 * - Delay: `retryAfterMs` when present, used as-is (the server said when; adding jitter on top
 *   of it is a planned improvement, see README). Otherwise exponential backoff with full
 *   jitter: random() × min(maxDelayMs, baseDelayMs × 2^(attempt − 1)).
 * - If the delay is >= `remainingMs`, don't retry: waiting until the deadline cannot produce
 *   an answer. This also stops when the budget is already exhausted (remainingMs <= 0).
 */
export function planRetry(
  input: RetryInput,
  policy: RetryPolicy,
  random: () => number,
): RetryDecision {
  const { outcome, attempt, remainingMs, retryAfterMs } = input;
  if (!isTransient(outcome) || attempt >= policy.maxAttempts) return { retry: false };

  const backoffCeilingMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  // `??`, not `||`: "Retry-After: 0" means "now" and must not fall back to the backoff.
  const delayMs = retryAfterMs ?? random() * backoffCeilingMs;

  // Strictly less: a wait that ends exactly at the deadline leaves no time for the attempt.
  return delayMs < remainingMs ? { retry: true, delayMs } : { retry: false };
}
