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
import type { HttpOutcome, HttpSender } from '../../http/resilient-http-client';
import { ResilientHttpClient } from '../../http/resilient-http-client';
import { createAlfaAdapter } from '../alfa/alfa-adapter';
import { createBetaAdapter } from '../beta/beta-adapter';

// Behavior shared by every adapter, exercised through Alfa.

function alfaWith(outcome: HttpOutcome, extraHeaders: Record<string, string> = {}) {
  const capture = createCaptureLogger();
  const { sender, requests } = fixedSender(outcome);
  const adapter = createAlfaAdapter({
    endpoint: endpointFor('alfa', { extraHeaders }),
    client: sender,
    logger: capture.logger,
  });
  const simulate = () => adapter.simulate(CUSTOMER, new AbortController().signal, CONTEXT);
  return { simulate, requests, capture };
}

const failure = (reason: 'TIMEOUT' | 'NETWORK' | 'CIRCUIT_OPEN' | 'ABORTED'): HttpOutcome => ({
  kind: 'failure',
  reason,
  attempts: reason === 'CIRCUIT_OPEN' ? 0 : 3,
  elapsedMs: 2_999.6,
});

describe('bank adapter (common behavior)', () => {
  describe('request', () => {
    it('POSTs JSON to the bank path with an Idempotency-Key of simulationId:bankId', async () => {
      const { simulate, requests } = alfaWith(jsonResponse({}), { 'x-mock-scenario': 'ok' });
      await simulate();

      expect(requests[0]?.url).toBe('http://bank-alfa.test/v1/loan-simulations');
      expect(requests[0]?.headers).toEqual({
        'x-mock-scenario': 'ok',
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': 'sim-42:alfa',
      });
    });

    it('sends the same Idempotency-Key on every retry of the call (real client)', async () => {
      const clock = new FakeClock();
      const approved = {
        result_code: 0,
        proposal: {
          approved_amount: '10000.00',
          term_months: 48,
          monthly_rate_pct: '1.59',
          installment_amount: '299.42',
        },
      };
      const fake = createFakeFetch(
        [{ status: 503 }, { status: 503 }, { status: 200, body: JSON.stringify(approved) }],
        clock,
      );
      const client = new ResilientHttpClient(
        {
          timeoutMs: 6_000,
          attemptTimeoutMs: 2_500,
          maxAttempts: 3,
          baseDelayMs: 200,
          maxDelayMs: 2_000,
          breaker: { failureThreshold: 5, openMs: 30_000 },
        },
        { fetch: fake.fetch, clock, random: () => 0.5 },
      );
      const beta = createBetaAdapter({
        endpoint: endpointFor('beta'),
        client,
        logger: createCaptureLogger().logger,
      });

      const result = await clock.run(
        beta.simulate(CUSTOMER, new AbortController().signal, CONTEXT),
      );

      expect(result).toMatchObject({ status: 'APPROVED', attempts: 3 });
      expect(fake.requests.map((request) => request.headers.get('idempotency-key'))).toEqual([
        'sim-42:beta',
        'sim-42:beta',
        'sim-42:beta',
      ]);
    });
  });

  describe('UNAVAILABLE: the bank did not answer', () => {
    it.each([
      ['TIMEOUT', 'O banco não respondeu a tempo.'],
      ['NETWORK', 'Não foi possível conectar ao banco.'],
      ['CIRCUIT_OPEN', 'O banco está temporariamente indisponível.'],
      ['ABORTED', 'A consulta foi cancelada.'],
    ] as const)('%s', async (reason, message) => {
      const result = await alfaWith(failure(reason)).simulate();

      expect(result).toEqual({
        bankId: 'alfa',
        status: 'UNAVAILABLE',
        reason: message,
        latencyMs: 3_000,
        attempts: reason === 'CIRCUIT_OPEN' ? 0 : 3,
      });
    });

    it.each([502, 503, 504])('%i after retries', async (status) => {
      const result = await alfaWith(jsonResponse('<html>Bad Gateway</html>', status)).simulate();

      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'O banco está temporariamente indisponível.',
      });
    });
  });

  describe('ERROR: the bank answered something wrong', () => {
    it('400 is our bug: ERROR plus a high-level alert log', async () => {
      const { simulate, capture } = alfaWith(
        jsonResponse({ error: { code: 'INVALID_REQUEST' } }, 400),
      );

      expect(await simulate()).toMatchObject({
        status: 'ERROR',
        reason: 'Não foi possível processar a consulta neste banco.',
      });
      expect(capture.entries()).toContainEqual(
        expect.objectContaining({ level: 50, alert: 'BANK_REJECTED_OUR_REQUEST', bankId: 'alfa' }),
      );
    });

    it('500', async () => {
      expect(await alfaWith(jsonResponse({}, 500)).simulate()).toMatchObject({
        status: 'ERROR',
        reason: 'O banco encontrou um erro interno.',
      });
    });

    it.each([302, 404, 415])('unexpected status %i', async (status) => {
      expect(await alfaWith(jsonResponse('', status)).simulate()).toMatchObject({
        status: 'ERROR',
        reason: 'O banco retornou uma resposta inesperada.',
      });
    });

    it('malformed JSON', async () => {
      const { simulate, capture } = alfaWith(jsonResponse('{"proposalId":"alfa-1","status":"APPR'));

      expect(await simulate()).toMatchObject({
        status: 'ERROR',
        reason: 'O banco retornou uma resposta inválida.',
      });
      expect(capture.entries()).toContainEqual(
        expect.objectContaining({ level: 50, msg: 'bank sent malformed JSON' }),
      );
    });

    it('logs only the paths of contract violations', async () => {
      const { simulate, capture } = alfaWith(jsonResponse({ proposalId: 'a', status: 'MAYBE' }));
      await simulate();

      expect(capture.entries()).toContainEqual(
        expect.objectContaining({ issues: [{ path: 'status', code: 'invalid_union' }] }),
      );
    });

    it('never rejects, even if the HTTP client throws', async () => {
      const sender: HttpSender = { send: () => Promise.reject(new Error('boom')) };
      const adapter = createAlfaAdapter({
        endpoint: endpointFor('alfa'),
        client: sender,
        logger: createCaptureLogger().logger,
      });

      await expect(
        adapter.simulate(CUSTOMER, new AbortController().signal, CONTEXT),
      ).resolves.toMatchObject({ status: 'ERROR' });
    });
  });
});
