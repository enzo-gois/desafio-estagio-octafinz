import {
  STALE_CONSENT_MESSAGE,
  simulationInputSchema,
  simulationViewSchema,
} from '@simulador/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFakeFetch, type FakeReply } from '../testing/fake-fetch';
import { BANK_CATALOG, INPUT, SIMULATION_ID, simulationView } from '../testing/fixtures';
import { type ApiClient, createApiClient } from './client';
import { API_MESSAGES } from './messages';

function setup(...replies: FakeReply[]) {
  const fake = createFakeFetch(replies);
  return { api: createApiClient({ baseUrl: '/api', fetch: fake.fetch }), requests: fake.requests };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({
  status,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...headers },
});

// What nginx or another proxy sends: a page, not the API's JSON.
const html = (status: number, headers: Record<string, string> = {}): FakeReply => ({
  status,
  body: '<html><body><h1>Bad Gateway</h1></body></html>',
  headers: { 'content-type': 'text/html', ...headers },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSimulation', () => {
  it('posts the input as JSON and returns the id', async () => {
    const { api, requests } = setup(json(202, { id: SIMULATION_ID }));

    expect(await api.createSimulation(INPUT)).toEqual({ kind: 'ok', data: { id: SIMULATION_ID } });
    const [request] = requests;
    expect(request).toMatchObject({ url: '/api/simulations', method: 'POST' });
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(request?.body ?? '')).toEqual(INPUT);
  });

  it('returns the field errors of a 400 in the z.flattenError format', async () => {
    // The API builds its 400 with z.flattenError: the form gets the same shape it builds itself.
    const invalid = simulationInputSchema.safeParse({ ...INPUT, cpf: '529.982.247-26' });
    const { fieldErrors } = z.flattenError(invalid.error ?? new z.ZodError([]));
    const { api } = setup(json(400, { message: 'Dados inválidos.', errors: fieldErrors }));

    expect(await api.createSimulation(INPUT)).toEqual({
      kind: 'validation',
      message: 'Dados inválidos.',
      fieldErrors: { cpf: ['CPF inválido'] },
      formErrors: [],
    });
  });

  it('keeps the message of a 400 without field errors', async () => {
    const { api } = setup(json(400, { message: 'Corpo da requisição inválido.', errors: {} }));

    expect(await api.createSimulation(INPUT)).toEqual({
      kind: 'validation',
      message: 'Corpo da requisição inválido.',
      fieldErrors: {},
      formErrors: [],
    });
  });

  it('brings an outdated consent version as a general message, not a field error', async () => {
    // The form has no input for consentVersion: as a field error it would never be seen, and the
    // customer would keep clicking "submit" without knowing that the page must be reloaded.
    const errors = { consentVersion: [STALE_CONSENT_MESSAGE] };
    const { api } = setup(json(400, { message: 'Dados inválidos.', errors }));

    expect(await api.createSimulation(INPUT)).toEqual({
      kind: 'validation',
      message: 'Dados inválidos.',
      fieldErrors: {},
      formErrors: [STALE_CONSENT_MESSAGE],
    });
  });

  it('brings errors of fields the form does not have as general messages', async () => {
    const errors = { cpf: ['CPF inválido'], role: ['Campo desconhecido'] };
    const { api } = setup(json(400, { message: 'Dados inválidos.', errors }));

    expect(await api.createSimulation(INPUT)).toEqual({
      kind: 'validation',
      message: 'Dados inválidos.',
      fieldErrors: { cpf: ['CPF inválido'] },
      formErrors: ['Campo desconhecido'],
    });
  });

  it.each([
    ['a 400 without the API body', html(400), '400 without the API validation body'],
    ['a 404 (no such route: misconfigured API URL)', json(404, { message: 'x' }), 'HTTP 404'],
    [
      'a 202 with a body outside the schema',
      json(202, { id: 'not-a-uuid' }),
      'outside the shared schema',
    ],
  ])('treats %s as unexpected', async (_, reply, detail) => {
    const { api } = setup(reply);

    expect(await api.createSimulation(INPUT)).toEqual({
      kind: 'unexpected',
      message: API_MESSAGES.UNEXPECTED,
      detail: expect.stringContaining(detail),
    });
  });
});

