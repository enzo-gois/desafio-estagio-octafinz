import { MAX_AMOUNT_CENTS, normalizeCnpj } from '@simulador/shared';

const CPF_PATTERN = '###.###.###-##';
const CPF_LENGTH = 11;
const CNPJ_PATTERN = '##.###.###/####-##';
const CNPJ_LENGTH = 14;
// Alphanumeric positions (root + branch); the two check digits after them are numeric.
const CNPJ_ALPHANUMERIC_LENGTH = 12;

/**
 * Digits a money field keeps: one more than the cap has. Any amount above the cap can be entered
 * and gets the shared schema's message instead of being blocked. A longer value cut to this
 * length still starts with a nonzero digit, so it stays above the cap: cutting never turns an
 * invalid amount into a valid one. Derived from the cap, so it follows if the cap changes.
 */
export const MONEY_MAX_DIGITS = String(MAX_AMOUNT_CENTS).length + 1;

// Places `chars` into the pattern's "#" slots. A separator is written only when a character
// follows it ("5299" -> "529.9", never "529."): otherwise backspace over a separator would be
// undone by the mask putting it right back.
function fillPattern(chars: string, pattern: string): string {
  let result = '';
  let next = 0;
  for (const slot of pattern) {
    if (next === chars.length) break;
    result += slot === '#' ? chars.charAt(next++) : slot;
  }
  return result;
}

/** CPF as typed or pasted -> "529.982.247-25", progressively. Keeps the first 11 digits. */
export function maskCpfInput(value: string): string {
  return fillPattern(value.replace(/[^0-9]/g, '').slice(0, CPF_LENGTH), CPF_PATTERN);
}

/**
 * Alphanumeric CNPJ as typed or pasted -> "12.ABC.345/01DE-35", with the shared validator's rule:
 * letters or digits in the first 12 positions, digits only in the 2 check digits. A character that
 * does not fit its position is dropped, a change the customer sees in the field. Letters go
 * through the shared normalizeCnpj, which uppercases ASCII only ("ß" is dropped, never "SS").
 */
export function maskCnpjInput(value: string): string {
  let chars = '';
  for (const char of value) {
    if (chars.length === CNPJ_LENGTH) break;
    const allowed = chars.length < CNPJ_ALPHANUMERIC_LENGTH ? /^[0-9A-Za-z]$/ : /^[0-9]$/;
    if (allowed.test(char)) chars += char;
  }
  return fillPattern(normalizeCnpj(chars), CNPJ_PATTERN);
}

/**
 * Money field text -> integer cents, reading its digits as an integer ("R$ 1.234,56" -> 123456),
 * never as a decimal number. undefined when there is no digit at all. Leading zeros are dropped
 * before the MONEY_MAX_DIGITS cut, so they never push real digits out. Amounts above
 * MAX_AMOUNT_CENTS are kept as they are: the shared schema reports them like any other error.
 */
export function parseMoneyInput(value: string): number | undefined {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits === '') return undefined;

  const significant = digits.replace(/^0+/, '').slice(0, MONEY_MAX_DIGITS);
  return significant === '' ? 0 : Number(significant);
}
