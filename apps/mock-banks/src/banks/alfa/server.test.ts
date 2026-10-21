import { describe, expect, it } from 'vitest';
import { abortableSleep, type Sleep } from '../../runtime/sleep';
import { scenarioHeader, testBankConfig, testDeps } from '../../testing/helpers';
import type { AlfaRequest } from './contract';
import { ALFA_PATH, buildAlfaServer } from './server';

// Expected installments were computed independently (50-digit Decimal, closed formula
// cross-checked by a month-by-month amortization schedule), never by this code.

function alfaRequest(
  customer: Partial<AlfaRequest['customer']> = {},
  rest: Partial<AlfaRequest> = {},
) {
  return {
    customer: {
      taxId: '52998224725',
      birthDate: '1985-04-12',
      monthlyNetIncomeCents: 500_000,
      employmentType: 'CLT',
      ...customer,
    },
    employerTaxId: '12ABC34501DE35',
    requestedAmountCents: 1_000_000,
    installments: 48,
    ...rest,
  };
}

function setup(config = testBankConfig, random?: () => number) {
  const deps = testDeps(random);
  const app = buildAlfaServer({ ...deps, config });
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: ALFA_PATH, payload: payload as object, headers });
  return { app, post, sleep: deps.sleep };
}

describe('Banco Alfa', () => {
  describe('approval rules', () => {
    it('approves R$ 10.000 in 48x at 1.79% with an installment of R$ 312,24', async () => {
      const response = await setup().post(alfaRequest());

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        proposalId: expect.stringMatching(/^alfa-/),
        status: 'APPROVED',
        offer: {
          approvedAmountCents: 1_000_000,
          installments: 48,
          monthlyInterestRate: 0.0179,
          installmentAmountCents: 31_224,
        },
      });
    });

    it('approves when the installment equals the 30% margin exactly', async () => {
      const response = await setup().post(alfaRequest({ monthlyNetIncomeCents: 104_080 }));

      expect(response.json()).toMatchObject({ status: 'APPROVED' });
    });

    it('rejects when the margin is one cent short', async () => {
      const response = await setup().post(alfaRequest({ monthlyNetIncomeCents: 104_079 }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        proposalId: expect.stringMatching(/^alfa-/),
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_MARGIN',
      });
    });

    it.each([
      ['turns 21 tomorrow', '2005-10-22'],
      ['is 76', '1950-10-21'],
    ])('rejects a customer who %s', async (_, birthDate) => {
      const response = await setup().post(alfaRequest({ birthDate }));

      expect(response.json()).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'AGE_OUT_OF_RANGE',
      });
    });

    it('approves a customer who turns 21 today', async () => {
      const response = await setup().post(alfaRequest({ birthDate: '2005-10-21' }));

      expect(response.json()).toMatchObject({ status: 'APPROVED' });
    });

    it('rejects more than 84 installments', async () => {
      const response = await setup().post(alfaRequest({}, { installments: 96 }));

      expect(response.json()).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'TERM_NOT_ALLOWED',
      });
    });
  });

  describe('input validation (400 in Alfa format)', () => {
    it.each([
      ['a missing field', { ...alfaRequest(), employerTaxId: undefined }],
      [
        'cents sent as a string (no type coercion)',
        alfaRequest({}, { requestedAmountCents: '1000000' as never }),
      ],
      ['fractional cents', alfaRequest({ monthlyNetIncomeCents: 5000.5 })],
      ['an unknown field (not silently removed)', { ...alfaRequest(), promoCode: 'X' }],
      ['an impossible date', alfaRequest({ birthDate: '1985-02-30' })],
      ['a lowercase CNPJ', alfaRequest({}, { employerTaxId: '12abc34501de35' })],
    ])('rejects %s', async (_, payload) => {
      const response = await setup().post(payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'INVALID_REQUEST', message: expect.any(String) },
      });
    });

    it('rejects a body that is not valid JSON', async () => {
      const { app } = setup();
      const response = await app.inject({
        method: 'POST',
        url: ALFA_PATH,
        headers: { 'content-type': 'application/json' },
        payload: '{"customer":',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    });

    it('rejects an unknown scenario header', async () => {
      const response = await setup().post(alfaRequest(), scenarioHeader('chaos'));

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    });
  });

  describe('forced scenarios', () => {
    it('"ok" ignores the random failure draw', async () => {
      const { post } = setup({ ...testBankConfig, failureRate: 1 }, () => 0);
      const response = await post(alfaRequest(), scenarioHeader('ok'));

      expect(response.json()).toMatchObject({ status: 'APPROVED' });
    });

    it('"timeout" waits MOCK_TIMEOUT_DELAY_MS before answering normally', async () => {
      const { post, sleep } = setup();
      const response = await post(alfaRequest(), scenarioHeader('timeout'));

      expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
      expect(response.json()).toMatchObject({ status: 'APPROVED' });
    });

    it('"error" answers 500 in Alfa format', async () => {
      const response = await setup().post(alfaRequest(), scenarioHeader('error'));

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    });

    it('"malformed" declares JSON but sends an unparseable body', async () => {
      const response = await setup().post(alfaRequest(), scenarioHeader('malformed'));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(() => JSON.parse(response.body)).toThrow(SyntaxError);
    });

    it('"invalid-shape" sends valid JSON outside the contract', async () => {
      const response = await setup().post(alfaRequest(), scenarioHeader('invalid-shape'));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'MAYBE', offer: null });
    });
  });

  describe('random behavior (no header)', () => {
    it('fails with 500 when the draw falls under ALFA_FAILURE_RATE', async () => {
      const { post } = setup({ ...testBankConfig, failureRate: 0.5 }, () => 0.2);

      expect((await post(alfaRequest())).statusCode).toBe(500);
    });

    it('answers normally when the draw is above the failure rate', async () => {
      const { post } = setup({ ...testBankConfig, failureRate: 0.5 }, () => 0.7);

      expect((await post(alfaRequest())).statusCode).toBe(200);
    });

    it('waits a latency inside the configured range', async () => {
      const { post, sleep } = setup(
        { ...testBankConfig, latency: { minMs: 100, maxMs: 200 } },
        () => 0.5,
      );
      await post(alfaRequest());

      expect(sleep).toHaveBeenCalledWith(150, expect.any(AbortSignal));
    });
  });

  it('cancels a pending "timeout" wait when the server closes', async () => {
    let markSleeping!: () => void;
    const sleeping = new Promise<void>((resolve) => (markSleeping = resolve));
    const sleep: Sleep = (ms, signal) => {
      markSleeping();
      return abortableSleep(ms, signal);
    };
    const app = buildAlfaServer({ ...testDeps(), sleep, config: testBankConfig });

    const startedAt = Date.now();
    const pending = app.inject({
      method: 'POST',
      url: ALFA_PATH,
      payload: alfaRequest(),
      headers: scenarioHeader('timeout'),
    });
    await sleeping;
    await app.close();
    const response = await pending;

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
  });
});
