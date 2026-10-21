/**
 * Modulo 11 check digit shared by CPF and CNPJ.
 */
export function mod11CheckDigit(values: readonly number[], weights: readonly number[]): number {
  if (values.length !== weights.length) {
    throw new Error(`mod11: ${values.length} valores para ${weights.length} pesos`);
  }

  const sum = values.reduce((acc, current, index) => acc + current * (weights[index] ?? 0), 0);

  const remainder = sum % 11;
  const checkDigit = 11 - remainder;

  return checkDigit >= 10 ? 0 : checkDigit;
}
