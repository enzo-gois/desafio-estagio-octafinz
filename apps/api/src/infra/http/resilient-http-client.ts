import {
  type BreakerOptions,
  type CallVerdict,
  CircuitBreaker,
  type CircuitState,
} from './circuit-breaker';
import type { Clock } from './clock';
import { parseRetryAfterMs } from './retry-after';
import { type AttemptFailureReason, planRetry, type RetryPolicy } from './retry-policy';

export interface HttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export type TransportFailure = 'TIMEOUT' | 'NETWORK' | 'CIRCUIT_OPEN' | 'ABORTED';

interface CallStats {
  /** HTTP attempts actually made (0 when the call never reached the network). */
  attempts: number;
  /** Whole call, including waits between attempts. */
  elapsedMs: number;
}

/** Never thrown: every result of a call is one of these, so callers can switch exhaustively. */
export type HttpOutcome =
  | ({ kind: 'response'; status: number; headers: Headers; bodyText: string } & CallStats)
  | ({ kind: 'failure'; reason: TransportFailure } & CallStats);

export interface HttpSender {
  send(request: HttpRequest, signal: AbortSignal): Promise<HttpOutcome>;
}

export interface ResilienceOptions extends RetryPolicy {
  /** Budget for the whole call: every attempt plus every wait between attempts. */
  timeoutMs: number;
  /** Upper bound for a single attempt, further capped by what is left of `timeoutMs`. */
  attemptTimeoutMs: number;
  breaker: BreakerOptions;
}

export interface HttpClientDeps {
  fetch: typeof fetch;
  clock: Clock;
  random: () => number;
}

type AttemptResult =
  | { kind: 'response'; status: number; headers: Headers; bodyText: string }
  | { kind: 'failure'; reason: AttemptFailureReason };

class AttemptTimeoutError extends Error {
  constructor() {
    super('HTTP attempt timed out');
    this.name = 'AttemptTimeoutError';
  }
}

// 3xx and 4xx mean the bank is up and answering (the request is ours to fix); only 5xx and
// transport failures say the bank is unhealthy. An abort by the caller says nothing.
function breakerVerdict(outcome: HttpOutcome): CallVerdict {
  if (outcome.kind === 'response') return outcome.status >= 500 ? 'FAILURE' : 'SUCCESS';
  return outcome.reason === 'ABORTED' ? 'NEUTRAL' : 'FAILURE';
}

/**
 * POST client with total timeout, per-attempt timeout, retry with backoff + jitter and a
 * circuit breaker. Transport only: it returns status, headers and body text, never parses JSON.
 * The same request (and therefore the same Idempotency-Key header) is sent on every attempt.
 */
export class ResilientHttpClient implements HttpSender {
  readonly #options: ResilienceOptions;
  readonly #deps: HttpClientDeps;
  readonly #breaker: CircuitBreaker;

  constructor(
    options: ResilienceOptions,
    deps: HttpClientDeps,
    onCircuitChange?: (from: CircuitState, to: CircuitState) => void,
  ) {
    this.#options = options;
    this.#deps = deps;
    this.#breaker = new CircuitBreaker(options.breaker, () => deps.clock.now(), onCircuitChange);
  }

  get circuitState(): CircuitState {
    return this.#breaker.state;
  }

  async send(request: HttpRequest, signal: AbortSignal): Promise<HttpOutcome> {
    const startedAt = this.#deps.clock.now();
    // Checked before acquiring a permit so a cancelled call never consumes the trial slot.
    if (signal.aborted) return { kind: 'failure', reason: 'ABORTED', attempts: 0, elapsedMs: 0 };

    const permit = this.#breaker.tryAcquire();
    if (!permit) return { kind: 'failure', reason: 'CIRCUIT_OPEN', attempts: 0, elapsedMs: 0 };

    // Released in `finally` so not even an unexpected exception leaves a trial in flight.
    let verdict: CallVerdict = 'NEUTRAL';
    try {
      const outcome = await this.#sendWithRetries(request, signal, startedAt);
      verdict = breakerVerdict(outcome);
      return outcome;
    } finally {
      permit.release(verdict);
    }
  }

  async #sendWithRetries(
    request: HttpRequest,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<HttpOutcome> {
    const { clock, random } = this.#deps;
    const deadline = startedAt + this.#options.timeoutMs;
    const stats = (attempts: number): CallStats => ({
      attempts,
      elapsedMs: clock.now() - startedAt,
    });

    for (let attempt = 1; ; attempt += 1) {
      const attemptBudgetMs = Math.min(this.#options.attemptTimeoutMs, deadline - clock.now());
      if (attemptBudgetMs <= 0)
        return { kind: 'failure', reason: 'TIMEOUT', ...stats(attempt - 1) };

      const result = await this.#attempt(request, signal, attemptBudgetMs);
      const retryAfterMs =
        result.kind === 'response'
          ? parseRetryAfterMs(result.headers.get('retry-after'), clock.now())
          : undefined;
      const decision = planRetry(
        { outcome: result, attempt, remainingMs: deadline - clock.now(), retryAfterMs },
        this.#options,
        random,
      );
      if (!decision.retry) return { ...result, ...stats(attempt) };

      try {
        await clock.sleep(decision.delayMs, signal);
      } catch {
        return { kind: 'failure', reason: 'ABORTED', ...stats(attempt) };
      }
    }
  }

  async #attempt(
    request: HttpRequest,
    external: AbortSignal,
    timeoutMs: number,
  ): Promise<AttemptResult> {
    const { clock, fetch } = this.#deps;
    const timeout = new AbortController();
    const finished = new AbortController();
    void clock.sleep(timeoutMs, finished.signal).then(
      () => timeout.abort(new AttemptTimeoutError()),
      () => {}, // the attempt finished first and cancelled the timer
    );

    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        // Never follow redirects: the body carries personal data and must not be resent to
        // another address. A 3xx reaches the adapter (ERROR); 'error' would surface as a
        // network failure and be retried.
        redirect: 'manual',
        signal: AbortSignal.any([external, timeout.signal]),
      });
      const bodyText = await response.text();
      return { kind: 'response', status: response.status, headers: response.headers, bodyText };
    } catch {
      // The caller's abort wins over our own timeout: it must never be retried.
      if (external.aborted) return { kind: 'failure', reason: 'ABORTED' };
      if (timeout.signal.aborted) return { kind: 'failure', reason: 'TIMEOUT' };
      return { kind: 'failure', reason: 'NETWORK' };
    } finally {
      finished.abort();
    }
  }
}
