import { MAX_AMOUNT_CENTS } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { formatCents, formatMonthlyRate } from './format';

// Intl separates "R$" from the number with a no-break space, not a regular one: a test written
// as 'R$ 1.234,56' with the space bar fails. Spelled out so the difference is visible.
const NBSP = ' ';

describe('formatCents', () => {
  it.each([
    [123_456, `R$${NBSP}1.234,56`],
    [5, `R$${NBSP}0,05`],
    [50, `R$${NBSP}0,50`],
    [0, `R$${NBSP}0,00`],
    [100, `R$${NBSP}1,00`],
    [MAX_AMOUNT_CENTS, `R$${NBSP}1.000.000,00`],
    [-123_456, `-R$${NBSP}1.234,56`],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it('puts a no-break space (U+00A0) after "R$"', () => {
    expect(formatCents(100).charAt(2)).toBe(' ');
  });

  it('stays exact where dividing by 100 as a float would not', () => {
    // 9007199254740899 / 100 is not representable: Intl would show ",98".
    expect(formatCents(9_007_199_254_740_899)).toBe(`R$${NBSP}90.071.992.547.408,99`);
  });

  it.each([12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (cents) => {
    expect(() => formatCents(cents)).toThrow(RangeError);
  });
});

describe('formatMonthlyRate', () => {
  it.each([
    [0.0189, '1,89% a.m.'],
    [0.02, '2,00% a.m.'],
    [0.0159, '1,59% a.m.'],
  ])('formats %f as %s', (rate, expected) => {
    expect(formatMonthlyRate(rate)).toBe(expected);
  });

  it('rounds to two decimal places', () => {
    expect(formatMonthlyRate(0.123456)).toBe('12,35% a.m.');
  });

  it('rejects a non-finite rate', () => {
    expect(() => formatMonthlyRate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
