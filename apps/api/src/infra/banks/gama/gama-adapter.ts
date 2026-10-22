import type { BankProvider } from '../../../application/ports/bank-provider';
import { type BankAdapterDeps, createBankAdapter } from '../common/bank-adapter';
import { centsToReais } from '../common/money';
import { type GamaResponse, gamaResponseSchema } from './gama-contract';

export const GAMA_ID = 'gama';

const REASON_MESSAGES = new Map([
  ['EMPLOYER_RESTRICTED', 'Empresa empregadora não atendida pelo banco.'],
  ['AGE_AT_MATURITY_EXCEEDED', 'Idade ao fim do contrato acima do limite do banco.'],
  ['INSUFFICIENT_MARGIN', 'Margem consignável insuficiente para a parcela.'],
]);

export function createGamaAdapter(deps: BankAdapterDeps): BankProvider {
  return createBankAdapter<GamaResponse>(
    {
      id: GAMA_ID,
      path: '/simulate',
      // Gama's contract has no employment type, so it is not sent.
      toRequestBody: (input) => ({
        applicant: { cpf: input.cpf, dateOfBirth: input.birthDate },
        employer: { cnpj: input.employerCnpj },
        income: { netMonthly: centsToReais(input.netSalaryCents) },
        loan: { amount: centsToReais(input.requestedAmountCents), termMonths: input.installments },
      }),
      responseSchema: gamaResponseSchema,
      toDecision: (response) =>
        response.decision === 'ACCEPT'
          ? {
              status: 'APPROVED',
              offer: {
                amountCents: response.terms.principal,
                installments: response.terms.months,
                monthlyRate: response.terms.ratePercent,
                installmentCents: response.terms.monthlyPayment,
              },
            }
          : { status: 'DENIED', reasonCodes: response.declineReasons },
      reasonMessages: REASON_MESSAGES,
    },
    deps,
  );
}
