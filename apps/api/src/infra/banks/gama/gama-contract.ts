import { z } from 'zod';
import { reaisCentsSchema } from '../common/money';
import { percentRateSchema } from '../common/rates';

// Banco Gama response contract: money as decimal numbers in reais (converted to cents with a
// two-decimal check), rate in percent and a list of decline reasons.
export const gamaResponseSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('ACCEPT'),
    terms: z.object({
      principal: reaisCentsSchema,
      months: z.number().int().positive(),
      ratePercent: percentRateSchema,
      monthlyPayment: reaisCentsSchema,
    }),
  }),
  z.object({
    decision: z.literal('DECLINE'),
    declineReasons: z.array(z.string().min(1)).min(1),
  }),
]);

export type GamaResponse = z.infer<typeof gamaResponseSchema>;
