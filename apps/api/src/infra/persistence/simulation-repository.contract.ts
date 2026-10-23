import { expect, it } from 'vitest';
import type { SimulationRepository } from '../../application/ports/simulation-repository';
import { approved, newSimulation } from '../../testing/simulation-fixtures';

/**
 * Behavior every SimulationRepository must have. Runs against the in-memory implementation
 * (unit tests) and against Prisma + real SQLite (integration), so the fake used by the
 * use-case tests cannot drift from the real one. Every test uses fresh random ids, so one
 * repository instance can be shared by the whole suite.
 */
export function simulationRepositoryContract(repository: () => SimulationRepository): void {
  it('stores a simulation with one PENDING result per bank, ordered by bankId', async () => {
    const simulation = newSimulation({ bankIds: ['gama', 'alfa', 'beta'] });
    await repository().create(simulation);

    const stored = await repository().findById(simulation.id);
    expect(stored?.results).toEqual([
      { bankId: 'alfa', status: 'PENDING' },
      { bankId: 'beta', status: 'PENDING' },
      { bankId: 'gama', status: 'PENDING' },
    ]);
  });

  it('round-trips every stored field', async () => {
    const { bankIds: _ids, ...expected } = newSimulation();
    await repository().create({ ...expected, bankIds: ['alfa'] });

    const { results: _results, ...stored } = (await repository().findById(expected.id)) ?? {};
    expect(stored).toEqual(expected);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await repository().findById('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('refuses a duplicate id', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);

    await expect(repository().create(simulation)).rejects.toThrow();
  });

  it('completes a PENDING result and reads the offer back', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);

    expect(await repository().completeBankResult(simulation.id, approved('beta'))).toBe(true);
    const stored = await repository().findById(simulation.id);
    expect(stored?.results[1]).toEqual(approved('beta'));
  });

  it('keeps absent optional fields absent (not null)', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);
    await repository().completeBankResult(simulation.id, {
      bankId: 'alfa',
      status: 'DENIED',
      reason: 'Idade fora da faixa aceita pelo banco.',
    });

    const stored = await repository().findById(simulation.id);
    expect(stored?.results[0]).toStrictEqual({
      bankId: 'alfa',
      status: 'DENIED',
      reason: 'Idade fora da faixa aceita pelo banco.',
    });
  });

  it('the first final result wins: a second completion changes nothing', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);
    await repository().completeBankResult(simulation.id, approved('alfa'));

    const second = await repository().completeBankResult(simulation.id, {
      bankId: 'alfa',
      status: 'ERROR',
    });

    expect(second).toBe(false);
    expect((await repository().findById(simulation.id))?.results[0]).toEqual(approved('alfa'));
  });

  it('returns false for an unknown simulation or bank', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);

    expect(await repository().completeBankResult('nope', approved('alfa'))).toBe(false);
    expect(await repository().completeBankResult(simulation.id, approved('delta'))).toBe(false);
  });

  it('keeps every result when different banks complete at the same time (no lost update)', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);

    const written = await Promise.all([
      repository().completeBankResult(simulation.id, approved('alfa')),
      repository().completeBankResult(simulation.id, { bankId: 'beta', status: 'DENIED' }),
      repository().completeBankResult(simulation.id, { bankId: 'gama', status: 'UNAVAILABLE' }),
    ]);

    expect(written).toEqual([true, true, true]);
    const statuses = (await repository().findById(simulation.id))?.results.map((r) => r.status);
    expect(statuses).toEqual(['APPROVED', 'DENIED', 'UNAVAILABLE']);
  });

  it('lets exactly one of two simultaneous completions of the same bank win', async () => {
    const simulation = newSimulation();
    await repository().create(simulation);

    const written = await Promise.all([
      repository().completeBankResult(simulation.id, approved('alfa')),
      repository().completeBankResult(simulation.id, { bankId: 'alfa', status: 'ERROR' }),
    ]);

    expect(written.filter(Boolean)).toHaveLength(1);
  });

  it('expires PENDING results of old simulations only, keeping final results', async () => {
    // Year 2000: far older than any other simulation in the suite, so the count is exact.
    const old = newSimulation({ createdAt: new Date('2000-01-01T00:00:00Z') });
    const recent = newSimulation({ createdAt: new Date('2000-01-03T00:00:00Z') });
    await repository().create(old);
    await repository().create(recent);
    await repository().completeBankResult(old.id, approved('alfa'));

    const changed = await repository().expirePending(new Date('2000-01-02T00:00:00Z'), 'Expirou.');

    expect(changed).toBe(2);
    expect((await repository().findById(old.id))?.results).toEqual([
      approved('alfa'),
      { bankId: 'beta', status: 'UNAVAILABLE', reason: 'Expirou.' },
      { bankId: 'gama', status: 'UNAVAILABLE', reason: 'Expirou.' },
    ]);
    const recentStatuses = (await repository().findById(recent.id))?.results.map((r) => r.status);
    expect(recentStatuses).toEqual(['PENDING', 'PENDING', 'PENDING']);
  });

  it('can expire the results of a single simulation', async () => {
    const createdAt = new Date('2001-01-01T00:00:00Z');
    const target = newSimulation({ createdAt });
    const other = newSimulation({ createdAt });
    await repository().create(target);
    await repository().create(other);

    const changed = await repository().expirePending(new Date('2001-01-02T00:00:00Z'), 'Expirou.', {
      simulationId: target.id,
    });

    expect(changed).toBe(3);
    expect((await repository().findById(other.id))?.results[0]?.status).toBe('PENDING');
  });
}
