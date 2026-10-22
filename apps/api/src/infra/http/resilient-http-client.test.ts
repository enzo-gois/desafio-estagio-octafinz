import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/fake-clock';
import { createFakeFetch, type FakeStep } from '../../testing/fake-fetch';
import {
  type HttpRequest,
  type ResilienceOptions,
  ResilientHttpClient,
} from './resilient-http-client';

const OPTIONS: ResilienceOptions = {
  timeoutMs: 3_000,
  attemptTimeoutMs: 1_000,
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  breaker: { failureThreshold: 3, openMs: 30_000 },
};

const REQUEST: HttpRequest = {
  url: 'http://bank.test/simulate',
  headers: { 'content-type': 'application/json', 'idempotency-key': 'sim-42:beta' },
  body: '{"amount":1}',
};

function setup(steps: FakeStep[], options: Partial<ResilienceOptions> = {}, random = () => 0.5) {
  const clock = new FakeClock();
  const fake = createFakeFetch(steps, clock);
  const client = new ResilientHttpClient(
    { ...OPTIONS, ...options },
    { fetch: fake.fetch, clock, random },
  );
  const send = (signal = new AbortController().signal) => clock.run(client.send(REQUEST, signal));
  return { clock, client, send, requests: fake.requests };
}

const ok: FakeStep = { status: 200, body: '{"ok":true}' };

