import { describe, expect, it } from 'vitest';
import { mod11CheckDigit } from './check-digit';

describe('mod11CheckDigit', () => {
  it('returns 11 - remainder when the remainder is 2 or more', () => {
    expect(mod11CheckDigit([1], [2])).toBe(9); // 2 % 11 = 2
    expect(mod11CheckDigit([5], [2])).toBe(1); // 10 % 11 = 10
  });

  it('returns 0 when the remainder is 0 or 1', () => {
    expect(mod11CheckDigit([0], [2])).toBe(0); // remainder 0, sum 0
    expect(mod11CheckDigit([11], [1])).toBe(0); // remainder 0, sum 11
    expect(mod11CheckDigit([1], [1])).toBe(0); // remainder 1
  });

  it('multiplies each value by the weight at the same position', () => {
    expect(mod11CheckDigit([1, 2], [2, 3])).toBe(3); // 2 + 6 = 8
    expect(mod11CheckDigit([2, 1], [2, 3])).toBe(4); // 4 + 3 = 7
  });

  it('lança erro quando valores e pesos têm tamanhos diferentes', () => {
    expect(() => mod11CheckDigit([1, 2, 3], [5, 4])).toThrow();
  });
});
