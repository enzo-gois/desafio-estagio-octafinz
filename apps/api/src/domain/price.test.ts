import { describe, expect, it } from 'vitest';
import { PRICE_CASES } from './fixtures/price-cases';
import { priceInstallmentCents, totalPayableCents } from './price';

describe('priceInstallmentCents', () => {
  it.each(PRICE_CASES)(
    '%i cents at %f in %ix -> %i cents (independent Decimal value)',
    (principal, rate, installments, expected) => {
      expect(priceInstallmentCents(principal, rate, installments)).toBe(expected);
    },
  );

  it('matches the values already used by the mock banks (also checked with Decimal)', () => {
    expect(priceInstallmentCents(1_000_000, 0.0179, 48)).toBe(31_224);
    expect(priceInstallmentCents(850_000, 0.0159, 48)).toBe(25_451);
    expect(priceInstallmentCents(1_000_000, 0.0205, 48)).toBe(32_934);
  });

  it('rounds an exact half cent up even when the double lands just below it', () => {
    // 1 × 0.5 / (1 − 1.5⁻¹) is exactly 1.5, but evaluates to 1.4999999999999998 in double.
    expect(priceInstallmentCents(1, 0.5, 1)).toBe(2);
  });

  it('with a single installment, charges principal plus one month of interest', () => {
    expect(priceInstallmentCents(100_000, 0.01, 1)).toBe(101_000);
  });

  it('with a zero rate, splits the principal and rounds half-up', () => {
    expect(priceInstallmentCents(1_000, 0, 3)).toBe(333);
    expect(priceInstallmentCents(1_001, 0, 2)).toBe(501); // 500.5
  });

  it('grows with the principal and with the rate', () => {
    expect(priceInstallmentCents(1_000_001, 0.0179, 48)).toBeGreaterThanOrEqual(
      priceInstallmentCents(1_000_000, 0.0179, 48),
    );
    expect(priceInstallmentCents(1_000_000, 0.018, 48)).toBeGreaterThan(
      priceInstallmentCents(1_000_000, 0.0179, 48),
    );
  });

  it.each([
    ['fractional cents', 1000.5, 0.01, 12],
    ['negative cents', -1, 0.01, 12],
    ['zero installments', 1000, 0.01, 0],
    ['fractional installments', 1000, 0.01, 1.5],
    ['a negative rate', 1000, -0.01, 12],
    ['a NaN rate', 1000, Number.NaN, 12],
  ])('throws RangeError for %s', (_, principal, rate, installments) => {
    expect(() => priceInstallmentCents(principal, rate, installments)).toThrow(RangeError);
  });

  it('throws instead of rounding an installment too large for safe integers', () => {
    expect(() => priceInstallmentCents(Number.MAX_SAFE_INTEGER, 0.01, 1)).toThrow(RangeError);
  });
});

describe('totalPayableCents', () => {
  it('multiplies the rounded installment by the number of installments', () => {
    expect(totalPayableCents(31_224, 48)).toBe(1_498_752);
  });

  it('rejects fractional cents', () => {
    expect(() => totalPayableCents(312.24, 48)).toThrow(RangeError);
  });
});
