import type { EmploymentType } from '@simulador/shared';
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
import { createBetaAdapter } from './beta-adapter';

function setup(outcome: HttpOutcome) {
  const { sender, requests } = fixedSender(outcome);
  const adapter = createBetaAdapter({
    endpoint: endpointFor('beta'),
    client: sender,
    logger: createCaptureLogger().logger,
  });
  return {
    simulate: (input = CUSTOMER) => adapter.simulate(input, new AbortController().signal, CONTEXT),
    requests,
  };
}

const proposal = {
  approved_amount: '10000.00',
  term_months: 48,
  monthly_rate_pct: '1.59',
  installment_amount: '299.42',
};
const sentBody = (requests: { body: string }[]) => JSON.parse(requests[0]?.body ?? '');

describe('Beta adapter', () => {
  it('translates the input to snake_case with money as "0.00" strings', async () => {
    const { simulate, requests } = setup(jsonResponse({ result_code: 0, proposal }));
    await simulate();

    expect(sentBody(requests)).toEqual({
      borrower_cpf: '52998224725',
      borrower_birth_date: '1985-04-12',
      employment_type: 'public_servant',
      employer_cnpj: '12ABC34501DE35',
      net_salary: '7342.19',
      requested_amount: '10000.00',
      term_months: 48,
    });
  });

  it.each([
    ['CLT', 'clt'],
    ['PUBLIC_SERVANT', 'public_servant'],
    ['INSS_RETIREE', 'inss_retiree'],
  ] as const)('maps employment type %s to "%s"', async (ours, beta) => {
    const { simulate, requests } = setup(jsonResponse({ result_code: 0, proposal }));
    await simulate({ ...CUSTOMER, employmentType: ours as EmploymentType });

    expect(sentBody(requests).employment_type).toBe(beta);
  });

  it('omits the employment type when the customer did not inform it', async () => {
    const { simulate, requests } = setup(jsonResponse({ result_code: 0, proposal }));
    await simulate({ ...CUSTOMER, employmentType: undefined });

    expect(sentBody(requests)).not.toHaveProperty('employment_type');
  });

  it('maps result_code 0 to APPROVED, converting money strings to cents and the rate to a fraction', async () => {
    expect(await setup(jsonResponse({ result_code: 0, proposal })).simulate()).toMatchObject({
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 0.0159,
        installmentCents: 29_942,
      },
    });
  });

  it('maps the counter-offer (result_code 1) to APPROVED with the smaller amount', async () => {
    const counter = { ...proposal, approved_amount: '8182.55', installment_amount: '245.00' };

    expect(
      await setup(jsonResponse({ result_code: 1, proposal: counter })).simulate(),
    ).toMatchObject({
      status: 'APPROVED',
      offer: { amountCents: 818_255, installmentCents: 24_500 },
    });
  });

  it('converts money without float: "4.35" is 435 cents', async () => {
    // The float route gets it wrong: 4.35 × 100 is 434.99999999999994.
    expect(Math.floor(Number('4.35') * 100)).toBe(434);
    const tiny = { ...proposal, installment_amount: '4.35' };

    expect(await setup(jsonResponse({ result_code: 0, proposal: tiny })).simulate()).toMatchObject({
      offer: { installmentCents: 435 },
    });
  });

  it.each([
    ['R01', 'Margem consignável insuficiente para a parcela.'],
    ['R02', 'Idade fora da política do banco.'],
    ['R03', 'Tipo de vínculo não atendido pelo banco.'],
  ])('maps result_code 2 / %s to DENIED with a Portuguese reason', async (code, message) => {
    const response = jsonResponse({ result_code: 2, result_message: 'X', reason_code: code });

    expect(await setup(response).simulate()).toMatchObject({ status: 'DENIED', reason: message });
  });

  it("maps the proxy's HTML 502 (after retries) to UNAVAILABLE without parsing it", async () => {
    const html = jsonResponse('<html><h1>502 Bad Gateway</h1></html>', 502, {
      headers: new Headers({ 'content-type': 'text/html' }),
      attempts: 3,
    });

    expect(await setup(html).simulate()).toMatchObject({ status: 'UNAVAILABLE', attempts: 3 });
  });

  it('maps a 400 (result_code 99) to ERROR', async () => {
    const response = jsonResponse({ result_code: 99, result_message: 'REQUISICAO INVALIDA' }, 400);

    expect(await setup(response).simulate()).toMatchObject({ status: 'ERROR' });
  });

  it.each([
    ['malformed JSON', '{"result_code":0,"proposal":{"approved_amount":"10'],
    [
      'invalid-shape (result_code as string, amount as number)',
      {
        result_code: '0',
        proposal: { approved_amount: 10000, term_months: '48' },
      },
    ],
    ['an unknown result_code', { result_code: 3, proposal }],
    [
      'money without cents',
      { result_code: 0, proposal: { ...proposal, approved_amount: '8182.5' } },
    ],
    [
      'money with a comma',
      { result_code: 0, proposal: { ...proposal, installment_amount: '299,42' } },
    ],
    ['a zero amount', { result_code: 0, proposal: { ...proposal, approved_amount: '0.00' } }],
  ])('maps %s to ERROR', async (_, body) => {
    expect(await setup(jsonResponse(body)).simulate()).toMatchObject({
      status: 'ERROR',
      reason: 'O banco retornou uma resposta inválida.',
    });
  });
});
