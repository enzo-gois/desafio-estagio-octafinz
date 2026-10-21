import { ageOn } from '../../runtime/age';
import { consignableMarginCents, priceInstallmentCents } from '../../runtime/loan-math';
import type { AlfaRejectionReason, AlfaRequest } from './contract';

// Fictitious conservative policy. employmentType is accepted but not used by Alfa.
export const ALFA_MONTHLY_RATE = 0.0179;
const MIN_AGE = 21;
const MAX_AGE = 75;
const MAX_INSTALLMENTS = 84;
const MARGIN_PERCENT = 30;

export type AlfaDecision =
  { approved: true; installmentCents: number } | { approved: false; reason: AlfaRejectionReason };

export function evaluateAlfa(request: AlfaRequest, today: Date): AlfaDecision {
  const age = ageOn(request.customer.birthDate, today);
  if (age < MIN_AGE || age > MAX_AGE) return { approved: false, reason: 'AGE_OUT_OF_RANGE' };

  if (request.installments > MAX_INSTALLMENTS)
    return { approved: false, reason: 'TERM_NOT_ALLOWED' };

  const installmentCents = priceInstallmentCents(
    request.requestedAmountCents,
    ALFA_MONTHLY_RATE,
    request.installments,
  );
  const marginCents = consignableMarginCents(
    request.customer.monthlyNetIncomeCents,
    MARGIN_PERCENT,
  );
  if (installmentCents > marginCents) return { approved: false, reason: 'INSUFFICIENT_MARGIN' };

  return { approved: true, installmentCents };
}
