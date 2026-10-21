export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

// Rejects with `signal.reason` as soon as the signal aborts, clearing the timer so a
// pending 30s "timeout" scenario does not keep the process alive on shutdown.
export const abortableSleep: Sleep = (ms, signal) =>
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
  });
