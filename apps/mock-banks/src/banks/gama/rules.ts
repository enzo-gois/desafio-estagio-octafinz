import { addMonthsUtc, ageOn } from '../../runtime/age';
import { consignableMarginCents, priceInstallmentCents } from '../../runtime/loan-math';
import type { GamaDeclineReason } from './contract';

// Fictitious policy: restricted employers, age at the end of the contract, rate by term.
const SHORT_TERM_MAX_MONTHS = 36;
export const GAMA_SHORT_TERM_RATE = 0.0189;
export const GAMA_LONG_TERM_RATE = 0.0205;
const MAX_AGE_AT_MATURITY = 80;
const MARGIN_PERCENT = 35;

export interface GamaApplication {
  birthDate: string;
  employerCnpj: string;
  netIncomeCents: number;
  amountCents: number;
  termMonths: number;
}

export type GamaDecision =
  | { accepted: true; installmentCents: number; monthlyRate: number }
  | { accepted: false; reasons: GamaDeclineReason[] };

export function gamaMonthlyRate(termMonths: number): number {
  return termMonths <= SHORT_TERM_MAX_MONTHS ? GAMA_SHORT_TERM_RATE : GAMA_LONG_TERM_RATE;
}

// Unlike Alfa and Beta, Gama evaluates every rule and reports all failures.
export function evaluateGama(
  application: GamaApplication,
  today: Date,
  restrictedCnpjs: ReadonlySet<string>,
): GamaDecision {
  const reasons: GamaDeclineReason[] = [];

  if (restrictedCnpjs.has(application.employerCnpj)) reasons.push('EMPLOYER_RESTRICTED');

  const maturity = addMonthsUtc(today, application.termMonths);
  if (ageOn(application.birthDate, maturity) > MAX_AGE_AT_MATURITY) {
    reasons.push('AGE_AT_MATURITY_EXCEEDED');
  }

  const monthlyRate = gamaMonthlyRate(application.termMonths);
  const installmentCents = priceInstallmentCents(
    application.amountCents,
    monthlyRate,
    application.termMonths,
  );
  if (installmentCents > consignableMarginCents(application.netIncomeCents, MARGIN_PERCENT)) {
    reasons.push('INSUFFICIENT_MARGIN');
  }

  return reasons.length > 0
    ? { accepted: false, reasons }
    : { accepted: true, installmentCents, monthlyRate };
}
