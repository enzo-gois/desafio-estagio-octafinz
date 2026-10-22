export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * How a finished call affects the breaker:
 * - SUCCESS: the bank answered without a 5xx (including 3xx/4xx: the bank is up, the problem is ours).
 * - FAILURE: 5xx or a transport failure (timeout, network).
 * - NEUTRAL: the caller aborted; says nothing about the bank's health.
 */
export type CallVerdict = 'SUCCESS' | 'FAILURE' | 'NEUTRAL';

export interface BreakerOptions {
  /** Consecutive failed calls that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays OPEN before letting a single trial call through. */
  openMs: number;
}

export interface CircuitPermit {
  /** Reports the call's verdict. Only the first release counts. */
  release(verdict: CallVerdict): void;
}

export class CircuitBreaker {
  #state: CircuitState = 'CLOSED';
  #consecutiveFailures = 0;
  #openedAt = 0;
  // Bumped every time the circuit closes: results of calls started in an earlier CLOSED period
  // must not count against (or for) the current one.
  #closedEpoch = 0;

  constructor(
    private readonly options: BreakerOptions,
    private readonly now: () => number,
    private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void,
  ) {}

  get state(): CircuitState {
    return this.#state;
  }

  /** A permit to call the bank, or undefined when the call must fail fast (CIRCUIT_OPEN). */
  tryAcquire(): CircuitPermit | undefined {
    if (this.#state === 'CLOSED') {
      const epoch = this.#closedEpoch;
      return this.#permit((verdict) => this.#onClosedCallEnd(verdict, epoch));
    }
    if (this.#state === 'OPEN' && this.now() - this.#openedAt >= this.options.openMs) {
      this.#transition('HALF_OPEN');
      return this.#permit((verdict) => this.#onTrialEnd(verdict));
    }
    // OPEN and still cooling down, or HALF_OPEN with its single trial already in flight.
    return undefined;
  }

  #permit(onRelease: (verdict: CallVerdict) => void): CircuitPermit {
    let released = false;
    return {
      release: (verdict) => {
        if (released) return;
        released = true;
        onRelease(verdict);
      },
    };
  }

  #onClosedCallEnd(verdict: CallVerdict, epoch: number): void {
    // A late result from before the circuit opened never overrides OPEN/HALF_OPEN.
    if (this.#state !== 'CLOSED' || epoch !== this.#closedEpoch) return;

    if (verdict === 'SUCCESS') {
      this.#consecutiveFailures = 0;
    } else if (verdict === 'FAILURE') {
      this.#consecutiveFailures += 1;
      if (this.#consecutiveFailures >= this.options.failureThreshold) this.#open();
    }
  }

  // Every trial outcome leads to a defined state, so the breaker never stays in HALF_OPEN.
  #onTrialEnd(verdict: CallVerdict): void {
    if (verdict === 'SUCCESS') {
      this.#consecutiveFailures = 0;
      this.#closedEpoch += 1;
      this.#transition('CLOSED');
    } else if (verdict === 'FAILURE') {
      this.#open();
    } else {
      // Aborted trial: free the slot and go back to OPEN keeping the original openedAt. The
      // cool-down has already elapsed, so the next call becomes the new trial right away.
      this.#transition('OPEN');
    }
  }

  #open(): void {
    this.#openedAt = this.now();
    this.#consecutiveFailures = 0;
    this.#transition('OPEN');
  }

  #transition(to: CircuitState): void {
    const from = this.#state;
    this.#state = to;
    if (from !== to) this.onStateChange?.(from, to);
  }
}
