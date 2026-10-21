// Banco Beta public contract: snake_case, numeric result_code, money as decimal strings.

const moneySchema = { type: 'string', pattern: '^\\d{1,10}\\.\\d{2}$' } as const;

export const BETA_EMPLOYMENT_TYPES = ['clt', 'public_servant', 'inss_retiree'] as const;
export type BetaEmploymentType = (typeof BETA_EMPLOYMENT_TYPES)[number];

export const betaRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'borrower_cpf',
    'borrower_birth_date',
    'employer_cnpj',
    'net_salary',
    'requested_amount',
    'term_months',
  ],
  properties: {
    borrower_cpf: { type: 'string', pattern: '^\\d{11}$' },
    borrower_birth_date: { type: 'string', format: 'date' },
    employment_type: { type: 'string', enum: BETA_EMPLOYMENT_TYPES },
    employer_cnpj: { type: 'string', pattern: '^[0-9A-Z]{12}\\d{2}$' },
    net_salary: moneySchema,
    requested_amount: moneySchema,
    term_months: { type: 'integer', minimum: 1, maximum: 360 },
  },
} as const;

export interface BetaRequest {
  borrower_cpf: string;
  borrower_birth_date: string;
  employment_type?: BetaEmploymentType;
  employer_cnpj: string;
  net_salary: string;
  requested_amount: string;
  term_months: number;
}

export const BETA_RESULT_CODES = {
  APPROVED: 0,
  PARTIALLY_APPROVED: 1,
  REJECTED: 2,
  INTERNAL_ERROR: 98,
  INVALID_REQUEST: 99,
} as const;

export type BetaReasonCode = 'R01' | 'R02' | 'R03';

export const BETA_REASON_MESSAGES: Record<BetaReasonCode, string> = {
  R01: 'MARGEM INSUFICIENTE',
  R02: 'IDADE FORA DA POLITICA',
  R03: 'VINCULO NAO ATENDIDO',
};

export type BetaResponse =
  | {
      result_code: 0 | 1;
      result_message: 'APROVADO' | 'APROVADO PARCIAL';
      proposal: {
        approved_amount: string;
        term_months: number;
        monthly_rate_pct: string;
        installment_amount: string;
      };
    }
  | { result_code: 2; result_message: string; reason_code: BetaReasonCode };

export interface BetaErrorResponse {
  result_code: 98 | 99;
  result_message: 'ERRO INTERNO' | 'REQUISICAO INVALIDA';
}

// "5000.00" -> 500000. Splitting the string avoids float math on money.
export function parseBetaMoney(value: string): number {
  const [reais = '0', cents = '0'] = value.split('.');
  return Number(reais) * 100 + Number(cents);
}

// 500000 -> "5000.00"
export function formatBetaMoney(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
