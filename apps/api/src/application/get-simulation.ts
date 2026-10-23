import type { SimulationView } from '@simulador/shared';
import type { BankDescriptor } from './ports/bank-catalog';
import type { Clock } from './ports/clock';
import type { SimulationRepository, StoredSimulation } from './ports/simulation-repository';
import { toSimulationView } from './simulation-view';

/** Recorded for banks still PENDING after the TTL (crash, restart or a stuck orchestration). */
export const PENDING_EXPIRED_MESSAGE = 'O banco não respondeu a tempo.';

export interface GetSimulationDeps {
  repository: SimulationRepository;
  clock: Pick<Clock, 'now'>;
  /** Longest bank budget plus slack: after this, nothing can still be answering. */
  pendingTtlMs: number;
  /** Where each result's display name comes from. */
  banks: readonly BankDescriptor[];
}

export class GetSimulation {
  private readonly bankNames: ReadonlyMap<string, string>;

  constructor(private readonly deps: GetSimulationDeps) {
    this.bankNames = new Map(deps.banks.map((bank) => [bank.id, bank.displayName]));
  }

  async execute(id: string): Promise<SimulationView | undefined> {
    const { repository, clock, pendingTtlMs } = this.deps;
    const simulation = await repository.findById(id);
    if (!simulation) return undefined;

    // Decision E3 (on read): the customer never sees a PENDING that can no longer change.
    // The write is conditional, so a real result arriving at the same moment still wins.
    const cutoff = new Date(clock.now() - pendingTtlMs);
    const stale = simulation.createdAt < cutoff;
    if (stale && simulation.results.some((result) => result.status === 'PENDING')) {
      await repository.expirePending(cutoff, PENDING_EXPIRED_MESSAGE, { simulationId: id });
      const refreshed = await repository.findById(id);
      if (refreshed) return this.toView(refreshed);
    }

    return this.toView(simulation);
  }

  private toView(simulation: StoredSimulation): SimulationView {
    return toSimulationView(simulation, {
      // Read after the database: the closer to sending, the better the front's clock offset.
      serverTime: new Date(this.deps.clock.now()),
      // A bank removed from the registry still has rows in old simulations; its id is the
      // best name left.
      bankName: (bankId) => this.bankNames.get(bankId) ?? bankId,
    });
  }
}
