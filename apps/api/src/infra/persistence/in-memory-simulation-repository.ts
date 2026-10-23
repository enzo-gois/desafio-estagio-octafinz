import type { BankResult } from '@simulador/shared';
import type {
  FinalBankResult,
  NewSimulation,
  SimulationRepository,
  StoredSimulation,
} from '../../application/ports/simulation-repository';

interface Entry {
  simulation: Omit<StoredSimulation, 'results'>;
  results: Map<string, BankResult>;
}

/**
 * Same contract as the Prisma repository (both run simulation-repository.contract.ts), kept in
 * memory for use-case and route tests. Returns copies so callers cannot mutate stored state.
 */
export class InMemorySimulationRepository implements SimulationRepository {
  readonly #entries = new Map<string, Entry>();

  async create({ bankIds, ...simulation }: NewSimulation): Promise<void> {
    if (this.#entries.has(simulation.id))
      throw new Error(`duplicate simulation id ${simulation.id}`);
    if (new Set(bankIds).size !== bankIds.length) throw new Error('duplicate bank id');

    this.#entries.set(simulation.id, {
      simulation: structuredClone(simulation),
      results: new Map(bankIds.map((bankId) => [bankId, { bankId, status: 'PENDING' }])),
    });
  }

  async findById(id: string): Promise<StoredSimulation | undefined> {
    const entry = this.#entries.get(id);
    if (!entry) return undefined;

    const results = [...entry.results.values()].sort((a, b) => (a.bankId < b.bankId ? -1 : 1));
    return structuredClone({ ...entry.simulation, results });
  }

  async completeBankResult(simulationId: string, result: FinalBankResult): Promise<boolean> {
    const results = this.#entries.get(simulationId)?.results;
    if (results?.get(result.bankId)?.status !== 'PENDING') return false;

    results.set(result.bankId, structuredClone(result));
    return true;
  }

  async expirePending(
    cutoff: Date,
    reason: string,
    filter?: { simulationId: string },
  ): Promise<number> {
    let changed = 0;
    for (const entry of this.#entries.values()) {
      if (filter && entry.simulation.id !== filter.simulationId) continue;
      if (entry.simulation.createdAt.getTime() >= cutoff.getTime()) continue;

      for (const [bankId, result] of entry.results) {
        if (result.status !== 'PENDING') continue;
        entry.results.set(bankId, { bankId, status: 'UNAVAILABLE', reason });
        changed += 1;
      }
    }
    return changed;
  }
}
