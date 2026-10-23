import type { SimulationView } from '@simulador/shared';
import type { Clock } from './ports/clock';
import type { SimulationRepository } from './ports/simulation-repository';
import { toSimulationView } from './simulation-view';

/** Recorded for banks still PENDING after the TTL (crash, restart or a stuck orchestration). */
export const PENDING_EXPIRED_MESSAGE = 'O banco não respondeu a tempo.';

export interface GetSimulationDeps {
  repository: SimulationRepository;
  clock: Pick<Clock, 'now'>;
  /** Longest bank budget plus slack: after this, nothing can still be answering. */
  pendingTtlMs: number;
}

export class GetSimulation {
  constructor(private readonly deps: GetSimulationDeps) {}

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
      if (refreshed) return toSimulationView(refreshed);
    }

    return toSimulationView(simulation);
  }
}
