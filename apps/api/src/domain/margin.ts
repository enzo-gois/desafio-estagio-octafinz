import { assertCents, assertRate } from './invariants';
import { priceInstallmentCents } from './price';

/**
 * Fictitious, configurable policy used only to INFORM the customer (decision A1).
 * The API never blocks a simulation on it: banks make the final assessment.
 */
export interface MarginPolicy {
  /** Integer percent of the net salary (e.g. 35). Integer keeps the margin exact in cents. */
  percent: number;
  /** Fictitious reference rate used only to estimate the installment before banks answer. */
  referenceMonthlyRate: number;
}

export interface MarginAssessment {
  marginCents: number;
  estimatedInstallmentCents: number;
  fitsMargin: boolean;
  /**
   * Estimated installment / margin in basis points (10000 = 100% of the margin), rounded UP
   * so that exceeding the margin by any amount never shows as 100%. Null when the margin is 0.
   */
  commitmentBps: number | null;
}

export function consignableMarginCents(netSalaryCents: number, percent: number): number {
  assertCents(netSalaryCents, 'netSalaryCents');
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be an integer between 0 and 100 (got ${percent})`);
  }
  // Integer math, rounded down: the margin is never overstated.
  return Math.floor((netSalaryCents * percent) / 100);
}

export function assessMargin(
  request: { netSalaryCents: number; requestedAmountCents: number; installments: number },
  policy: MarginPolicy,
): MarginAssessment {
  assertRate(policy.referenceMonthlyRate, 'referenceMonthlyRate');

  const marginCents = consignableMarginCents(request.netSalaryCents, policy.percent);
  const estimatedInstallmentCents = priceInstallmentCents(
    request.requestedAmountCents,
    policy.referenceMonthlyRate,
    request.installments,
  );

  return {
    marginCents,
    estimatedInstallmentCents,
    fitsMargin: estimatedInstallmentCents <= marginCents,
    commitmentBps:
      marginCents === 0 ? null : Math.ceil((estimatedInstallmentCents * 10_000) / marginCents),
  };
}
