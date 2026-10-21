import { describe, expect, it } from 'vitest';
import { bankResultSchema } from './bank-result';

const approved = {
  bankId: 'alfa',
  status: 'APPROVED',
  offer: {
    amountCents: 1_000_000,
    installments: 48,
    monthlyRate: 0.0189,
    installmentCents: 31_250,
  },
  latencyMs: 120,
};

describe('bankResultSchema', () => {
  it('accepts an approved result with an offer', () => {
    expect(bankResultSchema.safeParse(approved).success).toBe(true);
  });

  it('accepts a pending result with only bankId and status', () => {
    expect(bankResultSchema.safeParse({ bankId: 'gama', status: 'PENDING' }).success).toBe(true);
  });

  it('rejects a bank-specific status that was not translated by the adapter', () => {
    expect(bankResultSchema.safeParse({ bankId: 'alfa', status: 'REJECTED' }).success).toBe(false);
  });

  it('rejects money that is not integer cents', () => {
    const offer = { ...approved.offer, installmentCents: 312.5 };

    expect(bankResultSchema.safeParse({ ...approved, offer }).success).toBe(false);
  });
});
