// Injected so tests control time: timeouts, backoff, expiry and shutdown waits all go through it.
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Resolves after `ms`; rejects with `signal.reason` as soon as the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
