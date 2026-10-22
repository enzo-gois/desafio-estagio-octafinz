import type { BankProvider } from '../../../application/ports/bank-provider';
import { type BankAdapterDeps, createBankAdapter } from '../common/bank-adapter';
import { type AlfaResponse, alfaResponseSchema } from './alfa-contract';

export const ALFA_ID = 'alfa';

const REASON_MESSAGES = new Map([
  ['AGE_OUT_OF_RANGE', 'Idade fora da faixa aceita pelo banco.'],
  ['TERM_NOT_ALLOWED', 'Prazo acima do máximo aceito pelo banco.'],
  ['INSUFFICIENT_MARGIN', 'Margem consignável insuficiente para a parcela.'],
]);

export function createAlfaAdapter(deps: BankAdapterDeps): BankProvider {
  return createBankAdapter<AlfaResponse>(
    {
      id: ALFA_ID,
      path: '/v1/loan-simulations',
      // Alfa speaks our units already: camelCase, integer cents, the same employment enum.
      // An undefined employmentType is dropped by JSON.stringify.
      toRequestBody: (input) => ({
        customer: {
          taxId: input.cpf,
          birthDate: input.birthDate,
          monthlyNetIncomeCents: input.netSalaryCents,
          employmentType: input.employmentType,
        },
        employerTaxId: input.employerCnpj,
        requestedAmountCents: input.requestedAmountCents,
        installments: input.installments,
      }),
      responseSchema: alfaResponseSchema,
      toDecision: (response) =>
        response.status === 'APPROVED'
          ? {
              status: 'APPROVED',
              offer: {
                amountCents: response.offer.approvedAmountCents,
                installments: response.offer.installments,
                monthlyRate: response.offer.monthlyInterestRate,
                installmentCents: response.offer.installmentAmountCents,
              },
            }
          : { status: 'DENIED', reasonCodes: [response.rejectionReason] },
      reasonMessages: REASON_MESSAGES,
    },
    deps,
  );
}
