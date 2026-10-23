import { isValidCnpj, isValidCpf, MAX_AMOUNT_CENTS, normalizeCnpj } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { formatCents } from './format';
import { maskCnpjInput, maskCpfInput, MONEY_MAX_DIGITS, parseMoneyInput } from './masks';

/** Feeds `keys` one at a time, the way a masked input re-masks its own value on every keystroke. */
function type(mask: (value: string) => string, keys: string): string[] {
  const steps: string[] = [];
  let field = '';
  for (const key of keys) {
    field = mask(field + key);
    steps.push(field);
  }
  return steps;
}

// Deterministic PRNG (mulberry32): the properties below run on many generated inputs, and a
// failure reproduces with the same seed.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('maskCpfInput', () => {
  it('formats progressively while typing, never ending in a separator', () => {
    expect(type(maskCpfInput, '52998224725')).toEqual([
      '5',
      '52',
      '529',
      '529.9',
      '529.98',
      '529.982',
      '529.982.2',
      '529.982.24',
      '529.982.247',
      '529.982.247-2',
      '529.982.247-25',
    ]);
  });

  it('lets backspace remove a separator', () => {
    // "529.9" minus its last digit is "529.": the mask must not put the dot back.
    expect(maskCpfInput('529.')).toBe('529');
  });

  it.each([
    ['a masked CPF', '529.982.247-25', '529.982.247-25'],
    ['more than 11 digits', '529.982.247-251', '529.982.247-25'],
    ['letters and symbols', 'cpf: 529x982', '529.982'],
  ])('handles %s', (_, input, expected) => {
    expect(maskCpfInput(input)).toBe(expected);
  });

  it('produces what the shared validator accepts', () => {
    expect(isValidCpf(maskCpfInput('52998224725'))).toBe(true);
  });
});

describe('maskCnpjInput', () => {
  it('uppercases letters typed in lowercase, at every keystroke', () => {
    const steps = type(maskCnpjInput, '12abc34501de35');

    expect(steps.at(-1)).toBe('12.ABC.345/01DE-35');
    for (const step of steps) expect(step).toBe(step.toUpperCase());
  });

  it.each([
    ['a masked CNPJ', '12.ABC.345/01DE-35', '12.ABC.345/01DE-35'],
    ['a masked CNPJ in lowercase', '12.abc.345/01de-35', '12.ABC.345/01DE-35'],
    ['an unmasked CNPJ', '12ABC34501DE35', '12.ABC.345/01DE-35'],
    ['a numeric CNPJ (legacy format)', '11.222.333/0001-81', '11.222.333/0001-81'],
  ])('accepts %s pasted', (_, input, expected) => {
    expect(maskCnpjInput(input)).toBe(expected);
  });

  it.each([
    ['letters in the check digits', '12ABC34501DEXY', '12.ABC.345/01DE'],
    ['a letter between the check digits', '12ABC34501DE3X5', '12.ABC.345/01DE-35'],
    [
      'non-ASCII letters (shared rule: never "ß" -> "SS")',
      '12ßABC345ı01DE35',
      '12.ABC.345/01DE-35',
    ],
    ['symbols', '12@ABC#34501DE35', '12.ABC.345/01DE-35'],
    ['more than 14 characters', '12ABC34501DE35999', '12.ABC.345/01DE-35'],
  ])('drops %s', (_, input, expected) => {
    expect(maskCnpjInput(input)).toBe(expected);
  });

  it('produces what the shared validator accepts and normalizes', () => {
    const masked = maskCnpjInput('12abc34501de35');

    expect(isValidCnpj(masked)).toBe(true);
    expect(normalizeCnpj(masked)).toBe('12ABC34501DE35');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['nothing', ''],
    ['no digits', 'R$ '],
  ])('returns undefined for %s', (_, input) => {
    expect(parseMoneyInput(input)).toBeUndefined();
  });

  it.each([
    ['digits', '123456', 123_456],
    ['the formatted value', 'R$ 1.234,56', 123_456],
    ['a digit typed after the formatted value', 'R$ 1.234,567', 1_234_567],
    ['the formatted value after a backspace', 'R$ 1.234,5', 12_345],
    ['zero', 'R$ 0,00', 0],
    ['a digit typed after zero', 'R$ 0,005', 5],
  ])('reads %s as integer cents', (_, input, cents) => {
    expect(parseMoneyInput(input)).toBe(cents);
  });

  it('drops leading zeros before the digit limit', () => {
    const cents = parseMoneyInput('000000000012345');

    expect(cents).toBe(12_345);
    expect(formatCents(cents ?? 0)).toBe('R$ 123,45');
  });

  it('keeps amounts above the cap, for the shared schema to report', () => {
    expect(parseMoneyInput(String(MAX_AMOUNT_CENTS + 1))).toBe(MAX_AMOUNT_CENTS + 1);
  });

  it('keeps one digit more than the cap has', () => {
    expect(MONEY_MAX_DIGITS).toBe(String(MAX_AMOUNT_CENTS).length + 1);
    expect(parseMoneyInput('1'.repeat(MONEY_MAX_DIGITS + 3))).toBe(
      Number('1'.repeat(MONEY_MAX_DIGITS)),
    );
  });

  it('cuts the smallest over-long amount to a value still above the cap', () => {
    // The worst case of the property below: "1" and zeros cut to MONEY_MAX_DIGITS is the lowest
    // value a cut can produce. Random inputs almost never hit it, so it is checked on its own.
    const smallest = `1${'0'.repeat(MONEY_MAX_DIGITS)}`;

    expect(parseMoneyInput(smallest)).toBeGreaterThan(MAX_AMOUNT_CENTS);
  });

  it('property: more digits than the limit always lands above the cap', () => {
    const next = random(20261023);
    const digit = (from: number) => String(from + Math.floor(next() * (10 - from)));
    const noise = () => ['', '', '.', ',', ' ', 'R$ '][Math.floor(next() * 6)];

    for (let run = 0; run < 1_000; run++) {
      const leadingZeros = '0'.repeat(Math.floor(next() * 6));
      const extra = 1 + Math.floor(next() * 8);
      let input = `${leadingZeros}${digit(1)}`;
      for (let i = 1; i < MONEY_MAX_DIGITS + extra; i++) input += `${noise()}${digit(0)}`;

      const cents = parseMoneyInput(input);
      expect(cents, input).toBeGreaterThan(MAX_AMOUNT_CENTS);
      expect(Number.isSafeInteger(cents), input).toBe(true);
    }
  });

  it('property: reading back the formatted value gives the same cents', () => {
    // The field shows formatCents(cents) and parses that text again on the next keystroke.
    const next = random(42);
    const limit = 10 ** MONEY_MAX_DIGITS;

    for (let run = 0; run < 1_000; run++) {
      const cents = Math.floor(next() * limit);
      expect(parseMoneyInput(formatCents(cents))).toBe(cents);
    }
  });
});
