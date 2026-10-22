import { describe, expect, it } from 'vitest';
import {
  CONTEXT,
  CUSTOMER,
  endpointFor,
  fixedSender,
  jsonResponse,
} from '../../../testing/bank-fixtures';
import { createCaptureLogger } from '../../../testing/capture-logger';
import type { HttpOutcome } from '../../http/resilient-http-client';
import { createAlfaAdapter } from './alfa-adapter';

function setup(outcome: HttpOutcome) {
  const capture = createCaptureLogger();
  const { sender, requests } = fixedSender(outcome);
  const adapter = createAlfaAdapter({
    endpoint: endpointFor('alfa'),
    client: sender,
    logger: capture.logger,
  });
  return {
    simulate: (input = CUSTOMER) => adapter.simulate(input, new AbortController().signal, CONTEXT),
    requests,
    capture,
  };
}

const approved = {
  proposalId: 'alfa-7f3c',
  status: 'APPROVED',
  offer: {
    approvedAmountCents: 1_000_000,
    installments: 48,
    monthlyInterestRate: 0.0179,
    installmentAmountCents: 31_224,
  },
};

describe('Alfa adapter', () => {
  it("translates the input to Alfa's camelCase contract in cents", async () => {
    const { simulate, requests } = setup(jsonResponse(approved));
    await simulate();

    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({
      customer: {
        taxId: '52998224725',
        birthDate: '1985-04-12',
        monthlyNetIncomeCents: 734_219,
        employmentType: 'PUBLIC_SERVANT',
      },
      employerTaxId: '12ABC34501DE35',
      requestedAmountCents: 1_000_000,
      installments: 48,
    });
  });

  it('omits the employment type when the customer did not inform it', async () => {
    const { simulate, requests } = setup(jsonResponse(approved));
    await simulate({ ...CUSTOMER, employmentType: undefined });

    expect(JSON.parse(requests[0]?.body ?? '').customer).not.toHaveProperty('employmentType');
  });

  it('maps an approval to APPROVED with the offer, latency and attempts', async () => {
    expect(await setup(jsonResponse(approved)).simulate()).toEqual({
      bankId: 'alfa',
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 0.0179,
        installmentCents: 31_224,
      },
      latencyMs: 120,
      attempts: 1,
    });
  });

  it.each([
    ['AGE_OUT_OF_RANGE', 'Idade fora da faixa aceita pelo banco.'],
    ['TERM_NOT_ALLOWED', 'Prazo acima do máximo aceito pelo banco.'],
    ['INSUFFICIENT_MARGIN', 'Margem consignável insuficiente para a parcela.'],
  ])('maps rejection %s to DENIED with a Portuguese reason', async (code, message) => {
    const response = jsonResponse({
      proposalId: 'alfa-1',
      status: 'REJECTED',
      rejectionReason: code,
    });

    expect(await setup(response).simulate()).toMatchObject({ status: 'DENIED', reason: message });
  });

  it('uses a generic reason for an unknown code and logs the code', async () => {
    const { simulate, capture } = setup(
      jsonResponse({ proposalId: 'alfa-1', status: 'REJECTED', rejectionReason: 'NEW_POLICY_42' }),
    );

    expect(await simulate()).toMatchObject({
      status: 'DENIED',
      reason: 'O banco não aprovou a simulação.',
    });
    expect(capture.entries()).toContainEqual(
      expect.objectContaining({ level: 40, reasonCode: 'NEW_POLICY_42' }),
    );
  });

  it.each([
    ['malformed JSON', '{"proposalId":"alfa-1","status":"APPR'],
    ['invalid-shape (unknown status)', { proposalId: 'alfa-1', status: 'MAYBE', offer: null }],
    [
      'a rate sent as percent (1.79 instead of 0.0179)',
      {
        ...approved,
        offer: { ...approved.offer, monthlyInterestRate: 1.79 },
      },
    ],
    [
      'fractional cents',
      { ...approved, offer: { ...approved.offer, installmentAmountCents: 312.24 } },
    ],
    ['an approval without an offer', { proposalId: 'alfa-1', status: 'APPROVED' }],
  ])('maps %s to ERROR', async (_, body) => {
    expect(await setup(jsonResponse(body)).simulate()).toMatchObject({
      status: 'ERROR',
      reason: 'O banco retornou uma resposta inválida.',
    });
  });

  it('maps a 400 to ERROR', async () => {
    const response = jsonResponse({ error: { code: 'INVALID_REQUEST', message: 'x' } }, 400);

    expect(await setup(response).simulate()).toMatchObject({ status: 'ERROR' });
  });

  it('tolerates extra fields Alfa may add later', async () => {
    const response = jsonResponse({ ...approved, campaign: 'black-friday' });

    expect(await setup(response).simulate()).toMatchObject({ status: 'APPROVED' });
  });
});
