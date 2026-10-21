// Banco Alfa public contract: camelCase, money as integer cents, rate as a decimal fraction.

const centsSchema = { type: 'integer', minimum: 1 } as const;

export const ALFA_EMPLOYMENT_TYPES = ['CLT', 'PUBLIC_SERVANT', 'INSS_RETIREE'] as const;
export type AlfaEmploymentType = (typeof ALFA_EMPLOYMENT_TYPES)[number];

export const alfaRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['customer', 'employerTaxId', 'requestedAmountCents', 'installments'],
  properties: {
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['taxId', 'birthDate', 'monthlyNetIncomeCents'],
      properties: {
        taxId: { type: 'string', pattern: '^\\d{11}$' },
        birthDate: { type: 'string', format: 'date' },
        monthlyNetIncomeCents: centsSchema,
        employmentType: { type: 'string', enum: ALFA_EMPLOYMENT_TYPES },
      },
    },
    employerTaxId: { type: 'string', pattern: '^[0-9A-Z]{12}\\d{2}$' },
    requestedAmountCents: centsSchema,
    installments: { type: 'integer', minimum: 1, maximum: 360 },
  },
} as const;

export interface AlfaRequest {
  customer: {
    taxId: string;
    birthDate: string;
    monthlyNetIncomeCents: number;
    employmentType?: AlfaEmploymentType;
  };
  employerTaxId: string;
  requestedAmountCents: number;
  installments: number;
}

export type AlfaRejectionReason = 'AGE_OUT_OF_RANGE' | 'TERM_NOT_ALLOWED' | 'INSUFFICIENT_MARGIN';

export type AlfaResponse =
  | {
      proposalId: string;
      status: 'APPROVED';
      offer: {
        approvedAmountCents: number;
        installments: number;
        monthlyInterestRate: number;
        installmentAmountCents: number;
      };
    }
  | { proposalId: string; status: 'REJECTED'; rejectionReason: AlfaRejectionReason };

export interface AlfaErrorResponse {
  error: { code: 'INVALID_REQUEST' | 'INTERNAL_ERROR'; message?: string };
}
