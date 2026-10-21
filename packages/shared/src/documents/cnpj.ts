import { mod11CheckDigit } from './check-digit';
import { isRepeatedSequence, stripDocumentMask } from './format';

// 12 alphanumeric positions (root + branch) followed by 2 numeric check digits.
// Numeric-only CNPJs match this too, so the legacy format needs no separate path.
const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/;
const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

// Receita Federal rule: value = ASCII code - 48 ('0'..'9' -> 0..9, 'A'..'Z' -> 17..42).
const charValue = (char: string): number => char.charCodeAt(0) - 48;

// Uppercases ASCII letters only. String#toUpperCase would turn "ß" into "SS" and
// the dotless "ı" into "I", silently producing a valid-looking CNPJ.
const toAsciiUpperCase = (value: string): string =>
  value.replace(/[a-z]/g, (letter) => letter.toUpperCase());

export function normalizeCnpj(value: string): string {
  return toAsciiUpperCase(stripDocumentMask(value));
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_PATTERN.test(cnpj) || isRepeatedSequence(cnpj)) return false;

  const values = [...cnpj].map(charValue);
  const dv1 = mod11CheckDigit(values.slice(0, 12), DV1_WEIGHTS);
  const dv2 = mod11CheckDigit([...values.slice(0, 12), dv1], DV2_WEIGHTS);

  return dv1 === values[12] && dv2 === values[13];
}
