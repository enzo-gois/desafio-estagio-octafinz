import { ageOn } from '../../runtime/age';
import { consignableMarginCents, priceInstallmentCents } from '../../runtime/loan-math';
import type { BetaEmploymentType, BetaReasonCode } from './contract';

// Fictitious policy: public agreements only (no CLT), counter-offer when the margin is short.
export const BETA_MONTHLY_RATES = {
  public_servant: 0.0159,
  inss_retiree: 0.0166,
} as const;
const MIN_AGE = 18;
const MAX_AGE = 80;
const MARGIN_PERCENT = 35;
export const BETA_MIN_COUNTER_OFFER_CENTS = 100_000;

export interface BetaApplication {
  employmentType?: BetaEmploymentType;
  birthDate: string;
  netSalaryCents: number;
  requestedAmountCents: number;
  termMonths: number;
}

export type BetaDecision =
  | {
      outcome: 'APPROVED' | 'PARTIALLY_APPROVED';
      amountCents: number;
      installmentCents: number;
      monthlyRate: number;
    }
  | { outcome: 'REJECTED'; reasonCode: BetaReasonCode };

/**
 * Counter-offer: the largest principal, in whole cents, whose installment as computed by
 * `priceInstallmentCents` (i.e. already rounded to the cent) is still <= `marginCents`.
 *
 * Inverse Price: PV = PMT * (1 - (1 + i)^-n) / i
 */
export function counterOfferAmountCents(
  marginCents: number,
  monthlyRate: number,
  installments: number,
): number {
  const factor = (1 - (1 + monthlyRate) ** -installments) / monthlyRate;
  let amountCents = Math.floor(marginCents * factor);

  while (priceInstallmentCents(amountCents + 1, monthlyRate, installments) <= marginCents) {
    amountCents += 1;
  }
  while (priceInstallmentCents(amountCents, monthlyRate, installments) > marginCents) {
    amountCents -= 1;
  }

  return amountCents;
}

export function evaluateBeta(application: BetaApplication, today: Date): BetaDecision {
  const { employmentType } = application;
  if (employmentType === undefined || employmentType === 'clt') {
    return { outcome: 'REJECTED', reasonCode: 'R03' };
  }

  const age = ageOn(application.birthDate, today);
  if (age < MIN_AGE || age > MAX_AGE) return { outcome: 'REJECTED', reasonCode: 'R02' };

  const monthlyRate = BETA_MONTHLY_RATES[employmentType];
  const marginCents = consignableMarginCents(application.netSalaryCents, MARGIN_PERCENT);
  const installmentCents = priceInstallmentCents(
    application.requestedAmountCents,
    monthlyRate,
    application.termMonths,
  );
  if (installmentCents <= marginCents) {
    return {
      outcome: 'APPROVED',
      amountCents: application.requestedAmountCents,
      installmentCents,
      monthlyRate,
    };
  }

  const amountCents = counterOfferAmountCents(marginCents, monthlyRate, application.termMonths);
  if (amountCents < BETA_MIN_COUNTER_OFFER_CENTS) return { outcome: 'REJECTED', reasonCode: 'R01' };

  return {
    outcome: 'PARTIALLY_APPROVED',
    amountCents,
    installmentCents: priceInstallmentCents(amountCents, monthlyRate, application.termMonths),
    monthlyRate,
  };
}
