import { mod11CheckDigit } from './check-digit';
import { isRepeatedSequence, stripDocumentMask } from './format';

const CPF_PATTERN = /^\d{11}$/;
const DV1_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeCpf(value: string): string {
  return stripDocumentMask(value);
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (!CPF_PATTERN.test(cpf) || isRepeatedSequence(cpf)) return false;

  const digits = [...cpf].map(Number);
  const dv1 = mod11CheckDigit(digits.slice(0, 9), DV1_WEIGHTS);
  const dv2 = mod11CheckDigit([...digits.slice(0, 9), dv1], DV2_WEIGHTS);

  return dv1 === digits[9] && dv2 === digits[10];
}