describe('ResilientHttpClient', () => {
  describe('a successful call', () => {
    it('returns status, headers and body text with attempts and elapsed time', async () => {
      const { send, clock } = setup([{ ...ok, delayMs: 120, headers: { 'x-bank': 'beta' } }]);
      const outcome = await send();

      expect(outcome).toMatchObject({
        kind: 'response',
        status: 200,
        bodyText: '{"ok":true}',
        attempts: 1,
        elapsedMs: 120,
      });
      expect(outcome.kind === 'response' && outcome.headers.get('x-bank')).toBe('beta');
      expect(clock.pendingTimers).toBe(0); // the attempt timeout was cancelled
    });

    it('POSTs the request as given and never follows redirects', async () => {
      const { send, requests } = setup([ok]);
      await send();

      expect(requests).toEqual([
        expect.objectContaining({
          url: REQUEST.url,
          method: 'POST',
          body: REQUEST.body,
          redirect: 'manual',
        }),
      ]);
      expect(requests[0]?.headers.get('idempotency-key')).toBe('sim-42:beta');
    });
  });

  describe('retries', () => {
    it('retries 503 with exponential backoff and the same headers on every attempt', async () => {
      const { send, requests, clock } = setup([{ status: 503 }, { status: 503 }, ok]);
      const outcome = await send();

      expect(outcome).toMatchObject({ kind: 'response', status: 200, attempts: 3 });
      expect(clock.sleeps).toEqual(expect.arrayContaining([100, 200])); // 0.5 × 200, 0.5 × 400
      const keys = requests.map((request) => request.headers.get('idempotency-key'));
      expect(keys).toEqual(['sim-42:beta', 'sim-42:beta', 'sim-42:beta']);
    });

    it.each([502, 504])('retries %i', async (status) => {
      expect(await setup([{ status }, ok]).send()).toMatchObject({ status: 200, attempts: 2 });
    });

    it('retries a network error', async () => {
      expect(await setup([{ networkError: true }, ok]).send()).toMatchObject({
        status: 200,
        attempts: 2,
      });
    });

    it.each([400, 404, 500])('does not retry %i', async (status) => {
      const { send, requests } = setup([{ status }, ok]);

      expect(await send()).toMatchObject({ kind: 'response', status, attempts: 1 });
      expect(requests).toHaveLength(1);
    });

    it('returns a redirect as a response instead of following it', async () => {
      const { send, requests } = setup([
        { status: 302, headers: { location: 'http://other.test/' } },
      ]);

      expect(await send()).toMatchObject({ kind: 'response', status: 302, attempts: 1 });
      expect(requests).toHaveLength(1);
    });

    it('returns the last 503 when attempts run out', async () => {
      expect(await setup([{ status: 503 }]).send()).toMatchObject({
        kind: 'response',
        status: 503,
        attempts: 3,
      });
    });
  });

  describe('timeouts', () => {
    it('retries an attempt that exceeds attemptTimeoutMs', async () => {
      const { send } = setup([{ hang: true }, ok]);

      expect(await send()).toMatchObject({ status: 200, attempts: 2, elapsedMs: 1_100 });
    });

    it('fits every attempt inside the total budget, cutting the last one short', async () => {
      const { send, clock } = setup(
        [{ hang: true }],
        { timeoutMs: 2_500, maxAttempts: 5 },
        () => 0,
      );
      const outcome = await send();

      expect(outcome).toEqual({
        kind: 'failure',
        reason: 'TIMEOUT',
        attempts: 3,
        elapsedMs: 2_500,
      });
      expect(clock.sleeps).toContain(500); // third attempt only got what was left
    });
  });

  describe('Retry-After', () => {
    it('waits the delta-seconds the bank asked for', async () => {
      const { send, clock } = setup([{ status: 503, headers: { 'retry-after': '2' } }, ok]);

      expect(await send()).toMatchObject({ status: 200, attempts: 2, elapsedMs: 2_000 });
      expect(clock.sleeps).toContain(2_000);
    });

    it('waits until an HTTP-date', async () => {
      const { send, clock } = setup([
        { status: 503, headers: { 'retry-after': 'Thu, 22 Oct 2026 12:00:02 GMT' } },
        ok,
      ]);

      expect(await send()).toMatchObject({ status: 200, attempts: 2 });
      expect(clock.sleeps).toContain(2_000);
    });

    it('does not wait beyond the budget: returns the 503 instead', async () => {
      const { send, requests } = setup([{ status: 503, headers: { 'retry-after': '5' } }, ok]);

      expect(await send()).toMatchObject({ status: 503, attempts: 1, elapsedMs: 0 });
      expect(requests).toHaveLength(1);
    });
  });

  describe('abort by the caller', () => {
    it('does not call the bank when already aborted', async () => {
      const { send, requests } = setup([ok]);
      const outcome = await send(AbortSignal.abort());

      expect(outcome).toEqual({ kind: 'failure', reason: 'ABORTED', attempts: 0, elapsedMs: 0 });
      expect(requests).toHaveLength(0);
    });

    it('stops during an attempt and does not retry', async () => {
      const { client, clock, requests } = setup([{ hang: true }, ok]);
      const controller = new AbortController();
      const pending = client.send(REQUEST, controller.signal);
      await clock.advance(100);
      controller.abort();

      expect(await clock.run(pending)).toEqual({
        kind: 'failure',
        reason: 'ABORTED',
        attempts: 1,
        elapsedMs: 100,
      });
      expect(requests).toHaveLength(1);
    });

    it('stops during the backoff wait', async () => {
      const { client, clock, requests } = setup([{ status: 503 }, ok]);
      const controller = new AbortController();
      const pending = client.send(REQUEST, controller.signal);
      await clock.advance(50); // inside the 100 ms backoff
      controller.abort();

      expect(await clock.run(pending)).toMatchObject({
        kind: 'failure',
        reason: 'ABORTED',
        attempts: 1,
      });
      expect(requests).toHaveLength(1);
      expect(clock.pendingTimers).toBe(0);
    });
  });

  describe('circuit breaker', () => {
    // One attempt per call, so each failing call counts once.
    const singleAttempt = { maxAttempts: 1 };

    it('opens after consecutive failed calls and then fails fast without calling the bank', async () => {
      const { send, client, requests } = setup([{ status: 500 }], singleAttempt);
      for (let i = 0; i < 3; i += 1) await send();

      expect(client.circuitState).toBe('OPEN');
      expect(await send()).toEqual({
        kind: 'failure',
        reason: 'CIRCUIT_OPEN',
        attempts: 0,
        elapsedMs: 0,
      });
      expect(requests).toHaveLength(3);
    });

    it('does not count 4xx as failures', async () => {
      const { send, client } = setup([{ status: 400 }], singleAttempt);
      for (let i = 0; i < 5; i += 1) await send();

      expect(client.circuitState).toBe('CLOSED');
    });

    async function openCircuit(nextSteps: FakeStep[]) {
      const ctx = setup(
        [{ status: 500 }, { status: 500 }, { status: 500 }, ...nextSteps],
        singleAttempt,
      );
      for (let i = 0; i < 3; i += 1) await ctx.send();
      await ctx.clock.advance(30_000);
      return ctx;
    }

    it('closes when the trial call succeeds', async () => {
      const { send, client } = await openCircuit([ok]);

      expect(await send()).toMatchObject({ status: 200 });
      expect(client.circuitState).toBe('CLOSED');
    });

    it('closes when the trial call gets a 4xx (the bank is up)', async () => {
      const { send, client } = await openCircuit([{ status: 400 }]);
      await send();

      expect(client.circuitState).toBe('CLOSED');
    });

    it('reopens with a fresh cool-down when the trial call fails', async () => {
      const { send, client, clock } = await openCircuit([{ status: 503 }, ok]);
      await send();

      expect(client.circuitState).toBe('OPEN');
      await clock.advance(29_999);
      expect(await send()).toMatchObject({ reason: 'CIRCUIT_OPEN' });
      await clock.advance(1);
      expect(await send()).toMatchObject({ status: 200 });
    });

    it('an aborted trial frees the slot: the next call is the new trial, with no wait', async () => {
      const { send, client, clock } = await openCircuit([{ hang: true }, ok]);
      const controller = new AbortController();
      const trial = client.send(REQUEST, controller.signal);
      await clock.advance(10);
      controller.abort();
      await clock.run(trial);

      expect(client.circuitState).toBe('OPEN');
      expect(await send()).toMatchObject({ status: 200 });
      expect(client.circuitState).toBe('CLOSED');
    });
  });
});
