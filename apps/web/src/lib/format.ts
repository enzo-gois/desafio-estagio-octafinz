const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PERCENT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 123456 -> "R$ 1.234,56". The value never passes through a float: reais and centavos come from
 * BigInt (integer) division, and Intl formats the resulting decimal string exactly. Intl writes a
 * no-break space (U+00A0) after "R$".
 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('formatCents expects integer cents');

  const value = BigInt(cents);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const centavos = String(abs % 100n).padStart(2, '0');
  // A decimal literal by construction; TypeScript only sees a string built from parts.
  const decimal = `${sign}${abs / 100n}.${centavos}` as Intl.StringNumericLiteral;
  return BRL.format(decimal);
}

/** 0.0189 -> "1,89% a.m.". A rate, not money: the float from the API is fine here. */
export function formatMonthlyRate(monthlyRate: number): string {
  if (!Number.isFinite(monthlyRate)) throw new RangeError('formatMonthlyRate expects a number');
  return `${PERCENT.format(monthlyRate)} a.m.`;
}
