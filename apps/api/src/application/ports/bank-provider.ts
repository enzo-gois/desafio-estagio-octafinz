import type { BankResult, SimulationInput } from '@simulador/shared';

export interface BankCallContext {
  /** Stable for the whole simulation; banks use `simulationId:bankId` to deduplicate retries. */
  simulationId: string;
}

/**
 * Abort reason that tells the adapter which message to record for the customer. Whoever aborts
 * knows why (e.g. the API is shutting down); the adapter only knows that it was aborted.
 */
export class BankCallAbort extends Error {
  constructor(readonly customerMessage: string) {
    super(customerMessage);
    this.name = 'BankCallAbort';
  }
}

/** Port implemented by one adapter per bank (infra/banks). */
export interface BankProvider {
  readonly id: string;
  /**
   * Never rejects: every failure becomes a BankResult with status UNAVAILABLE (the bank did not
   * answer) or ERROR (it answered something wrong).
   */
  simulate(
    input: SimulationInput,
    signal: AbortSignal,
    context: BankCallContext,
  ): Promise<BankResult>;
}
