// Injected so tests control time: timeouts, backoff and elapsed time all go through it.
export interface Clock {
  /** Epoch milliseconds. Used for elapsed time and to resolve HTTP-date Retry-After values. */
  now(): number;
  /** Resolves after `ms`; rejects with `signal.reason` as soon as the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    }),
};
