import { simulationViewSchema } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { InMemorySimulationRepository } from '../infra/persistence/in-memory-simulation-repository';
import { CUSTOMER } from '../testing/bank-fixtures';
import { approved, BANKS, fakeStarter, newSimulation, T0 } from '../testing/simulation-fixtures';
import { CreateSimulation } from './create-simulation';
import { GetSimulation, PENDING_EXPIRED_MESSAGE } from './get-simulation';

const TTL_MS = 22_000;

function setup() {
  const repository = new InMemorySimulationRepository();
  let now = T0.getTime();
  const clock = { now: () => now };
  const getSimulation = new GetSimulation({
    repository,
    clock,
    pendingTtlMs: TTL_MS,
    banks: BANKS,
  });
  return {
    repository,
    getSimulation,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('GetSimulation', () => {
  it('returns undefined for an unknown id', async () => {
    expect(
      await setup().getSimulation.execute('3f0e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b'),
    ).toBeUndefined();
  });

  it('is PROCESSING while any bank is PENDING, already showing the best offer so far', async () => {
    const { repository, getSimulation } = setup();
    const simulation = newSimulation();
    await repository.create(simulation);
    await repository.completeBankResult(simulation.id, approved('alfa'));

    const view = await getSimulation.execute(simulation.id);

    expect(view).toMatchObject({
      status: 'PROCESSING',
      retryable: false,
      bestOffer: { bankId: 'alfa' },
    });
  });

  it('builds the full view: best offer, counter-offer flag, total to pay, retryable', async () => {
    const { repository, getSimulation } = setup();
    const simulation = newSimulation();
    await repository.create(simulation);
    await repository.completeBankResult(simulation.id, approved('alfa'));
    await repository.completeBankResult(simulation.id, {
      bankId: 'beta',
      status: 'APPROVED',
      offer: {
        amountCents: 818_255,
        installments: 48,
        monthlyRate: 0.0159,
        installmentCents: 24_500,
      },
    });
    await repository.completeBankResult(simulation.id, { bankId: 'gama', status: 'UNAVAILABLE' });

    const view = await getSimulation.execute(simulation.id);

    expect(simulationViewSchema.parse(view)).toEqual({
      id: simulation.id,
      createdAt: '2026-10-22T12:00:00.000Z',
      serverTime: '2026-10-22T12:00:00.000Z',
      status: 'COMPLETED_WITH_OFFERS',
      retryable: true,
      request: { requestedAmountCents: 1_000_000, installments: 48, cpfMasked: '***.982.247-**' },
      margin: { fitsMargin: true },
      bestOffer: { bankId: 'beta' }, // lowest rate, even though it is a counter-offer (B1)
      results: [
        {
          ...approved('alfa'),
          bankName: 'Banco Alfa',
          isCounterOffer: false,
          totalPayableCents: 1_498_752,
        },
        {
          bankId: 'beta',
          bankName: 'Banco Beta',
          status: 'APPROVED',
          offer: {
            amountCents: 818_255,
            installments: 48,
            monthlyRate: 0.0159,
            installmentCents: 24_500,
          },
          isCounterOffer: true,
          totalPayableCents: 1_176_000,
        },
        { bankId: 'gama', bankName: 'Banco Gama', status: 'UNAVAILABLE' },
      ],
    });
  });

  it("reports the server's time at read, not the creation time", async () => {
    const { repository, getSimulation, advance } = setup();
    const simulation = newSimulation();
    await repository.create(simulation);
    advance(7_250);

    expect(await getSimulation.execute(simulation.id)).toMatchObject({
      createdAt: '2026-10-22T12:00:00.000Z',
      serverTime: '2026-10-22T12:00:07.250Z',
    });
  });

  it('names a bank no longer in the registry after its id', async () => {
    const { repository, getSimulation } = setup();
    const simulation = newSimulation({ bankIds: ['alfa', 'delta'] });
    await repository.create(simulation);

    const view = await getSimulation.execute(simulation.id);

    expect(view?.results.map((result) => result.bankName)).toEqual(['Banco Alfa', 'delta']);
  });

  describe('PENDING expiry (E3, on read)', () => {
    it('keeps PENDING up to the TTL', async () => {
      const { repository, getSimulation, advance } = setup();
      const simulation = newSimulation();
      await repository.create(simulation);
      advance(TTL_MS);

      expect((await getSimulation.execute(simulation.id))?.status).toBe('PROCESSING');
    });

    it('turns PENDING older than the TTL into UNAVAILABLE and stores it', async () => {
      const { repository, getSimulation, advance } = setup();
      const simulation = newSimulation();
      await repository.create(simulation);
      await repository.completeBankResult(simulation.id, approved('alfa'));
      advance(TTL_MS + 1);

      const view = await getSimulation.execute(simulation.id);

      expect(view).toMatchObject({ status: 'COMPLETED_WITH_OFFERS', retryable: true });
      const expired = { status: 'UNAVAILABLE', reason: PENDING_EXPIRED_MESSAGE };
      expect(view?.results.slice(1)).toEqual([
        { bankId: 'beta', bankName: 'Banco Beta', ...expired },
        { bankId: 'gama', bankName: 'Banco Gama', ...expired },
      ]);
      expect((await repository.findById(simulation.id))?.results[1]).toMatchObject(expired);
    });
  });

  describe('personal data', () => {
    async function viewFor(netSalaryCents: number) {
      const repository = new InMemorySimulationRepository();
      let next = 0;
      const ids = ['1a2b3c4d-0000-4000-8000-000000000001', '1a2b3c4d-0000-4000-8000-000000000002'];
      const create = new CreateSimulation({
        repository,
        starter: fakeStarter(),
        clock: { now: () => T0.getTime() },
        generateId: () => ids[next++] ?? 'unexpected',
        marginPolicy: { percent: 35, referenceMonthlyRate: 0.018 },
      });
      const get = new GetSimulation({
        repository,
        clock: { now: () => T0.getTime() },
        pendingTtlMs: TTL_MS,
        banks: BANKS,
      });
      const { id } = await create.execute({ ...CUSTOMER, netSalaryCents });
      const { id: _id, ...view } = (await get.execute(id)) ?? {};
      return view;
    }

    it('returns nothing that identifies the customer or reveals the salary', async () => {
      const json = JSON.stringify(await viewFor(CUSTOMER.netSalaryCents));

      for (const value of [
        CUSTOMER.cpf,
        CUSTOMER.name,
        CUSTOMER.email,
        CUSTOMER.birthDate,
        CUSTOMER.employerCnpj,
        '734219', // salary in cents
        '256976', // margin (35% of the salary)
        '31289', // estimated installment
        'marginCents',
        'commitmentBps',
        'percent',
      ]) {
        expect(json).not.toContain(value);
      }
    });

    it.each([
      ['salaries that fit the margin', [500_000, 734_219, 2_000_000]],
      ['salaries that do not fit the margin', [50_000, 80_000]],
    ])(
      'cannot be used to reconstruct the salary: %s give identical responses',
      async (_, salaries) => {
        const views = await Promise.all(salaries.map((salary) => viewFor(salary)));

        for (const view of views) expect(view).toEqual(views[0]);
      },
    );
  });
});
