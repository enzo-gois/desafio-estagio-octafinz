import type { ApprovedBankResult, BankResult, Offer } from '@simulador/shared';
import { toMicroUnits } from './numeric';
import { totalPayableCents } from './price';

export interface RankedOffer {
  bankId: string;
  offer: Offer;
  isCounterOffer: boolean;
  totalPayableCents: number;
}

/** A counter-offer approves less money than the customer asked for. */
export function isCounterOffer(offer: Offer, requestedAmountCents: number): boolean {
  return offer.amountCents < requestedAmountCents;
}

function toRankedOffer(result: ApprovedBankResult, requestedAmountCents: number): RankedOffer {
  return {
    bankId: result.bankId,
    offer: result.offer,
    isCounterOffer: isCounterOffer(result.offer, requestedAmountCents),
    totalPayableCents: totalPayableCents(result.offer.installmentCents, result.offer.installments),
  };
}

/**
 * Orders two offers for Array#sort: negative when `a` is better, positive when `b` is better.
 *
 * Decision B1, in priority order:
 * 1. Lower monthly rate wins, counter-offer or not (compare rates with toMicroUnits, never ===).
 * 2. Same rate: the full amount beats a counter-offer.
 * 3. Same rate, both of the same kind: the larger approved amount wins.
 * 4. Still tied: bankId in alphabetical order, so the result never depends on arrival order.
 *
 * The installment is deliberately NOT a criterion: a counter-offer has a smaller installment
 * only because it lends less money.
 */
export function compareOffers(a: RankedOffer, b: RankedOffer): number {
  const rateDiff = toMicroUnits(a.offer.monthlyRate) - toMicroUnits(b.offer.monthlyRate);
  if (rateDiff !== 0) return rateDiff;

  const kindDiff = Number(a.isCounterOffer) - Number(b.isCounterOffer);
  if (kindDiff !== 0) return kindDiff;

  const amountDiff = b.offer.amountCents - a.offer.amountCents;
  if (amountDiff !== 0) return amountDiff;

  return a.bankId < b.bankId ? -1 : a.bankId > b.bankId ? 1 : 0;
}

/** Approved offers from best to worst. Non-approved results are ignored. */
export function rankOffers(
  results: readonly BankResult[],
  requestedAmountCents: number,
): RankedOffer[] {
  return results
    .filter((result): result is ApprovedBankResult => result.status === 'APPROVED')
    .map((result) => toRankedOffer(result, requestedAmountCents))
    .sort(compareOffers);
}

/** Best offer by decision B1, or undefined when no bank approved. */
export function selectBestOffer(
  results: readonly BankResult[],
  requestedAmountCents: number,
): RankedOffer | undefined {
  return rankOffers(results, requestedAmountCents)[0];
}
