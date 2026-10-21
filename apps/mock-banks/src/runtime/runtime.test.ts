import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMonthsUtc, ageOn } from './age';
import { consignableMarginCents, priceInstallmentCents } from './loan-math';
import { pickLatencyMs, resolveScenario } from './scenario';
import { abortableSleep } from './sleep';

describe('priceInstallmentCents', () => {
  // Independently computed with 50-digit Decimal and an amortization schedule.
  it.each([
    [1_000_000, 0.0179, 48, 31_224],
    [1_000_000, 0.0159, 48, 29_942],
    [1_000_000, 0.0166, 48, 30_388],
    [850_000, 0.0159, 48, 25_451],
    [1_000_000, 0.0205, 48, 32_934],
    [1_000_000, 0.0189, 36, 38_543],
  ])('%i cents at %f in %ix -> %i cents', (principal, rate, months, expected) => {
    expect(priceInstallmentCents(principal, rate, months)).toBe(expected);
  });
});

describe('consignableMarginCents', () => {
  it('rounds down to whole cents', () => {
    expect(consignableMarginCents(104_079, 30)).toBe(31_223);
    expect(consignableMarginCents(104_080, 30)).toBe(31_224);
  });
});

describe('ageOn', () => {
  const today = new Date('2026-10-21T12:00:00Z');

  it('counts the birthday on the day itself', () => {
    expect(ageOn('2005-10-21', today)).toBe(21);
    expect(ageOn('2005-10-22', today)).toBe(20);
  });

  it('treats a leap-day birthday as reached only on March 1st in common years', () => {
    expect(ageOn('2000-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(25);
    expect(ageOn('2000-02-29', new Date('2026-03-01T12:00:00Z'))).toBe(26);
  });

  it('adds calendar months in UTC', () => {
    expect(addMonthsUtc(today, 48).toISOString()).toBe('2030-10-21T12:00:00.000Z');
  });
});

describe('resolveScenario', () => {
  it('prefers the forced scenario over the draw', () => {
    expect(resolveScenario('ok', { failureRate: 1 }, () => 0)).toBe('ok');
  });

  it('draws error, then malformed, then ok', () => {
    const rates = { failureRate: 0.2, malformedRate: 0.1 };

    expect(resolveScenario(undefined, rates, () => 0.19)).toBe('error');
    expect(resolveScenario(undefined, rates, () => 0.2)).toBe('malformed');
    // Not 0.3: in floating point 0.2 + 0.1 === 0.30000000000000004, so 0.3 is still "malformed".
    expect(resolveScenario(undefined, rates, () => 0.31)).toBe('ok');
  });

  it('never draws timeout or invalid-shape', () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      expect(['error', 'malformed', 'ok']).toContain(
        resolveScenario(undefined, { failureRate: 0.3, malformedRate: 0.3 }, () => roll),
      );
    }
  });
});

describe('pickLatencyMs', () => {
  it('covers both ends of the range', () => {
    expect(pickLatencyMs({ minMs: 2000, maxMs: 6000 }, () => 0)).toBe(2000);
    expect(pickLatencyMs({ minMs: 2000, maxMs: 6000 }, () => 0.999_999_9)).toBe(6000);
  });
});

describe('abortableSleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void abortableSleep(1_000, new AbortController().signal).then(done);

    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it('rejects with the abort reason and clears the timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('shutting down');
    const sleeping = abortableSleep(30_000, controller.signal);

    controller.abort(reason);

    await expect(sleeping).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('closed'));

    await expect(abortableSleep(30_000, controller.signal)).rejects.toThrow('closed');
  });
});
