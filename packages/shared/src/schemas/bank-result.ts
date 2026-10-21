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

export const bankResultSchema = z.object({
  bankId: z.string().min(1),
  status: bankResultStatusSchema,
  offer: offerSchema.optional(),
  reason: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

export type BankResultStatus = z.infer<typeof bankResultStatusSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type BankResult = z.infer<typeof bankResultSchema>;
