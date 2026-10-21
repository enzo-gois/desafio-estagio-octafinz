// Each fictitious bank does its own math; this is deliberately NOT the API's domain code.

// Tabela Price: PMT = PV * i / (1 - (1 + i)^-n), rounded to the nearest cent.
export function priceInstallmentCents(
  principalCents: number,
  monthlyRate: number,
  installments: number,
): number {
  return Math.round((principalCents * monthlyRate) / (1 - (1 + monthlyRate) ** -installments));
}

// Integer math so the margin is always whole cents (rounded down, in the bank's favor).
export function consignableMarginCents(netIncomeCents: number, percent: number): number {
  return Math.floor((netIncomeCents * percent) / 100);
}
