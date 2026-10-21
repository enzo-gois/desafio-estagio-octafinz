import { describe, expect, it } from 'vitest';
import { isValidCnpj, normalizeCnpj } from './cnpj';

describe('normalizeCnpj', () => {
  it('strips only ".", "/", "-" and spaces and uppercases ASCII letters', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(normalizeCnpj('11 222 333 0001 81')).toBe('11222333000181');
  });

  it('keeps any other character so validation can reject it', () => {
    expect(normalizeCnpj('11.222.333/0001-81@')).toBe('11222333000181@');
  });
});

describe('isValidCnpj', () => {
  it.each([
    ['legacy numeric, masked', '11.222.333/0001-81'],
    ['legacy numeric, unmasked', '11222333000181'],
    ['alphanumeric, official example', '12.ABC.345/01DE-35'],
    ['alphanumeric, unmasked', '12ABC34501DE35'],
    ['alphanumeric, lowercase', '12.abc.345/01de-35'],
    ['alphanumeric with S (value 35)', '12ABC345SS0110'],
    ['both check digits equal to 0', 'AB.000.000/0018-00'],
  ])('accepts a valid CNPJ (%s)', (_, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it.each([
    ['trailing "@" is not stripped', '11.222.333/0001-81@'],
    // "@" is ASCII 64 -> value 16; the check digits 03 match, only the charset rule rejects it.
    ['character outside [0-9A-Z] even with matching check digits', '12ABC345@1DE03'],
    // "ß".toUpperCase() is "SS"; it must not turn into the valid 12ABC345SS0110.
    ['non-ASCII letter', '12ABC345ß0110'],
    ['letter in a check digit position', '12ABC34501DE3A'],
    ['wrong first check digit', '12ABC34501DE45'],
    ['wrong second check digit', '11222333000182'],
    ['all zeros (passes the math)', '00.000.000/0000-00'],
    ['too short', '1122233300018'],
    ['too long', '112223330001810'],
    ['empty', ''],
  ])('rejects an invalid CNPJ (%s)', (_, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(false);
  });
});
