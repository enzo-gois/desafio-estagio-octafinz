import type { BankResult } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { InMemorySimulationRepository } from '../infra/persistence/in-memory-simulation-repository';
import { createDeferred, type Deferred, flushPromises } from '../testing/async';
import { CUSTOMER } from '../testing/bank-fixtures';
import { createCaptureLogger } from '../testing/capture-logger';
import { FakeClock } from '../testing/fake-clock';
import { approved, newSimulation } from '../testing/simulation-fixtures';
import { BankCallAbort, type BankCallContext, type BankProvider } from './ports/bank-provider';
import type { SimulationRepository } from './ports/simulation-repository';
import {
  ADAPTER_FAILURE_MESSAGE,
  SHUTDOWN_MESSAGE,
  SimulationOrchestrator,
} from './simulation-orchestrator';

interface Call {
  signal: AbortSignal;
  context: BankCallContext;
  answer: Deferred<BankResult>;
}

/** A bank that answers only when the test says so, and (like the adapters) turns an abort into UNAVAILABLE. */
function controllableBank(id: string) {
  const calls: Call[] = [];
  const provider: BankProvider = {
    id,
    simulate: (_input, signal, context) => {
      const answer = createDeferred<BankResult>();
      signal.addEventListener('abort', () => {
        const reason = signal.reason instanceof BankCallAbort ? signal.reason.customerMessage : 'x';
        answer.resolve({ bankId: id, status: 'UNAVAILABLE', reason });
      });
      calls.push({ signal, context, answer });
      return answer.promise;
    },
  };
  const answer = (result: BankResult) => calls.at(-1)?.answer.resolve(result);
  return { provider, calls, answer };
}

async function setup(options: { repository?: SimulationRepository } = {}) {
  const repository = options.repository ?? new InMemorySimulationRepository();
  const banks = {
    alfa: controllableBank('alfa'),
    beta: controllableBank('beta'),
    gama: controllableBank('gama'),
  };
  const clock = new FakeClock();
  const capture = createCaptureLogger();
  const orchestrator = new SimulationOrchestrator({
    providers: Object.values(banks).map((bank) => bank.provider),
    repository,
    clock,
    logger: capture.logger,
  });
  const simulation = newSimulation();
  await repository.create(simulation);
  const statuses = async () =>
    (await repository.findById(simulation.id))?.results.map((result) => result.status);
  return { repository, banks, clock, capture, orchestrator, simulation, statuses };
}

