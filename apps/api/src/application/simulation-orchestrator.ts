import type { BankResult, SimulationInput } from '@simulador/shared';
import { BankCallAbort, type BankProvider } from './ports/bank-provider';
import type { Clock } from './ports/clock';
import type { Logger } from './ports/logger';
import type { FinalBankResult, SimulationRepository } from './ports/simulation-repository';

/** Recorded for banks still running when the shutdown drain ends. */
export const SHUTDOWN_MESSAGE = 'O banco não respondeu a tempo. Tente novamente.';
/** Recorded when an adapter breaks its contract (rejects, or returns PENDING/another bank). */
export const ADAPTER_FAILURE_MESSAGE = 'Não foi possível concluir a consulta neste banco.';

export interface ShutdownOptions {
  /** Phase 1: how long to wait for running simulations to finish on their own. */
  drainMs: number;
  /** Phase 2: after aborting the rest, how long to wait for their results to be written. */
  abortGraceMs: number;
}

export interface OrchestratorDeps {
  providers: readonly BankProvider[];
  repository: SimulationRepository;
  clock: Clock;
  logger: Logger;
}

/** ERROR result for a bank whose adapter broke its contract. */
export function adapterFailureResult(bankId: string): FinalBankResult {
  return { bankId, status: 'ERROR', reason: ADAPTER_FAILURE_MESSAGE };
}

/** True when `result` is a final result for `bankId` (adapters must never return PENDING). */
export function isFinalResultFor(result: BankResult, bankId: string): result is FinalBankResult {
  return result.bankId === bankId && result.status !== 'PENDING';
}

/**
 * Calls every bank in parallel for a simulation and writes each result as soon as it arrives.
 * Runs in the background: `start` never throws and never leaves a promise unhandled.
 */
export class SimulationOrchestrator {
  readonly #deps: OrchestratorDeps;
  readonly #running = new Map<Promise<void>, AbortController>();
  #accepting = true;

  constructor(deps: OrchestratorDeps) {
    this.#deps = deps;
  }

  get bankIds(): readonly string[] {
    return this.#deps.providers.map((provider) => provider.id);
  }

  /** False once shutdown has begun: new simulations must be refused before they are stored. */
  get isAccepting(): boolean {
    return this.#accepting;
  }

  get runningCount(): number {
    return this.#running.size;
  }

  start(simulationId: string, input: SimulationInput): void {
    const controller = new AbortController();
    const logger = this.#deps.logger.child({ simulationId });

    const task: Promise<void> = this.#run(simulationId, input, controller.signal, logger)
      .catch((error: unknown) => {
        logger.error({ errorName: errorName(error) }, 'simulation orchestration failed');
      })
      .finally(() => {
        this.#running.delete(task);
      });
    this.#running.set(task, controller);
  }

  /**
   * Two-phase shutdown. Phase 1 (drain): refuse new simulations and wait up to `drainMs` for
   * the running ones. Phase 2: abort what is left with a customer-facing message and wait up
   * to `abortGraceMs` for those results to be written.
   */
  async shutdown(options: ShutdownOptions): Promise<{ drained: boolean; aborted: number }> {
    this.#accepting = false;
    const drained = await this.#waitForRunning(options.drainMs);
    if (drained) return { drained, aborted: 0 };

    const remaining = [...this.#running.values()];
    for (const controller of remaining) controller.abort(new BankCallAbort(SHUTDOWN_MESSAGE));
    await this.#waitForRunning(options.abortGraceMs);
    return { drained, aborted: remaining.length };
  }

  async #run(
    simulationId: string,
    input: SimulationInput,
    signal: AbortSignal,
    logger: Logger,
  ): Promise<void> {
    const settled = await Promise.allSettled(
      this.#deps.providers.map((provider) =>
        this.#runBank(provider, simulationId, input, signal, logger),
      ),
    );
    // #runBank handles its own failures; a rejection here is a bug in it and must not vanish.
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        logger.error({ errorName: errorName(outcome.reason) }, 'bank task failed unexpectedly');
      }
    }
  }

  /**
   * One bank of one simulation:
   * 1. Call the adapter. If it breaks its contract (throws, rejects, or returns PENDING or
   *    another bank's result: check with isFinalResultFor), use adapterFailureResult instead
   *    and log at error level.
   * 2. Write with repository.completeBankResult. `false` means the row was no longer PENDING
   *    (it expired first): the stored result stays; log at info level.
   * 3. A failed write is logged at error level and must not affect the other banks.
   * Every log line includes `bankId` (the logger already carries `simulationId`).
   */
  async #runBank(
    provider: BankProvider,
    simulationId: string,
    input: SimulationInput,
    signal: AbortSignal,
    logger: Logger,
  ): Promise<void> {
    const bankLogger = logger.child({ bankId: provider.id });

    let result: FinalBankResult;
    try {
      const answer = await provider.simulate(input, signal, { simulationId });

      if (isFinalResultFor(answer, provider.id)) result = answer;
      else {
        bankLogger.error(
          { returnedStatus: answer.status, returnedBankId: answer.bankId },
          'adapter broke its contract',
        );
        result = adapterFailureResult(provider.id);
      }
    } catch (error) {
      bankLogger.error({ errorName: errorName(error) }, 'adapter rejected despite its contract');
      result = adapterFailureResult(provider.id);
    }

    try {
      const written = await this.#deps.repository.completeBankResult(simulationId, result);
      if (!written) {
        bankLogger.info(
          { status: result.status },
          'bank already finalized; kept the stored result',
        );
      }
    } catch (error) {
      bankLogger.error({ errorName: errorName(error) }, 'failed to store bank result');
    }
  }

  /** Resolves true when nothing is running anymore, false if `ms` elapsed first. */
  async #waitForRunning(ms: number): Promise<boolean> {
    if (this.#running.size === 0) return true;

    const timer = new AbortController();
    const allDone = Promise.allSettled([...this.#running.keys()]).then(() => true);
    const timeout = this.#deps.clock.sleep(ms, timer.signal).then(
      () => false,
      () => false,
    );
    const finished = await Promise.race([allDone, timeout]);
    timer.abort();
    // Tasks started during the wait are not in `allDone`; report what is actually left.
    return finished && this.#running.size === 0;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
