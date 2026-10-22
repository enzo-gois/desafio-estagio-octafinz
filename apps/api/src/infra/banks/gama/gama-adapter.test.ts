import { describe, expect, it } from 'vitest';
import {
  CONTEXT,
  CUSTOMER,
  endpointFor,
  fixedSender,
  jsonResponse,
} from '../../../testing/bank-fixtures';
import { createCaptureLogger } from '../../../testing/capture-logger';
import { FakeClock } from '../../../testing/fake-clock';
import { createFakeFetch } from '../../../testing/fake-fetch';
import { type HttpOutcome, ResilientHttpClient } from '../../http/resilient-http-client';
import { createGamaAdapter } from './gama-adapter';

function setup(outcome: HttpOutcome) {
  const capture = createCaptureLogger();
  const { sender, requests } = fixedSender(outcome);
  const adapter = createGamaAdapter({
    endpoint: endpointFor('gama'),
    client: sender,
    logger: capture.logger,
  });
  return {
    simulate: () => adapter.simulate(CUSTOMER, new AbortController().signal, CONTEXT),
    requests,
    capture,
  };
}

const accept = {
  decision: 'ACCEPT',
  terms: { principal: 10000, months: 48, ratePercent: 2.05, monthlyPayment: 329.34 },
};
const decline = (...declineReasons: string[]) => ({ decision: 'DECLINE', declineReasons });

describe('Gama adapter', () => {
  it('translates the input to nested camelCase with reais as numbers and no employment type', async () => {
    const { simulate, requests } = setup(jsonResponse(accept));
    await simulate();

    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({
      applicant: { cpf: '52998224725', dateOfBirth: '1985-04-12' },
      employer: { cnpj: '12ABC34501DE35' },
      income: { netMonthly: 7342.19 },
      loan: { amount: 10000, termMonths: 48 },
    });
  });

  it('maps ACCEPT to APPROVED, converting reais to cents and percent to a fraction', async () => {
    expect(await setup(jsonResponse(accept)).simulate()).toMatchObject({
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 2.05 / 100, // 0.020499999999999997: rates are compared in micro-units downstream
        installmentCents: 32_934,
      },
    });
  });

  it('joins every decline reason, in Portuguese, without repeating', async () => {
    const response = jsonResponse(
      decline('EMPLOYER_RESTRICTED', 'INSUFFICIENT_MARGIN', 'EMPLOYER_RESTRICTED'),
    );

    expect(await setup(response).simulate()).toMatchObject({
      status: 'DENIED',
      reason:
        'Empresa empregadora não atendida pelo banco. Margem consignável insuficiente para a parcela.',
    });
  });

  it('uses the generic reason once for unknown codes and logs each code', async () => {
    const { simulate, capture } = setup(
      jsonResponse(decline('AGE_AT_MATURITY_EXCEEDED', 'X_NEW', 'Y_NEW')),
    );

    expect(await simulate()).toMatchObject({
      reason: 'Idade ao fim do contrato acima do limite do banco. O banco não aprovou a simulação.',
    });
    const loggedCodes = capture
      .entries()
      .map((entry) => entry.reasonCode)
      .filter(Boolean);
    expect(loggedCodes).toEqual(['X_NEW', 'Y_NEW']);
  });

  it.each([
    ['malformed JSON', '{"decision":"ACCEPT","terms":{"principal":100'],
    [
      'invalid-shape (principal as string, no payment)',
      {
        decision: 'ACCEPT',
        terms: { principal: '10000.00', months: 48 },
      },
    ],
    [
      'money with more than 2 decimals',
      { ...accept, terms: { ...accept.terms, monthlyPayment: 329.345 } },
    ],
    ['an empty decline list', decline()],
    [
      'a rate sent as a fraction where percent is expected (>= 100%)',
      {
        ...accept,
        terms: { ...accept.terms, ratePercent: 205 },
      },
    ],
  ])('maps %s to ERROR', async (_, body) => {
    expect(await setup(jsonResponse(body)).simulate()).toMatchObject({
      status: 'ERROR',
      reason: 'O banco retornou uma resposta inválida.',
    });
  });

  it('maps a 400 to ERROR', async () => {
    expect(await setup(jsonResponse({ message: 'Bad Request' }, 400)).simulate()).toMatchObject({
      status: 'ERROR',
    });
  });

  it('honors Retry-After on a 503 and then accepts (real client)', async () => {
    const clock = new FakeClock();
    const fake = createFakeFetch(
      [
        { status: 503, headers: { 'retry-after': '2' }, body: '{"message":"x"}', delayMs: 3_000 },
        { status: 200, body: JSON.stringify(accept), delayMs: 2_500 },
      ],
      clock,
    );
    const client = new ResilientHttpClient(
      {
        timeoutMs: 12_000,
        attemptTimeoutMs: 7_000,
        maxAttempts: 3,
        baseDelayMs: 200,
        maxDelayMs: 2_000,
        breaker: { failureThreshold: 5, openMs: 30_000 },
      },
      { fetch: fake.fetch, clock, random: () => 0.5 },
    );
    const gama = createGamaAdapter({
      endpoint: endpointFor('gama'),
      client,
      logger: createCaptureLogger().logger,
    });

    const result = await clock.run(gama.simulate(CUSTOMER, new AbortController().signal, CONTEXT));

    // 3 s until the 503, 2 s of Retry-After, 2.5 s until the answer.
    expect(result).toMatchObject({ status: 'APPROVED', attempts: 2, latencyMs: 7_500 });
    expect(clock.sleeps).toContain(2_000);
  });
});
