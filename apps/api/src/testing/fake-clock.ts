import type { Clock } from '../infra/http/clock';

interface Timer {
  at: number;
  fire: () => void;
}

// One macrotask: by the time it runs, every pending promise continuation has run.
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Deterministic Clock: time only moves when the test says so, and timers fire in order.
 * `run(promise)` jumps from timer to timer until the promise settles, so a test of a 7 s
 * timeout or a 2 s Retry-After takes milliseconds.
 */
export class FakeClock implements Clock {
  #now: number;
  readonly #timers = new Set<Timer>();
  /** Every delay requested through sleep(), in order (timeouts and backoffs alike). */
  readonly sleeps: number[] = [];

  constructor(start = Date.parse('2026-10-22T12:00:00Z')) {
    this.#now = start;
  }

  now = (): number => this.#now;

  sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      this.sleeps.push(ms);
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer: Timer = {
        at: this.#now + Math.max(0, ms),
        fire: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        this.#timers.delete(timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#timers.add(timer);
    });

  get pendingTimers(): number {
    return this.#timers.size;
  }

  /** Moves time forward by `ms`, firing every timer due on the way. */
  async advance(ms: number): Promise<void> {
    const target = this.#now + ms;
    for (;;) {
      await flushMicrotasks();
      const next = this.#earliest();
      if (!next || next.at > target) break;
      this.#fire(next);
    }
    this.#now = target;
    await flushMicrotasks();
  }

  /** Fires timers in order until `promise` settles; fails if it can never settle. */
  async run<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    const tracked = promise.finally(() => {
      settled = true;
    });
    tracked.catch(() => {}); // rejection is surfaced by the returned promise, not as unhandled

    for (;;) {
      await flushMicrotasks();
      if (settled) return tracked;
      const next = this.#earliest();
      if (!next) throw new Error('FakeClock.run: promise still pending and no timers left');
      this.#fire(next);
    }
  }

  #earliest(): Timer | undefined {
    let earliest: Timer | undefined;
    for (const timer of this.#timers) if (!earliest || timer.at < earliest.at) earliest = timer;
    return earliest;
  }

  #fire(timer: Timer): void {
    this.#timers.delete(timer);
    this.#now = Math.max(this.#now, timer.at);
    timer.fire();
  }
}
