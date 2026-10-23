import { describe, expect, it } from 'vitest';
import { InMemorySimulationRepository } from '../infra/persistence/in-memory-simulation-repository';
import { CUSTOMER } from '../testing/bank-fixtures';
import { fakeStarter, T0 } from '../testing/simulation-fixtures';
import { CreateSimulation, ServiceUnavailableError } from './create-simulation';

const ID = '7d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a';

function setup(isAccepting = true) {
  const repository = new InMemorySimulationRepository();
  const starter = fakeStarter(isAccepting);
  const useCase = new CreateSimulation({
    repository,
    starter,
    clock: { now: () => T0.getTime() },
    generateId: () => ID,
    marginPolicy: { percent: 35, referenceMonthlyRate: 0.018 },
  });
  return { repository, starter, useCase };
}

describe('CreateSimulation', () => {
  it('stores the simulation with every bank PENDING and returns its id', async () => {
    const { useCase, repository } = setup();

    expect(await useCase.execute(CUSTOMER)).toEqual({ id: ID });
    expect(await repository.findById(ID)).toEqual({
      id: ID,
      createdAt: T0,
      consentedAt: T0,
      consentVersion: '2026-10-v1',
      requestedAmountCents: 1_000_000,
      installments: 48,
      cpfMasked: '***.982.247-**',
      // Salary 7.342,19 × 35% = 2.569,76; R$ 10.000 at 1.8% in 48x = 312,89 (Decimal-checked).
      margin: {
        percent: 35,
        referenceMonthlyRate: 0.018,
        marginCents: 256_976,
        estimatedInstallmentCents: 31_289,
        fitsMargin: true,
        commitmentBps: 1_218,
      },
      results: [
        { bankId: 'alfa', status: 'PENDING' },
        { bankId: 'beta', status: 'PENDING' },
        { bankId: 'gama', status: 'PENDING' },
      ],
    });
  });

  it('starts querying the banks only after the simulation is stored', async () => {
    const { useCase, repository, starter } = setup();
    let storedWhenStarted = false;
    starter.start.mockImplementation((id: string) => {
      void repository.findById(id).then((found) => (storedWhenStarted = found !== undefined));
    });

    await useCase.execute(CUSTOMER);
    await new Promise((resolve) => setImmediate(resolve));

    expect(starter.start).toHaveBeenCalledWith(ID, CUSTOMER);
    expect(storedWhenStarted).toBe(true);
  });

  it('does not block a request that exceeds the estimated margin (A1: informative only)', async () => {
    const { useCase, repository, starter } = setup();
    await useCase.execute({ ...CUSTOMER, netSalaryCents: 50_000 });

    expect((await repository.findById(ID))?.margin.fitsMargin).toBe(false);
    expect(starter.start).toHaveBeenCalled();
  });

  it('stores no name, e-mail, full CPF, birth date, employer or salary', async () => {
    const { useCase, repository } = setup();
    await useCase.execute(CUSTOMER);

    const stored = JSON.stringify(await repository.findById(ID));
    for (const value of [
      CUSTOMER.cpf,
      CUSTOMER.name,
      CUSTOMER.email,
      CUSTOMER.birthDate,
      CUSTOMER.employerCnpj,
      String(CUSTOMER.netSalaryCents),
    ]) {
      expect(stored).not.toContain(value);
    }
  });

  it('refuses new simulations during shutdown, before storing anything', async () => {
    const { useCase, repository, starter } = setup(false);

    await expect(useCase.execute(CUSTOMER)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(await repository.findById(ID)).toBeUndefined();
    expect(starter.start).not.toHaveBeenCalled();
  });
});
