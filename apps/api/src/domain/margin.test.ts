import { describe, expect, it } from 'vitest';
import { assessMargin, consignableMarginCents, type MarginPolicy } from './margin';

// Installment for R$ 10.000 at the 1.8% reference rate in 48x: 31,289 cents (Decimal).
const policy: MarginPolicy = { percent: 35, referenceMonthlyRate: 0.018 };
const request = { requestedAmountCents: 1_000_000, installments: 48 };

describe('consignableMarginCents', () => {
  it('rounds down to whole cents', () => {
    expect(consignableMarginCents(104_079, 30)).toBe(31_223); // 31,223.7
    expect(consignableMarginCents(104_080, 30)).toBe(31_224);
  });

  it.each([
    ['a fractional percent', 32.5],
    ['a percent above 100', 101],
    ['a negative percent', -1],
  ])('throws RangeError for %s', (_, percent) => {
    expect(() => consignableMarginCents(500_000, percent)).toThrow(RangeError);
  });
});

describe('assessMargin', () => {
  it('estimates the installment with the reference rate and compares it to the margin', () => {
    expect(assessMargin({ ...request, netSalaryCents: 500_000 }, policy)).toEqual({
      marginCents: 175_000,
      estimatedInstallmentCents: 31_289,
      fitsMargin: true,
      commitmentBps: 1_788, // 17.88% of the margin, rounded up
    });
  });

  it('fits when the margin equals the estimated installment', () => {
    const assessment = assessMargin({ ...request, netSalaryCents: 89_398 }, policy);

    expect(assessment).toMatchObject({
      marginCents: 31_289,
      fitsMargin: true,
      commitmentBps: 10_000,
    });
  });

  it('does not fit one cent below, and never shows that as 100%', () => {
    const assessment = assessMargin({ ...request, netSalaryCents: 89_397 }, policy);

    expect(assessment).toMatchObject({
      marginCents: 31_288,
      fitsMargin: false,
      commitmentBps: 10_001,
    });
  });

  it('reports a null commitment when the margin is zero', () => {
    const assessment = assessMargin({ ...request, netSalaryCents: 2 }, policy);

    expect(assessment).toMatchObject({ marginCents: 0, fitsMargin: false, commitmentBps: null });
  });
});
