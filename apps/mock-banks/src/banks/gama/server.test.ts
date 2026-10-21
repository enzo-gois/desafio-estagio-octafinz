import { describe, expect, it } from 'vitest';
import type { GamaRuntimeConfig } from '../../config';
import { scenarioHeader, testBankConfig, testDeps } from '../../testing/helpers';
import { buildGamaServer, GAMA_PATH } from './server';

// Expected values were computed independently (50-digit Decimal), never by this code.

const RESTRICTED_CNPJ = '11222333000181';

const testGamaConfig: GamaRuntimeConfig = {
  ...testBankConfig,
  malformedRate: 0,
  restrictedCnpjs: new Set([RESTRICTED_CNPJ]),
};

function gamaRequest(
  overrides: {
    dateOfBirth?: string;
    cnpj?: string;
    netMonthly?: unknown;
    amount?: unknown;
    termMonths?: unknown;
  } = {},
) {
  return {
    applicant: { cpf: '52998224725', dateOfBirth: overrides.dateOfBirth ?? '1985-04-12' },
    employer: { cnpj: overrides.cnpj ?? '12ABC34501DE35' },
    income: { netMonthly: overrides.netMonthly ?? 5000.0 },
    loan: { amount: overrides.amount ?? 10000.0, termMonths: overrides.termMonths ?? 48 },
  };
}

function setup(config: GamaRuntimeConfig = testGamaConfig, random?: () => number) {
  const deps = testDeps(random);
  const app = buildGamaServer({ ...deps, config });
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: GAMA_PATH, payload: payload as object, headers });
  return { app, post, sleep: deps.sleep };
}

describe('Banco Gama', () => {
  describe('approval rules', () => {
    it('accepts R$ 10.000 in 48x at 2.05% with a payment of R$ 329,34', async () => {
      const response = await setup().post(gamaRequest());

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        decision: 'ACCEPT',
        terms: { principal: 10000, months: 48, ratePercent: 2.05, monthlyPayment: 329.34 },
      });
    });

    it('uses 1.89% for terms up to 36 months (R$ 385,43 per month)', async () => {
      const response = await setup().post(gamaRequest({ termMonths: 36 }));

      expect(response.json()).toMatchObject({
        decision: 'ACCEPT',
        terms: { months: 36, ratePercent: 1.89, monthlyPayment: 385.43 },
      });
    });

    it('declines a restricted employer', async () => {
      const response = await setup().post(gamaRequest({ cnpj: RESTRICTED_CNPJ }));

      expect(response.json()).toEqual({
        decision: 'DECLINE',
        declineReasons: ['EMPLOYER_RESTRICTED'],
      });
    });

    it('declines when the borrower would be 81 at the last installment', async () => {
      // 48 months from 2026-10-21 is 2030-10-21, the 81st birthday.
      const response = await setup().post(gamaRequest({ dateOfBirth: '1949-10-21' }));

      expect(response.json()).toEqual({
        decision: 'DECLINE',
        declineReasons: ['AGE_AT_MATURITY_EXCEEDED'],
      });
    });

    it('accepts when the borrower would be 80 at the last installment', async () => {
      const response = await setup().post(gamaRequest({ dateOfBirth: '1949-10-22' }));

      expect(response.json()).toMatchObject({ decision: 'ACCEPT' });
    });

    it('declines when the payment exceeds the 35% margin', async () => {
      // Net R$ 900,00 -> margin R$ 315,00 < R$ 329,34.
      const response = await setup().post(gamaRequest({ netMonthly: 900 }));

      expect(response.json()).toEqual({
        decision: 'DECLINE',
        declineReasons: ['INSUFFICIENT_MARGIN'],
      });
    });

    it('reports every failed rule at once', async () => {
      const response = await setup().post(gamaRequest({ cnpj: RESTRICTED_CNPJ, netMonthly: 900 }));

      expect(response.json()).toEqual({
        decision: 'DECLINE',
        declineReasons: ['EMPLOYER_RESTRICTED', 'INSUFFICIENT_MARGIN'],
      });
    });
  });

  describe('input validation (400 in Gama format)', () => {
    it.each([
      ['an amount as a string (no type coercion)', gamaRequest({ amount: '10000' })],
      ['a zero income', gamaRequest({ netMonthly: 0 })],
      ['a fractional term', gamaRequest({ termMonths: 48.5 })],
      ['an unknown field', { ...gamaRequest(), employmentType: 'CLT' }],
    ])('rejects %s', async (_, payload) => {
      const response = await setup().post(payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Bad Request' });
    });

    it('rejects an unknown scenario header', async () => {
      const response = await setup().post(gamaRequest(), scenarioHeader('chaos'));

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Bad Request' });
    });
  });

  describe('forced scenarios', () => {
    it('"ok" ignores the random failure draw', async () => {
      const { post } = setup({ ...testGamaConfig, failureRate: 1 }, () => 0);

      expect((await post(gamaRequest(), scenarioHeader('ok'))).json()).toMatchObject({
        decision: 'ACCEPT',
      });
    });

    it('"timeout" waits MOCK_TIMEOUT_DELAY_MS before answering normally', async () => {
      const { post, sleep } = setup();
      const response = await post(gamaRequest(), scenarioHeader('timeout'));

      expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
      expect(response.json()).toMatchObject({ decision: 'ACCEPT' });
    });

    it('"error" answers 503 with Retry-After', async () => {
      const response = await setup().post(gamaRequest(), scenarioHeader('error'));

      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('2');
      expect(response.json()).toEqual({ message: 'Service temporarily unavailable' });
    });

    it('"malformed" declares JSON but sends an unparseable body', async () => {
      const response = await setup().post(gamaRequest(), scenarioHeader('malformed'));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(() => JSON.parse(response.body)).toThrow(SyntaxError);
    });

    it('"invalid-shape" sends valid JSON outside the contract', async () => {
      const response = await setup().post(gamaRequest(), scenarioHeader('invalid-shape'));

      expect(response.json()).toEqual({
        decision: 'ACCEPT',
        terms: { principal: '10000.00', months: 48 },
      });
    });
  });

  describe('random behavior (no header)', () => {
    const unstable = { ...testGamaConfig, failureRate: 0.2, malformedRate: 0.1 };

    it.each([
      [0.1, 503],
      [0.25, 200],
      [0.35, 200],
    ])('draw %f -> HTTP %i', async (roll, status) => {
      expect((await setup(unstable, () => roll).post(gamaRequest())).statusCode).toBe(status);
    });

    it('a draw between the failure and malformed rates returns a broken body', async () => {
      const response = await setup(unstable, () => 0.25).post(gamaRequest());

      expect(() => JSON.parse(response.body)).toThrow(SyntaxError);
    });
  });
});
