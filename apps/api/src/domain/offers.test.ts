import type { ApprovedBankResult, BankResult } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import {
  compareOffers,
  isCounterOffer,
  type RankedOffer,
  rankOffers,
  selectBestOffer,
} from './offers';

// Installments are real Price values computed independently with Decimal (48x):
// 10.000 @1.79% = 312,24 | 8.000 @1.79% = 249,80 | 7.000 @1.79% = 218,57
// 8.182,55 @1.59% = 245,00 | 10.000 @2.05% = 329,34 | 5.000 @2.05% = 164,67
const REQUESTED = 1_000_000;

function approved(
  bankId: string,
  amountCents: number,
  monthlyRate: number,
  installmentCents: number,
): ApprovedBankResult {
  return {
    bankId,
    status: 'APPROVED',
    offer: { amountCents, installments: 48, monthlyRate, installmentCents },
  };
}

const alfaFull = approved('alfa', 1_000_000, 0.0179, 31_224);
const betaCounter = approved('beta', 818_255, 0.0159, 24_500);
const gamaFull = approved('gama', 1_000_000, 0.0205, 32_934);
const gamaCounter = approved('gama', 500_000, 0.0205, 16_467);

const bestBankId = (results: BankResult[]) => selectBestOffer(results, REQUESTED)?.bankId;

describe('isCounterOffer', () => {
  it('is true only when the bank approved less than requested', () => {
    expect(isCounterOffer(betaCounter.offer, REQUESTED)).toBe(true);
    expect(isCounterOffer(alfaFull.offer, REQUESTED)).toBe(false);
    expect(isCounterOffer({ ...alfaFull.offer, amountCents: 1_100_000 }, REQUESTED)).toBe(false);
  });
});

describe('selectBestOffer (decision B1)', () => {
  it('picks the lowest monthly rate, even when it is a counter-offer', () => {
    const best = selectBestOffer([alfaFull, betaCounter, gamaFull], REQUESTED);

    expect(best).toEqual({
      bankId: 'beta',
      offer: betaCounter.offer,
      isCounterOffer: true,
      totalPayableCents: 1_176_000, // 245,00 × 48
    });
  });

  it('does not pick the lowest installment when it comes from a higher rate', () => {
    // Gama's counter-offer has the smallest installment only because it lends half the money.
    expect(bestBankId([gamaCounter, alfaFull])).toBe('alfa');
  });

  it('on equal rates, prefers the full amount over a counter-offer', () => {
    const counter = approved('banco-a', 800_000, 0.0179, 24_980);
    const full = approved('banco-z', 1_000_000, 0.0179, 31_224);

    expect(bestBankId([counter, full])).toBe('banco-z');
  });

  it('on equal rates between counter-offers, prefers the larger amount', () => {
    const smaller = approved('banco-a', 700_000, 0.0179, 21_857);
    const larger = approved('banco-z', 800_000, 0.0179, 24_980);

    expect(bestBankId([smaller, larger])).toBe('banco-z');
  });

  it('on a full tie, falls back to bankId so arrival order does not matter', () => {
    const z = approved('banco-z', 1_000_000, 0.0179, 31_224);
    const a = approved('banco-a', 1_000_000, 0.0179, 31_224);

    expect(bestBankId([z, a])).toBe('banco-a');
    expect(bestBankId([a, z])).toBe('banco-a');
  });

  it('treats rates that differ only by floating-point noise as equal', () => {
    // A rate parsed as "2.05" / 100 is 0.020499999999999997, not 0.0205.
    const parsed = approved('banco-z', 1_000_000, 2.05 / 100, 32_934);
    const literal = approved('banco-a', 1_000_000, 0.0205, 32_934);
    expect(parsed.offer.monthlyRate).not.toBe(literal.offer.monthlyRate);

    expect(bestBankId([parsed, literal])).toBe('banco-a');
    expect(bestBankId([literal, parsed])).toBe('banco-a');
  });

  it('ignores results that are not APPROVED', () => {
    const results: BankResult[] = [
      { bankId: 'alfa', status: 'DENIED', reason: 'Margem insuficiente' },
      { bankId: 'beta', status: 'ERROR' },
      gamaFull,
      { bankId: 'delta', status: 'PENDING' },
    ];

    expect(bestBankId(results)).toBe('gama');
  });

  it('returns undefined when no bank approved', () => {
    expect(selectBestOffer([{ bankId: 'alfa', status: 'UNAVAILABLE' }], REQUESTED)).toBeUndefined();
  });
});

describe('rankOffers', () => {
  it('orders every approved offer from best to worst', () => {
    const ranked = rankOffers([gamaFull, alfaFull, betaCounter], REQUESTED);

    expect(ranked.map((offer) => offer.bankId)).toEqual(['beta', 'alfa', 'gama']);
  });
});

describe('compareOffers', () => {
  const ranked = (result: ApprovedBankResult): RankedOffer => ({
    bankId: result.bankId,
    offer: result.offer,
    isCounterOffer: isCounterOffer(result.offer, REQUESTED),
    totalPayableCents: result.offer.installmentCents * result.offer.installments,
  });
  const beta = ranked(betaCounter);
  const alfa = ranked(alfaFull);

  it('is negative when the first offer is better and positive when it is worse', () => {
    expect(compareOffers(beta, alfa)).toBeLessThan(0);
    expect(compareOffers(alfa, beta)).toBeGreaterThan(0);
  });

  it('is zero for the same offer', () => {
    expect(compareOffers(alfa, alfa)).toBe(0);
  });
});
