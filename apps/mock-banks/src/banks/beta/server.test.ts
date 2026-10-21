import { describe, expect, it } from 'vitest';
import { scenarioHeader, testBankConfig, testDeps } from '../../testing/helpers';
import { BETA_PATH, buildBetaServer } from './server';

// Expected values were computed independently (50-digit Decimal), never by this code.

function betaRequest(overrides: Record<string, unknown> = {}) {
  return {
    borrower_cpf: '52998224725',
    borrower_birth_date: '1985-04-12',
    employment_type: 'public_servant',
    employer_cnpj: '12ABC34501DE35',
    net_salary: '5000.00',
    requested_amount: '10000.00',
    term_months: 48,
    ...overrides,
  };
}

function setup(config = testBankConfig, random?: () => number) {
  const deps = testDeps(random);
  const app = buildBetaServer({ ...deps, config });
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: BETA_PATH, payload: payload as object, headers });
  return { app, post, sleep: deps.sleep };
}

describe('Banco Beta', () => {
  describe('approval rules', () => {
    it('approves a public servant in full at 1.59% (R$ 299,42 per month)', async () => {
      const response = await setup().post(betaRequest());

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        result_code: 0,
        result_message: 'APROVADO',
        proposal: {
          approved_amount: '10000.00',
          term_months: 48,
          monthly_rate_pct: '1.59',
          installment_amount: '299.42',
        },
      });
    });

    it('charges 1.66% for INSS retirees (R$ 303,88 per month)', async () => {
      const response = await setup().post(betaRequest({ employment_type: 'inss_retiree' }));

      expect(response.json()).toMatchObject({
        result_code: 0,
        proposal: { monthly_rate_pct: '1.66', installment_amount: '303.88' },
      });
    });

    it('makes a counter-offer when the installment exceeds the 35% margin', async () => {
      // Net R$ 700,00 -> margin R$ 245,00; R$ 10.000 would cost R$ 299,42.
      const response = await setup().post(betaRequest({ net_salary: '700.00' }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        result_code: 1,
        result_message: 'APROVADO PARCIAL',
        proposal: {
          approved_amount: '8182.55',
          term_months: 48,
          monthly_rate_pct: '1.59',
          installment_amount: '245.00',
        },
      });
    });

    it('still counter-offers when the best amount is just above R$ 1.000,00', async () => {
      // Net R$ 85,55 -> margin R$ 29,94 -> best amount R$ 1.000,08.
      const response = await setup().post(betaRequest({ net_salary: '85.55' }));

      expect(response.json()).toMatchObject({
        result_code: 1,
        proposal: { approved_amount: '1000.08', installment_amount: '29.94' },
      });
    });

    it('rejects with R01 when the best amount is below R$ 1.000,00', async () => {
      // Net R$ 85,52 -> margin R$ 29,93 -> best amount R$ 999,75.
      const response = await setup().post(betaRequest({ net_salary: '85.52' }));

      expect(response.json()).toEqual({
        result_code: 2,
        result_message: 'MARGEM INSUFICIENTE',
        reason_code: 'R01',
      });
    });

    it.each([
      ['a CLT worker', betaRequest({ employment_type: 'clt' })],
      ['a missing employment type', { ...betaRequest(), employment_type: undefined }],
    ])('rejects %s with R03', async (_, payload) => {
      const response = await setup().post(payload);

      expect(response.json()).toEqual({
        result_code: 2,
        result_message: 'VINCULO NAO ATENDIDO',
        reason_code: 'R03',
      });
    });

    it('rejects a borrower older than 80 with R02', async () => {
      const response = await setup().post(betaRequest({ borrower_birth_date: '1945-01-01' }));

      expect(response.json()).toMatchObject({ result_code: 2, reason_code: 'R02' });
    });
  });

  describe('input validation (400 in Beta format)', () => {
    it.each([
      ['money as a number (no type coercion)', betaRequest({ net_salary: 5000 })],
      ['money without cents', betaRequest({ requested_amount: '10000' })],
      ['money with a comma', betaRequest({ requested_amount: '10000,00' })],
      ['term as a string', betaRequest({ term_months: '48' })],
      ['an unknown employment type', betaRequest({ employment_type: 'CLT' })],
      ['an unknown field', betaRequest({ channel: 'app' })],
    ])('rejects %s', async (_, payload) => {
      const response = await setup().post(payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ result_code: 99, result_message: 'REQUISICAO INVALIDA' });
    });

    it('rejects an unknown scenario header', async () => {
      const response = await setup().post(betaRequest(), scenarioHeader('chaos'));

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ result_code: 99, result_message: 'REQUISICAO INVALIDA' });
    });
  });

  describe('forced scenarios', () => {
    it('"ok" ignores the random failure draw', async () => {
      const { post } = setup({ ...testBankConfig, failureRate: 1 }, () => 0);

      expect((await post(betaRequest(), scenarioHeader('ok'))).json()).toMatchObject({
        result_code: 0,
      });
    });

    it('"timeout" waits MOCK_TIMEOUT_DELAY_MS before answering normally', async () => {
      const { post, sleep } = setup();
      const response = await post(betaRequest(), scenarioHeader('timeout'));

      expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
      expect(response.json()).toMatchObject({ result_code: 0 });
    });

    it('"error" answers 502 with an HTML body from the proxy', async () => {
      const response = await setup().post(betaRequest(), scenarioHeader('error'));

      expect(response.statusCode).toBe(502);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.body).toContain('Bad Gateway');
    });

    it('"malformed" declares JSON but sends an unparseable body', async () => {
      const response = await setup().post(betaRequest(), scenarioHeader('malformed'));

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(() => JSON.parse(response.body)).toThrow(SyntaxError);
    });

    it('"invalid-shape" sends valid JSON with the wrong types', async () => {
      const response = await setup().post(betaRequest(), scenarioHeader('invalid-shape'));

      expect(response.json()).toEqual({
        result_code: '0',
        proposal: { approved_amount: 10000, term_months: '48' },
      });
    });
  });

  it('fails with 502 when the random draw falls under BETA_FAILURE_RATE', async () => {
    const { post } = setup({ ...testBankConfig, failureRate: 0.05 }, () => 0.01);

    expect((await post(betaRequest())).statusCode).toBe(502);
  });
});
