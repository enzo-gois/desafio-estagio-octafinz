import type { EmploymentType } from '@simulador/shared';
import type { BankProvider } from '../../../application/ports/bank-provider';
import { type BankAdapterDeps, createBankAdapter } from '../common/bank-adapter';
import { centsToDecimalString } from '../common/money';
import { type BetaResponse, betaResponseSchema } from './beta-contract';

export const BETA_ID = 'beta';

// A Record (not a switch): adding an employment type breaks the build until Beta maps it.
const BETA_EMPLOYMENT_TYPES: Record<EmploymentType, string> = {
  CLT: 'clt',
  PUBLIC_SERVANT: 'public_servant',
  INSS_RETIREE: 'inss_retiree',
};

const REASON_MESSAGES = new Map([
  ['R01', 'Margem consignável insuficiente para a parcela.'],
  ['R02', 'Idade fora da política do banco.'],
  ['R03', 'Tipo de vínculo não atendido pelo banco.'],
]);

export function createBetaAdapter(deps: BankAdapterDeps): BankProvider {
  return createBankAdapter<BetaResponse>(
    {
      id: BETA_ID,
      path: '/api/v2/simulations',
      toRequestBody: (input) => ({
        borrower_cpf: input.cpf,
        borrower_birth_date: input.birthDate,
        employment_type:
          input.employmentType === undefined
            ? undefined
            : BETA_EMPLOYMENT_TYPES[input.employmentType],
        employer_cnpj: input.employerCnpj,
        net_salary: centsToDecimalString(input.netSalaryCents),
        requested_amount: centsToDecimalString(input.requestedAmountCents),
        term_months: input.installments,
      }),
      responseSchema: betaResponseSchema,
      toDecision: (response) =>
        // result_code 1 (counter-offer) is an approval of a smaller amount; the domain flags it.
        response.result_code === 2
          ? { status: 'DENIED', reasonCodes: [response.reason_code] }
          : {
              status: 'APPROVED',
              offer: {
                amountCents: response.proposal.approved_amount,
                installments: response.proposal.term_months,
                monthlyRate: response.proposal.monthly_rate_pct,
                installmentCents: response.proposal.installment_amount,
              },
            },
      reasonMessages: REASON_MESSAGES,
    },
    deps,
  );
}