describe('getSimulation', () => {
  it('returns the view, read without the browser cache', async () => {
    const view = simulationView();
    const { api, requests } = setup(json(200, view));

    expect(await api.getSimulation(SIMULATION_ID)).toEqual({ kind: 'ok', data: view });
    expect(requests[0]).toMatchObject({
      url: `/api/simulations/${SIMULATION_ID}`,
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('answers a 404 with the local "not found or expired" message', async () => {
    const { api } = setup(json(404, { message: 'Simulação não encontrada.' }));

    expect(await api.getSimulation(SIMULATION_ID)).toEqual({
      kind: 'not-found',
      message: 'Simulação não encontrada ou expirada.',
    });
  });

  it('encodes the id, so it cannot point the request at another route', async () => {
    const { api, requests } = setup(json(404, {}));
    await api.getSimulation('../banks?x=1');

    expect(requests[0]?.url).toBe('/api/simulations/..%2Fbanks%3Fx%3D1');
  });

  it.each([
    ['a view with extra data', json(200, { ...simulationView(), marginCents: 175_000 }), 'schema'],
    ['a 400 (only the POST validates)', json(400, { message: 'x', errors: {} }), 'HTTP 400'],
  ])('treats %s as unexpected', async (_, reply, detail) => {
    const { api } = setup(reply);

    expect(await api.getSimulation(SIMULATION_ID)).toMatchObject({
      kind: 'unexpected',
      detail: expect.stringContaining(detail),
    });
  });

  it('uses a fixture valid against the shared schema', () => {
    expect(simulationViewSchema.safeParse(simulationView()).success).toBe(true);
  });
});

describe('getBanks', () => {
  it('returns the bank catalog', async () => {
    const { api, requests } = setup(json(200, BANK_CATALOG));

    expect(await api.getBanks()).toEqual({ kind: 'ok', data: BANK_CATALOG });
    expect(requests[0]).toMatchObject({ url: '/api/banks', method: 'GET', cache: 'no-store' });
  });
});

// Outcomes every endpoint shares, checked on all three.
const CALLS: Record<string, (api: ApiClient, signal?: AbortSignal) => Promise<unknown>> = {
  'POST /simulations': (api, signal) => api.createSimulation(INPUT, signal),
  'GET /simulations/:id': (api, signal) => api.getSimulation(SIMULATION_ID, signal),
  'GET /banks': (api, signal) => api.getBanks(signal),
};

describe.each(Object.entries(CALLS))('%s', (_, call) => {
  describe('rate limit and unavailability', () => {
    it("returns 429 as rate-limited with the API's message and Retry-After", async () => {
      const { api } = setup(json(429, { message: 'Muitas requisições.' }, { 'retry-after': '30' }));

      expect(await call(api)).toEqual({
        kind: 'rate-limited',
        message: 'Muitas requisições.',
        retryAfterMs: 30_000,
      });
    });

    it('returns a 429 page from a proxy as rate-limited with the local message', async () => {
      const { api } = setup(html(429));

      expect(await call(api)).toEqual({
        kind: 'rate-limited',
        message: API_MESSAGES.RATE_LIMITED,
        retryAfterMs: undefined,
      });
    });

    it('returns 503 from the API as unavailable with its message and Retry-After', async () => {
      const message = 'O serviço está reiniciando. Tente novamente em instantes.';
      const { api } = setup(json(503, { message }, { 'retry-after': '5' }));

      expect(await call(api)).toEqual({ kind: 'unavailable', message, retryAfterMs: 5_000 });
    });

    it.each([502, 503, 504])(
      'returns a %i page from a proxy as unavailable with the local message',
      async (status) => {
        const { api } = setup(html(status, { 'retry-after': '10' }));

        expect(await call(api)).toEqual({
          kind: 'unavailable',
          message: API_MESSAGES.UNAVAILABLE,
          retryAfterMs: 10_000,
        });
      },
    );

    it.each([
      ['an HTTP-date (compared with a clock that may be wrong)', 'Fri, 23 Oct 2026 12:00:05 GMT'],
      ['a negative number', '-5'],
      ['a fraction', '1.5'],
    ])('ignores a Retry-After with %s', async (_, retryAfter) => {
      const { api } = setup(json(503, { message: 'x' }, { 'retry-after': retryAfter }));

      expect(await call(api)).toMatchObject({ kind: 'unavailable', retryAfterMs: undefined });
    });
  });

  describe('unexpected answers', () => {
    it.each([
      ['a 500', json(500, { message: 'Erro interno. Tente novamente.' }), 'HTTP 500'],
      ['a 200 HTML page (proxy serving the SPA for /api)', html(200), 'not JSON'],
    ])('treats %s as unexpected, with a local message', async (_, reply, detail) => {
      const { api } = setup(reply);

      expect(await call(api)).toEqual({
        kind: 'unexpected',
        message: API_MESSAGES.UNEXPECTED,
        detail: expect.stringContaining(detail),
      });
    });
  });

  describe('network, cancellation and timeout', () => {
    it('returns network when fetch fails', async () => {
      const { api } = setup({ networkError: true });

      expect(await call(api)).toEqual({ kind: 'network', message: API_MESSAGES.NETWORK });
    });

    it('returns aborted, not network, when the caller cancels while waiting', async () => {
      const { api, requests } = setup({ hang: true });
      const controller = new AbortController();
      const pending = call(api, controller.signal);
      controller.abort();

      expect(await pending).toEqual({ kind: 'aborted' });
      expect(requests[0]?.signal?.aborted).toBe(true);
    });

    it('returns aborted for a signal cancelled before the call', async () => {
      const { api } = setup(json(200, BANK_CATALOG));
      const controller = new AbortController();
      controller.abort();

      expect(await call(api, controller.signal)).toEqual({ kind: 'aborted' });
    });

    it('returns nothing but aborted once the caller cancelled, even if the answer arrived', async () => {
      const controller = new AbortController();
      // The response is in, the body still being read, when the component unmounts.
      const { api } = setup({ ...json(200, BANK_CATALOG), whileReading: () => controller.abort() });

      expect(await call(api, controller.signal)).toEqual({ kind: 'aborted' });
    });

    it('returns network with the timeout message after 10 s without an answer', async () => {
      vi.useFakeTimers();
      const { api } = setup({ hang: true });
      let settled = false;
      const pending = call(api).finally(() => (settled = true));

      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ kind: 'network', message: API_MESSAGES.TIMEOUT });
    });

    it('returns aborted when the caller cancels as the timeout fires', async () => {
      vi.useFakeTimers();
      const { api, requests } = setup({ hang: true });
      const controller = new AbortController();
      const pending = call(api, controller.signal);
      // Runs the moment the timeout aborts the request: both have happened when the call ends.
      requests[0]?.signal?.addEventListener('abort', () => controller.abort());

      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ kind: 'aborted' });
    });

    it('times out a body that never ends', async () => {
      vi.useFakeTimers();
      const { api } = setup({ hangBody: true, status: 200 });
      const pending = call(api);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ kind: 'network', message: API_MESSAGES.TIMEOUT });
    });

    it('leaves no timer behind once the call is over', async () => {
      vi.useFakeTimers();
      const { api } = setup(json(200, BANK_CATALOG));
      await call(api);

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
