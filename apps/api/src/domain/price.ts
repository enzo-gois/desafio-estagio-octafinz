import { assertCents, assertInstallments, assertRate } from './invariants';
import { MICRO_UNITS, toMicroUnits } from './numeric';

// Above this, raw × 1e6 would leave the safe integer range (~R$ 90 million per installment).
const MAX_RAW_INSTALLMENT_CENTS = Number.MAX_SAFE_INTEGER / MICRO_UNITS;

/**
 * Fixed installment under Tabela Price, in integer cents.
 *
 * PMT = PV × i / (1 − (1 + i)^−n), with `monthlyRate` as a decimal fraction
 * (0.0179 = 1.79% a.m.). With `monthlyRate === 0` the installment is PV / n.
 *
 * Rounding, in two steps:
 * 1. The raw double is rounded to 1e-6 cent, absorbing floating-point noise. Without it,
 *    1 cent at 50% in 1x gives 1.4999999999999998 instead of 1.5 and rounds to 1. As a
 *    consequence, values within 5e-7 cent of a tie are treated as the tie.
 * 2. That value is rounded to the nearest cent, ties away from zero (half-up).
 * The same 1e-6 granularity is used to compare rates (see offers.ts).
 *
 * The last installment is not adjusted: n × PMT may differ from the exact amount owed by up
 * to n × 0.5 cent.
 *
 * @throws RangeError for non-integer/negative cents, installments < 1 or a negative rate.
 */
export function priceInstallmentCents(
  principalCents: number,
  monthlyRate: number,
  installments: number,
): number {
  assertCents(principalCents, 'principalCents');
  assertRate(monthlyRate, 'monthlyRate');
  assertInstallments(installments);

  const raw =
    monthlyRate === 0
      ? principalCents / installments
      : (principalCents * monthlyRate) / (1 - (1 + monthlyRate) ** -installments);

  if (raw > MAX_RAW_INSTALLMENT_CENTS) {
    throw new RangeError(`installment too large to round safely (${raw} cents)`);
  }
  return Math.round(toMicroUnits(raw) / MICRO_UNITS);
}

export function totalPayableCents(installmentCents: number, installments: number): number {
  assertCents(installmentCents, 'installmentCents');
  assertInstallments(installments);
  return installmentCents * installments;
}
