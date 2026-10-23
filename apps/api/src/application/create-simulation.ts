import { CONSENT_VERSION, maskCpf, type SimulationInput } from '@simulador/shared';
import { assessMargin, type MarginPolicy } from '../domain/margin';
import type { Clock } from './ports/clock';
import type { SimulationRepository } from './ports/simulation-repository';

/** The part of the orchestrator CreateSimulation needs (a fake in tests). */
export interface SimulationStarter {
  readonly isAccepting: boolean;
  readonly bankIds: readonly string[];
  start(simulationId: string, input: SimulationInput): void;
}

/** The API is shutting down and does not take new simulations (HTTP 503). */
export class ServiceUnavailableError extends Error {
  constructor() {
    super('Not accepting new simulations');
    this.name = 'ServiceUnavailableError';
  }
}

export interface CreateSimulationDeps {
  repository: SimulationRepository;
  starter: SimulationStarter;
  clock: Pick<Clock, 'now'>;
  generateId: () => string;
  marginPolicy: MarginPolicy;
}

export class CreateSimulation {
  constructor(private readonly deps: CreateSimulationDeps) {}

  /**
   * Stores the simulation with every bank PENDING and starts querying the banks in the
   * background. Returns as soon as it is stored: the banks' answers come through the GET.
   */
  async execute(input: SimulationInput): Promise<{ id: string }> {
    const { repository, starter, clock, generateId, marginPolicy } = this.deps;
    // Checked before storing: a simulation stored during shutdown would never be queried.
    if (!starter.isAccepting) throw new ServiceUnavailableError();

    const id = generateId();
    const now = new Date(clock.now());
    // Informative only (decision A1): the banks are queried whatever the result.
    const margin = assessMargin(
      {
        netSalaryCents: input.netSalaryCents,
        requestedAmountCents: input.requestedAmountCents,
        installments: input.installments,
      },
      marginPolicy,
    );

    // Only what the GET or a later audit needs is stored; see README (Dados pessoais gravados).
    await repository.create({
      id,
      createdAt: now,
      consentedAt: now,
      consentVersion: CONSENT_VERSION,
      requestedAmountCents: input.requestedAmountCents,
      installments: input.installments,
      cpfMasked: maskCpf(input.cpf),
      margin: { ...margin, ...marginPolicy },
      bankIds: starter.bankIds,
    });

    // The full input (CPF, salary, birth date...) lives only in memory, for the bank calls.
    starter.start(id, input);
    return { id };
  }
}
