import { STALE_CONSENT_MESSAGE, simulationViewSchema } from '@simulador/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { CreateSimulation } from '../../application/create-simulation';
import { GetSimulation } from '../../application/get-simulation';
import { InMemorySimulationRepository } from '../../infra/persistence/in-memory-simulation-repository';
import { CUSTOMER } from '../../testing/bank-fixtures';
import { fakeStarter, T0 } from '../../testing/simulation-fixtures';
import { buildApp } from '../app';
import { HTTP_MESSAGES } from '../errors';
import { createLogger } from '../logger-options';

const FRONT = 'http://localhost:5173';
// What the form sends: masked documents, as typed by the customer.
const BODY = { ...CUSTOMER, cpf: '529.982.247-25', employerCnpj: '12.ABC.345/01DE-35' };

let closeApp: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeApp?.();
  closeApp = undefined;
});

async function setup(
  options: { postMax?: number; accepting?: boolean; failingGet?: boolean } = {},
) {
  const lines: string[] = [];
  const logger = createLogger('info', { write: (line: string) => lines.push(line) });
  const repository = new InMemorySimulationRepository();
  const clock = { now: () => T0.getTime() };
  const getSimulation = new GetSimulation({ repository, clock, pendingTtlMs: 22_000 });
  const app = await buildApp({
    logger,
    corsOrigins: [FRONT],
    trustProxy: false,
    rateLimit: { postMax: options.postMax ?? 100, getMax: 1_000, windowMs: 60_000 },
    createSimulation: new CreateSimulation({
      repository,
      starter: fakeStarter(options.accepting ?? true),
      clock,
      generateId: () => crypto.randomUUID(),
      marginPolicy: { percent: 35, referenceMonthlyRate: 0.018 },
    }),
    getSimulation: options.failingGet
      ? { execute: () => Promise.reject(new Error('db exploded at /secret/path')) }
      : getSimulation,
  });
  closeApp = () => app.close();
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/simulations', payload: payload as object, headers });
  return { app, post, repository, lines };
}

describe('POST /simulations', () => {
  it('answers 202 with the id, a Location header and no-store', async () => {
    const { post, repository } = await setup();
    const response = await post(BODY);

    expect(response.statusCode).toBe(202);
    const { id } = response.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.location).toBe(`/simulations/${id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await repository.findById(id)).toBeDefined();
  });

  it('answers 400 with Portuguese messages per field', async () => {
    const { post } = await setup();
    const response = await post({
      ...BODY,
      cpf: '529.982.247-26',
      installments: 120,
      consent: false,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: 'Dados inválidos.',
      errors: {
        cpf: ['CPF inválido'],
        installments: ['Máximo de 96 parcelas'],
        consent: ['É necessário autorizar a consulta aos bancos'],
      },
    });
  });

  it('answers 400 asking to reload when the form showed an older consent text', async () => {
    const { post } = await setup();
    const response = await post({ ...BODY, consentVersion: '2026-09-v1' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: 'Dados inválidos.',
      errors: { consentVersion: [STALE_CONSENT_MESSAGE] },
    });
  });

  it.each([
    [
      'a JSON body that is not an object',
      '[]',
      'application/json',
      400,
      HTTP_MESSAGES.INVALID_BODY,
    ],
    ['malformed JSON', '{"cpf":', 'application/json', 400, HTTP_MESSAGES.INVALID_BODY],
    // Fastify parses text/plain into a string, which the schema rejects as "not an object".
    ['a plain-text body', 'cpf=1', 'text/plain', 400, HTTP_MESSAGES.INVALID_BODY],
    [
      'a content type with no parser',
      '<cpf/>',
      'application/xml',
      415,
      HTTP_MESSAGES.UNSUPPORTED_MEDIA_TYPE,
    ],
  ])('answers %s with a Portuguese message', async (_, payload, contentType, status, message) => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/simulations',
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ message });
  });

  it('answers 503 while the API is shutting down', async () => {
    const response = await (await setup({ accepting: false })).post(BODY);

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toEqual({ message: HTTP_MESSAGES.SHUTTING_DOWN });
  });

  it('limits the request rate with a Portuguese message', async () => {
    const { post } = await setup({ postMax: 2 });
    await post(BODY);
    await post(BODY);
    const third = await post(BODY);

    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ message: HTTP_MESSAGES.RATE_LIMITED });
  });

  it('logs the simulationId and no personal data', async () => {
    const { post, lines } = await setup();
    const { id } = (await post(BODY)).json<{ id: string }>();

    const logs = lines.join('\n');
    expect(logs).toContain(`"simulationId":"${id}"`);
    for (const value of [
      '52998224725',
      '529.982.247-25',
      'Maria',
      'Sauro',
      CUSTOMER.email,
      '734219',
    ]) {
      expect(logs).not.toContain(value);
    }
  });
});

describe('GET /simulations/:id', () => {
  it('returns the view, valid against the shared schema, with no-store', async () => {
    const { app, post } = await setup();
    const { id } = (await post(BODY)).json<{ id: string }>();

    const response = await app.inject({ method: 'GET', url: `/simulations/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(simulationViewSchema.parse(response.json())).toMatchObject({ id, status: 'PROCESSING' });
  });

  it.each([
    ['an unknown id', '3f0e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b'],
    ['a malformed id', 'not-a-uuid'],
  ])('answers 404 for %s, with the same body', async (_, id) => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: `/simulations/${id}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: HTTP_MESSAGES.NOT_FOUND });
  });

  it('answers 500 with a generic message and no internals', async () => {
    const { app } = await setup({ failingGet: true });
    const response = await app.inject({
      method: 'GET',
      url: '/simulations/3f0e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: HTTP_MESSAGES.INTERNAL });
    expect(response.body).not.toContain('secret');
  });
});

describe('cross-cutting HTTP behavior', () => {
  it('answers 404 in Portuguese for an unknown route', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/admin' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: HTTP_MESSAGES.ROUTE_NOT_FOUND });
  });

  it('allows CORS only for the front origin', async () => {
    const { app } = await setup();
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/simulations',
        headers: { origin, 'access-control-request-method': 'POST' },
      });

    expect((await preflight(FRONT)).headers['access-control-allow-origin']).toBe(FRONT);
    expect(
      (await preflight('https://evil.test')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('sends security headers (helmet)', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/simulations/x' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});
