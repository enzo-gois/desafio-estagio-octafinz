import type { BankResult } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { summarizeSimulation } from './simulation-status';

const REQUESTED = 1_000_000;

const pending: BankResult = { bankId: 'gama', status: 'PENDING' };
const approved: BankResult = {
  bankId: 'alfa',
  status: 'APPROVED',
  offer: {
    amountCents: 1_000_000,
    installments: 48,
    monthlyRate: 0.0179,
    installmentCents: 31_224,
  },
};
const denied: BankResult = { bankId: 'beta', status: 'DENIED', reason: 'Vínculo não atendido' };
const unavailable: BankResult = { bankId: 'gama', status: 'UNAVAILABLE' };
const error: BankResult = { bankId: 'gama', status: 'ERROR' };

describe('summarizeSimulation', () => {
  it.each([
    ['all banks pending', [pending], 'PROCESSING', false],
    ['an approval while another bank is pending', [approved, pending], 'PROCESSING', false],
    ['a failure while another bank is pending', [error, pending], 'PROCESSING', false],
    ['an approval and a denial', [approved, denied], 'COMPLETED_WITH_OFFERS', false],
    ['an approval and a failure', [approved, denied, error], 'COMPLETED_WITH_OFFERS', true],
    ['only denials', [denied, { ...denied, bankId: 'alfa' }], 'COMPLETED_WITHOUT_OFFERS', false],
    ['a denial and an unavailable bank', [denied, unavailable], 'COMPLETED_WITHOUT_OFFERS', true],
    ['only errors', [error], 'COMPLETED_WITHOUT_OFFERS', true],
    ['no banks at all', [], 'COMPLETED_WITHOUT_OFFERS', false],
  ] as const)('%s -> %s (retryable: %s)', (_, results, status, retryable) => {
    const summary = summarizeSimulation(results, REQUESTED);

    expect(summary.status).toBe(status);
    expect(summary.retryable).toBe(retryable);
  });

  it('exposes the best offer so far while still processing', () => {
    const summary = summarizeSimulation([approved, pending], REQUESTED);

    expect(summary.bestOffer?.bankId).toBe('alfa');
  });

  it('has no best offer when nobody approved', () => {
    expect(summarizeSimulation([denied, error], REQUESTED).bestOffer).toBeUndefined();
  });

  it('counts every status', () => {
    const summary = summarizeSimulation([approved, denied, unavailable, error, pending], REQUESTED);

    expect(summary.counts).toEqual({
      PENDING: 1,
      APPROVED: 1,
      DENIED: 1,
      UNAVAILABLE: 1,
      ERROR: 1,
    });
  });
});
