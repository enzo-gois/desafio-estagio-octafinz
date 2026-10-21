// Banco Gama public contract: nested camelCase, money as decimal numbers in reais,
// rate in percent, and a list of decline reasons.

const reaisSchema = { type: 'number', exclusiveMinimum: 0, maximum: 100_000_000 } as const;

export const gamaRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['applicant', 'employer', 'income', 'loan'],
  properties: {
    applicant: {
      type: 'object',
      additionalProperties: false,
      required: ['cpf', 'dateOfBirth'],
      properties: {
        cpf: { type: 'string', pattern: '^\\d{11}$' },
        dateOfBirth: { type: 'string', format: 'date' },
      },
    },
    employer: {
      type: 'object',
      additionalProperties: false,
      required: ['cnpj'],
      properties: {
        cnpj: { type: 'string', pattern: '^[0-9A-Z]{12}\\d{2}$' },
      },
    },
    income: {
      type: 'object',
      additionalProperties: false,
      required: ['netMonthly'],
      properties: { netMonthly: reaisSchema },
    },
    loan: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'termMonths'],
      properties: {
        amount: reaisSchema,
        termMonths: { type: 'integer', minimum: 1, maximum: 360 },
      },
    },
  },
} as const;

export interface GamaRequest {
  applicant: { cpf: string; dateOfBirth: string };
  employer: { cnpj: string };
  income: { netMonthly: number };
  loan: { amount: number; termMonths: number };
}

export type GamaDeclineReason =
  'EMPLOYER_RESTRICTED' | 'AGE_AT_MATURITY_EXCEEDED' | 'INSUFFICIENT_MARGIN';

export type GamaResponse =
  | {
      decision: 'ACCEPT';
      terms: { principal: number; months: number; ratePercent: number; monthlyPayment: number };
    }
  | { decision: 'DECLINE'; declineReasons: GamaDeclineReason[] };

export interface GamaErrorResponse {
  message: string;
}

// Gama speaks reais as floats; the mock converts to cents once, at the boundary.
export const reaisToCents = (reais: number): number => Math.round(reais * 100);
export const centsToReais = (cents: number): number => cents / 100;
