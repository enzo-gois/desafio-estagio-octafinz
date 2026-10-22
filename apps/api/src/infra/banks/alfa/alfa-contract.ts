import { z } from 'zod';
import { centsSchema } from '../common/money';
import { fractionRateSchema } from '../common/rates';

// Banco Alfa response contract. Extra fields are tolerated (additive changes on their side);
// required fields and types are strict. Reason codes are free strings: a new code must not
// turn a legitimate denial into ERROR.
export const alfaResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('APPROVED'),
    proposalId: z.string().min(1),
    offer: z.object({
      approvedAmountCents: centsSchema,
      installments: z.number().int().positive(),
      monthlyInterestRate: fractionRateSchema,
      installmentAmountCents: centsSchema,
    }),
  }),
  z.object({
    status: z.literal('REJECTED'),
    proposalId: z.string().min(1),
    rejectionReason: z.string().min(1),
  }),
]);

export type AlfaResponse = z.infer<typeof alfaResponseSchema>;
