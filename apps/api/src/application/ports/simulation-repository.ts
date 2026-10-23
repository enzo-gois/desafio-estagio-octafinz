import type { BankResult, BankResultStatus } from '@simulador/shared';
import type { MarginAssessment } from '../../domain/margin';

// Not Exclude<BankResult, { status: 'PENDING' }>: the non-approved variant has a union status
// ('PENDING' | 'DENIED' | ...), so Exclude would remove nothing. Narrowing the field does.
export type FinalBankResult = BankResult & { status: Exclude<BankResultStatus, 'PENDING'> };

/** Margin assessment plus the policy used for it, frozen at creation time. */
export interface StoredMargin extends MarginAssessment {
  percent: number;
  referenceMonthlyRate: number;
}

export interface NewSimulation {
  id: string;
  createdAt: Date;
  consentedAt: Date;
  consentVersion: string;
  requestedAmountCents: number;
  installments: number;
  cpfMasked: string;
  margin: StoredMargin;
  /** One PENDING result is created for each bank, in this order. */
  bankIds: readonly string[];
}

export interface StoredSimulation extends Omit<NewSimulation, 'bankIds'> {
  /** Ordered by bankId. */
  results: BankResult[];
}

export interface SimulationRepository {
  /** Inserts the simulation and one PENDING result per bank, atomically. */
  create(simulation: NewSimulation): Promise<void>;

  findById(id: string): Promise<StoredSimulation | undefined>;

  /**
   * Moves one bank from PENDING to a final result. Returns false, changing nothing, when that
   * bank was no longer PENDING (or does not exist): the first final result always wins.
   */
  completeBankResult(simulationId: string, result: FinalBankResult): Promise<boolean>;

  /**
   * Marks as UNAVAILABLE, with `reason`, every PENDING result of simulations created before
   * `cutoff` (optionally of one simulation only). Returns how many results changed.
   */
  expirePending(cutoff: Date, reason: string, filter?: { simulationId: string }): Promise<number>;
}
