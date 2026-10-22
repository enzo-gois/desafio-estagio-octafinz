import type { BankResult, BankResultStatus } from '@simulador/shared';
import { type RankedOffer, selectBestOffer } from './offers';

export type SimulationStatus = 'PROCESSING' | 'COMPLETED_WITH_OFFERS' | 'COMPLETED_WITHOUT_OFFERS';

export interface SimulationSummary {
  status: SimulationStatus;
  counts: Record<BankResultStatus, number>;
  /** Also present while PROCESSING: the best offer so far. */
  bestOffer?: RankedOffer;
  /**
   * True once the simulation has finished and at least one bank failed (UNAVAILABLE/ERROR):
   * asking again may change the outcome. DENIED is a final answer, not a failure.
   */
  retryable: boolean;
}

export function summarizeSimulation(
  results: readonly BankResult[],
  requestedAmountCents: number,
): SimulationSummary {
  // A literal (not a loop over a runtime list): the domain imports shared types only, and
  // `satisfies` breaks the build if a new status is added without being counted here.
  const counts = {
    PENDING: 0,
    APPROVED: 0,
    DENIED: 0,
    UNAVAILABLE: 0,
    ERROR: 0,
  } satisfies Record<BankResultStatus, number>;
  for (const result of results) counts[result.status] += 1;

  const bestOffer = selectBestOffer(results, requestedAmountCents);
  const processing = counts.PENDING > 0;

  let status: SimulationStatus;
  if (processing) status = 'PROCESSING';
  else if (bestOffer) status = 'COMPLETED_WITH_OFFERS';
  else status = 'COMPLETED_WITHOUT_OFFERS';

  return {
    status,
    counts,
    bestOffer,
    retryable: !processing && counts.UNAVAILABLE + counts.ERROR > 0,
  };
}
