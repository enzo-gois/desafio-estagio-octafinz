import { describe, expect, it } from 'vitest';
import { isValidCpf, maskCpf, normalizeCpf } from './cpf';

describe('maskCpf', () => {
  it('keeps only the six middle digits', () => {
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**');
  });

  it('refuses anything that is not 11 digits', () => {
    expect(() => maskCpf('5299822472')).toThrow(RangeError);
  });
});

describe('normalizeCpf', () => {
  it('strips only ".", "-" and spaces', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf(' 529 982 247 25 ')).toBe('52998224725');
  });

  it('keeps any other character so validation can reject it', () => {
    expect(normalizeCpf('529.982.247-25@')).toBe('52998224725@');
  });
});

describe('isValidCpf', () => {
  it.each([
    ['masked', '529.982.247-25'],
    ['unmasked', '52998224725'],
    ['with spaces', '529 982 247 25'],
    ['both check digits equal to 0', '100.000.037-00'],
  ])('accepts a valid CPF (%s)', (_, cpf) => {
    expect(isValidCpf(cpf)).toBe(true);
  });

  it.each([
    ['wrong first check digit', '529.982.247-35'],
    ['wrong second check digit', '529.982.247-26'],
    ['repeated digits that pass the math', '111.111.111-11'],
    ['all zeros', '000.000.000-00'],
    ['too short', '5299822472'],
    ['too long', '529982247250'],
    ['letter', '5299822472A'],
    ['unexpected character', '529.982.247-25@'],
    ['tab is not a mask character', '529982247\t25'],
    ['empty', ''],
  ])('rejects an invalid CPF (%s)', (_, cpf) => {
    expect(isValidCpf(cpf)).toBe(false);
  });
});
