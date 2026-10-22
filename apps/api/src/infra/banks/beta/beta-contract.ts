import { z } from 'zod';
import { decimalStringCentsSchema } from '../common/money';
import { percentRateSchema } from '../common/rates';

// Banco Beta response contract: snake_case, numeric result_code, money as "0.00" strings,
// rate as a percent string. Money is converted to cents by splitting the string (no float).
const percentStringSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/)
  .transform(Number)
  .pipe(percentRateSchema);

const proposalSchema = z.object({
  approved_amount: decimalStringCentsSchema,
  term_months: z.number().int().positive(),
  monthly_rate_pct: percentStringSchema,
  installment_amount: decimalStringCentsSchema,
});

export const betaResponseSchema = z.discriminatedUnion('result_code', [
  z.object({ result_code: z.literal(0), proposal: proposalSchema }),
  // Counter-offer: approved, but for less than requested.
  z.object({ result_code: z.literal(1), proposal: proposalSchema }),
  z.object({ result_code: z.literal(2), reason_code: z.string().min(1) }),
]);

export type BetaResponse = z.infer<typeof betaResponseSchema>;
