import { z } from 'zod';
import { bankResultSchema } from './bank-result';
import { cnpjSchema, cpfSchema } from './document';
import { centsSchema } from './money';

export const EMPLOYMENT_TYPES = ['CLT', 'PUBLIC_SERVANT', 'INSS_RETIREE'] as const;

// Fictitious limits for the MVP.
export const MIN_INSTALLMENTS = 6;
export const MAX_INSTALLMENTS = 96;

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES, {
  error: 'Tipo de vínculo inválido',
});

export const installmentsSchema = z
  .number({ error: 'Número de parcelas inválido' })
  .int({ error: 'Número de parcelas deve ser inteiro' })
  .min(MIN_INSTALLMENTS, { error: `Mínimo de ${MIN_INSTALLMENTS} parcelas` })
  .max(MAX_INSTALLMENTS, { error: `Máximo de ${MAX_INSTALLMENTS} parcelas` });

export const simulationInputSchema = z.object({
  name: z
    .string({ error: 'Informe o nome' })
    .trim()
    .min(1, { error: 'Informe o nome' })
    .max(120, { error: 'Nome muito longo' }),
  email: z.email({ error: 'E-mail inválido' }),
  cpf: cpfSchema,
  birthDate: z.iso.date({ error: 'Data de nascimento inválida' }),
  employmentType: employmentTypeSchema.optional(),
  employerCnpj: cnpjSchema,
  // Consignable margin is computed over the net salary.
  netSalaryCents: centsSchema,
  requestedAmountCents: centsSchema,
  installments: installmentsSchema,
  consent: z.literal(true, { error: 'É necessário autorizar a consulta aos bancos' }),
});

// Response of POST /simulations (202).
export const createSimulationResponseSchema = z.object({
  id: z.string().min(1),
});

// Response of GET /simulations/:id. Personal data is intentionally not echoed back.
export const simulationViewSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  requestedAmountCents: centsSchema,
  installments: installmentsSchema,
  results: z.array(bankResultSchema),
});

export type EmploymentType = z.infer<typeof employmentTypeSchema>;
// Output type: cpf/employerCnpj are already normalized here.
export type SimulationInput = z.infer<typeof simulationInputSchema>;
export type CreateSimulationResponse = z.infer<typeof createSimulationResponseSchema>;
export type SimulationView = z.infer<typeof simulationViewSchema>;
