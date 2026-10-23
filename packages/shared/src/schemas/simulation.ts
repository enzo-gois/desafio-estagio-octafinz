import { z } from 'zod';
import { bankResultBaseShape, bankResultStatusSchema, offerSchema } from './bank-result';
import { CONSENT_VERSION } from './consent';
import { cnpjSchema, cpfSchema } from './document';
import { centsSchema } from './money';

export const EMPLOYMENT_TYPES = ['CLT', 'PUBLIC_SERVANT', 'INSS_RETIREE'] as const;

// Fictitious limits for the MVP.
export const MIN_INSTALLMENTS = 6;
export const MAX_INSTALLMENTS = 96;
// R$ 1.000.000,00. Also keeps every amount inside the 32-bit integer columns of the database.
export const MAX_AMOUNT_CENTS = 100_000_000;

export const STALE_CONSENT_MESSAGE =
  'Os termos de consentimento foram atualizados. Recarregue a página para ler a nova versão.';

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES, {
  error: 'Tipo de vínculo inválido',
});

export const installmentsSchema = z
  .number({ error: 'Número de parcelas inválido' })
  .int({ error: 'Número de parcelas deve ser inteiro' })
  .min(MIN_INSTALLMENTS, { error: `Mínimo de ${MIN_INSTALLMENTS} parcelas` })
  .max(MAX_INSTALLMENTS, { error: `Máximo de ${MAX_INSTALLMENTS} parcelas` });

const cappedCentsSchema = centsSchema.max(MAX_AMOUNT_CENTS, {
  error: 'Valor máximo: R$ 1.000.000,00',
});

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
  netSalaryCents: cappedCentsSchema,
  requestedAmountCents: cappedCentsSchema,
  installments: installmentsSchema,
  consent: z.literal(true, { error: 'É necessário autorizar a consulta aos bancos' }),
  // The version of the text the customer read. A tab opened before a deploy that changed the
  // text sends the old one and is asked to reload, instead of recording consent to a text
  // the customer never saw.
  consentVersion: z.literal(CONSENT_VERSION, { error: STALE_CONSENT_MESSAGE }),
});

// Response of POST /simulations (202).
export const createSimulationResponseSchema = z.object({
  id: z.uuid(),
});

export const SIMULATION_STATUSES = [
  'PROCESSING',
  'COMPLETED_WITH_OFFERS',
  'COMPLETED_WITHOUT_OFFERS',
] as const;

// The bank's display name comes from the API's bank registry, so the front needs no list of
// banks: adding one stays adapter + registry.
const bankResultViewBaseShape = { ...bankResultBaseShape, bankName: z.string().min(1) };

// A bank result as the GET returns it: approved offers carry what the front needs to show
// them (counter-offer flag, total to pay); every other status is the plain BankResult.
export const bankResultViewSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...bankResultViewBaseShape,
    status: z.literal('APPROVED'),
    offer: offerSchema,
    isCounterOffer: z.boolean(),
    totalPayableCents: centsSchema,
  }),
  z.strictObject({
    ...bankResultViewBaseShape,
    status: bankResultStatusSchema.exclude(['APPROVED']),
  }),
]);

/**
 * Response of GET /simulations/:id. The GET has no authentication (the random id is the only
 * key), so it carries no personal data beyond the masked CPF, and from the margin assessment
 * only `fitsMargin`: margin, estimated installment or commitment would let anyone recompute
 * the salary. strictObject: an extra field in the response is a bug, not something to ignore.
 */
export const simulationViewSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  // When the response was built. The front measures elapsed time against this, not against its
  // own clock, which may be minutes off.
  serverTime: z.iso.datetime(),
  status: z.enum(SIMULATION_STATUSES),
  retryable: z.boolean(),
  request: z.strictObject({
    requestedAmountCents: centsSchema,
    installments: installmentsSchema,
    cpfMasked: z.string(),
  }),
  margin: z.strictObject({ fitsMargin: z.boolean() }),
  bestOffer: z.strictObject({ bankId: z.string() }).nullable(),
  results: z.array(bankResultViewSchema),
});

export type EmploymentType = z.infer<typeof employmentTypeSchema>;
// Output type: cpf/employerCnpj are already normalized here.
export type SimulationInput = z.infer<typeof simulationInputSchema>;
export type CreateSimulationResponse = z.infer<typeof createSimulationResponseSchema>;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];
export type BankResultView = z.infer<typeof bankResultViewSchema>;
export type SimulationView = z.infer<typeof simulationViewSchema>;
