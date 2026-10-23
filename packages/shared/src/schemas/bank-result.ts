import { z } from 'zod';
import { centsSchema } from './money';

export const BANK_RESULT_STATUSES = [
  'PENDING',
  'APPROVED',
  'DENIED',
  'UNAVAILABLE',
  'ERROR',
] as const;

export const bankResultStatusSchema = z.enum(BANK_RESULT_STATUSES);

export const offerSchema = z.object({
  amountCents: centsSchema,
  installments: z.number().int().positive(),
  // Decimal fraction per month (0.0189 = 1.89% a.m.). A rate, not money, so float is fine.
  monthlyRate: z.number().positive(),
  installmentCents: centsSchema,
});

export const bankResultBaseShape = {
  bankId: z.string().min(1),
  reason: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  // HTTP attempts made for this bank (0 when the circuit breaker refused the call outright).
  attempts: z.number().int().nonnegative().optional(),
};

// Discriminated by status: APPROVED always carries an offer and no other status can.
// strictObject rejects an unexpected `offer` instead of silently stripping it.
export const bankResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...bankResultBaseShape, status: z.literal('APPROVED'), offer: offerSchema }),
  z.strictObject({
    ...bankResultBaseShape,
    status: bankResultStatusSchema.exclude(['APPROVED']),
  }),
]);

export type BankResultStatus = z.infer<typeof bankResultStatusSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type BankResult = z.infer<typeof bankResultSchema>;
export type ApprovedBankResult = Extract<BankResult, { status: 'APPROVED' }>;
