import type { BankResultView, SimulationView } from '@simulador/shared';
import { isCounterOffer } from '../domain/offers';
import { totalPayableCents } from '../domain/price';
import { summarizeSimulation } from '../domain/simulation-status';
import type { StoredSimulation } from './ports/simulation-repository';

/**
 * What GET /simulations/:id returns. Deliberately leaves out everything stored that could
 * identify the customer or reveal the salary (margin, estimated installment, commitment).
 */
export function toSimulationView(simulation: StoredSimulation): SimulationView {
  const { requestedAmountCents } = simulation;
  const summary = summarizeSimulation(simulation.results, requestedAmountCents);

  const results = simulation.results.map((result): BankResultView =>
    result.status === 'APPROVED'
      ? {
          ...result,
          isCounterOffer: isCounterOffer(result.offer, requestedAmountCents),
          totalPayableCents: totalPayableCents(
            result.offer.installmentCents,
            result.offer.installments,
          ),
        }
      : result,
  );

  return {
    id: simulation.id,
    createdAt: simulation.createdAt.toISOString(),
    status: summary.status,
    retryable: summary.retryable,
    request: {
      requestedAmountCents,
      installments: simulation.installments,
      cpfMasked: simulation.cpfMasked,
    },
    margin: { fitsMargin: simulation.margin.fitsMargin },
    bestOffer: summary.bestOffer ? { bankId: summary.bestOffer.bankId } : null,
    results,
  };
}
