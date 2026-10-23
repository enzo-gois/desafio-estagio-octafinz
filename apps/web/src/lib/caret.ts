import { formatCents } from './format';
import { parseMoneyInput } from './masks';

export interface MaskedEdit {
  value: string;
  caret: number;
}

const isAlphanumeric = (char: string) => /^[0-9A-Za-z]$/.test(char);
const isDigit = (char: string) => /^[0-9]$/.test(char);
const count = (text: string, counts: (char: string) => boolean) => [...text].filter(counts).length;

// Index right after the `n`-th counted character of `value` (0 before the first one).
function positionAfter(value: string, n: number, counts: (char: string) => boolean): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index++) {
    if (counts(value.charAt(index)) && ++seen === n) return index + 1;
  }
  return value.length;
}

/**
 * Re-masks a field read left to right (CPF, CNPJ) and keeps the caret after the same characters
 * it followed. Without this, every keystroke that adds a separator would throw the caret to the
 * end, and editing the middle of a CPF would be impossible.
 */
export function remask(mask: (value: string) => string, raw: string, caret: number): MaskedEdit {
  const value = mask(raw);
  // What was before the caret, masked the same way: dropped characters do not count.
  const before = count(mask(raw.slice(0, caret)), isAlphanumeric);
  return { value, caret: positionAfter(value, before, isAlphanumeric) };
}

/**
 * Money is read right to left (digits are cents first), so the caret keeps the same number of
 * digits after it: typing at the end stays at the end, an edit in the middle stays in place.
 */
export function remaskMoney(
  raw: string,
  caret: number,
): MaskedEdit & { cents: number | undefined } {
  const cents = parseMoneyInput(raw);
  const value = cents === undefined ? '' : formatCents(cents);
  const digitsAfter = count(raw.slice(caret), isDigit);
  return {
    cents,
    value,
    caret: positionAfter(value, count(value, isDigit) - digitsAfter, isDigit),
  };
}