describe('SimulationOrchestrator', () => {
  it('calls every bank in parallel with the input, a signal and the simulationId', async () => {
    const { orchestrator, banks, simulation } = await setup();
    orchestrator.start(simulation.id, CUSTOMER);

    for (const bank of Object.values(banks)) {
      expect(bank.calls).toHaveLength(1);
      expect(bank.calls[0]?.context).toEqual({ simulationId: simulation.id });
    }
    expect(orchestrator.runningCount).toBe(1);
  });

  it('writes each result as soon as it arrives: a slow bank is written after the others', async () => {
    const { orchestrator, banks, simulation, statuses } = await setup();
    orchestrator.start(simulation.id, CUSTOMER);

    banks.alfa.answer(approved('alfa'));
    banks.gama.answer({ bankId: 'gama', status: 'DENIED', reason: 'Não.' });
    await flushPromises();
    expect(await statuses()).toEqual(['APPROVED', 'PENDING', 'DENIED']);

    banks.beta.answer(approved('beta'));
    await flushPromises();
    expect(await statuses()).toEqual(['APPROVED', 'APPROVED', 'DENIED']);
    expect(orchestrator.runningCount).toBe(0);
  });

  it('records ERROR for an adapter that rejects, and still writes the other banks', async () => {
    const { orchestrator, banks, simulation, repository, capture } = await setup();
    orchestrator.start(simulation.id, CUSTOMER);

    banks.alfa.calls[0]?.answer.reject(new Error('adapter bug'));
    banks.beta.answer(approved('beta'));
    banks.gama.answer(approved('gama'));
    await flushPromises();

    const results = (await repository.findById(simulation.id))?.results;
    expect(results?.[0]).toEqual({
      bankId: 'alfa',
      status: 'ERROR',
      reason: ADAPTER_FAILURE_MESSAGE,
    });
    expect(results?.map((result) => result.status)).toEqual(['ERROR', 'APPROVED', 'APPROVED']);
    expect(capture.entries().some((entry) => entry.level === 50)).toBe(true);
  });

  it('records ERROR for an adapter that throws synchronously', async () => {
    const repository = new InMemorySimulationRepository();
    const simulation = newSimulation({ bankIds: ['alfa'] });
    await repository.create(simulation);
    const throwing: BankProvider = {
      id: 'alfa',
      simulate: () => {
        throw new Error('sync bug');
      },
    };
    const orchestrator = new SimulationOrchestrator({
      providers: [throwing],
      repository,
      clock: new FakeClock(),
      logger: createCaptureLogger().logger,
    });

    orchestrator.start(simulation.id, CUSTOMER);
    await flushPromises();

    expect((await repository.findById(simulation.id))?.results[0]?.status).toBe('ERROR');
  });

  it.each<[string, BankResult]>([
    ['a result for another bank', approved('beta')],
    ['a result still PENDING', { bankId: 'alfa', status: 'PENDING' }],
  ])('records ERROR when the adapter breaks its contract with %s', async (_, wrong) => {
    const { orchestrator, banks, simulation, repository } = await setup();
    orchestrator.start(simulation.id, CUSTOMER);

    banks.alfa.answer(wrong);
    await flushPromises();

    expect((await repository.findById(simulation.id))?.results[0]).toEqual({
      bankId: 'alfa',
      status: 'ERROR',
      reason: ADAPTER_FAILURE_MESSAGE,
    });
    // The other bank's row was not touched by alfa's wrong bankId.
    expect((await repository.findById(simulation.id))?.results[1]?.status).toBe('PENDING');
  });

  it('logs a failed write and keeps writing the other banks', async () => {
    const inner = new InMemorySimulationRepository();
    const flaky: SimulationRepository = {
      create: (simulation) => inner.create(simulation),
      findById: (id) => inner.findById(id),
      expirePending: (...args) => inner.expirePending(...args),
      completeBankResult: (id, result) =>
        result.bankId === 'beta'
          ? Promise.reject(new Error('disk full'))
          : inner.completeBankResult(id, result),
    };
    const { orchestrator, banks, simulation, capture } = await setup({ repository: flaky });
    orchestrator.start(simulation.id, CUSTOMER);

    for (const bank of Object.values(banks)) bank.answer(approved(bank.provider.id));
    await flushPromises();

    const statuses = (await inner.findById(simulation.id))?.results.map((result) => result.status);
    expect(statuses).toEqual(['APPROVED', 'PENDING', 'APPROVED']);
    expect(capture.entries()).toContainEqual(
      expect.objectContaining({ level: 50, bankId: 'beta', simulationId: simulation.id }),
    );
    expect(orchestrator.runningCount).toBe(0);
  });

  it('keeps an expired result when the real answer arrives later', async () => {
    const { orchestrator, banks, simulation, repository, capture } = await setup();
    orchestrator.start(simulation.id, CUSTOMER);
    await repository.expirePending(new Date('2100-01-01'), 'Expirou.', {
      simulationId: simulation.id,
    });

    banks.alfa.answer(approved('alfa'));
    await flushPromises();

    expect((await repository.findById(simulation.id))?.results[0]).toEqual({
      bankId: 'alfa',
      status: 'UNAVAILABLE',
      reason: 'Expirou.',
    });
    expect(capture.entries()).toContainEqual(
      expect.objectContaining({ level: 30, bankId: 'alfa', simulationId: simulation.id }),
    );
  });

  describe('two-phase shutdown', () => {
    const options = { drainMs: 6_000, abortGraceMs: 2_000 };

    it('stops accepting new simulations as soon as it starts', async () => {
      const { orchestrator, clock } = await setup();

      expect(orchestrator.isAccepting).toBe(true);
      await clock.run(orchestrator.shutdown(options));
      expect(orchestrator.isAccepting).toBe(false);
    });

    it('phase 1 (drain): waits for simulations that finish in time, aborting nothing', async () => {
      const { orchestrator, banks, simulation, clock, statuses } = await setup();
      orchestrator.start(simulation.id, CUSTOMER);
      const shutdown = orchestrator.shutdown(options);

      await clock.advance(3_000);
      for (const bank of Object.values(banks)) bank.answer(approved(bank.provider.id));

      expect(await clock.run(shutdown)).toEqual({ drained: true, aborted: 0 });
      expect(await statuses()).toEqual(['APPROVED', 'APPROVED', 'APPROVED']);
      expect(banks.gama.calls[0]?.signal.aborted).toBe(false);
    });

    it('phase 2: aborts what is left after drainMs and records the shutdown message', async () => {
      const { orchestrator, banks, simulation, clock, repository } = await setup();
      orchestrator.start(simulation.id, CUSTOMER);
      banks.alfa.answer(approved('alfa'));

      const outcome = await clock.run(orchestrator.shutdown(options));

      expect(outcome).toEqual({ drained: false, aborted: 1 });
      expect(clock.now() - Date.parse('2026-10-22T12:00:00Z')).toBe(6_000);
      const results = (await repository.findById(simulation.id))?.results;
      expect(results?.slice(1)).toEqual([
        { bankId: 'beta', status: 'UNAVAILABLE', reason: SHUTDOWN_MESSAGE },
        { bankId: 'gama', status: 'UNAVAILABLE', reason: SHUTDOWN_MESSAGE },
      ]);
      expect(SHUTDOWN_MESSAGE).toBe('O banco não respondeu a tempo. Tente novamente.');
    });

    it('returns within drainMs + abortGraceMs even if a bank ignores the abort', async () => {
      const repository = new InMemorySimulationRepository();
      const simulation = newSimulation({ bankIds: ['stuck'] });
      await repository.create(simulation);
      const stuck: BankProvider = { id: 'stuck', simulate: () => new Promise(() => {}) };
      const clock = new FakeClock();
      const orchestrator = new SimulationOrchestrator({
        providers: [stuck],
        repository,
        clock,
        logger: createCaptureLogger().logger,
      });
      orchestrator.start(simulation.id, CUSTOMER);

      expect(await clock.run(orchestrator.shutdown(options))).toEqual({
        drained: false,
        aborted: 1,
      });
      expect(clock.now() - Date.parse('2026-10-22T12:00:00Z')).toBe(8_000);
    });
  });
});
