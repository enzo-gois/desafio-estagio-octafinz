import { describe, expect, it } from 'vitest';
import { priceInstallmentCents } from '../../runtime/loan-math';
import { counterOfferAmountCents } from './rules';

// Fixed values come from an independent binary search over 50-digit Decimal math:
// the largest principal whose rounded installment is still <= the margin.
describe('counterOfferAmountCents', () => {
  it.each([
    [24_500, 0.0159, 48, 818_255],
    [24_500, 0.0166, 48, 806_262],
    [2_994, 0.0159, 48, 100_008],
    [2_993, 0.0159, 48, 99_975],
  ])('margin %i at %f in %ix -> %i cents', (margin, rate, months, expected) => {
    expect(counterOfferAmountCents(margin, rate, months)).toBe(expected);
  });

  // Property: the result fits and one more cent would not. Holds for any correct answer,
  // independently of how it is computed.
  it.each([
    [0.0159, 12],
    [0.0159, 48],
    [0.0166, 96],
    [0.0205, 36],
  ])('is the largest principal that fits (rate %f, %ix)', (rate, months) => {
    for (let margin = 1_000; margin <= 60_000; margin += 997) {
      const amount = counterOfferAmountCents(margin, rate, months);

      expect(priceInstallmentCents(amount, rate, months)).toBeLessThanOrEqual(margin);
      expect(priceInstallmentCents(amount + 1, rate, months)).toBeGreaterThan(margin);
    }
  });
});
