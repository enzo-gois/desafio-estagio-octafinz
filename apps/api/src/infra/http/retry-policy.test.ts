import { describe, expect, it } from 'vitest';
import { type AttemptOutcome, planRetry, type RetryPolicy } from './retry-policy';

const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 };
const half = () => 0.5;

const response = (status: number): AttemptOutcome => ({ kind: 'response', status });
const failure = (reason: 'TIMEOUT' | 'NETWORK' | 'ABORTED'): AttemptOutcome => ({
  kind: 'failure',
  reason,
});

describe('planRetry', () => {
  it.each([
    ['a 502', response(502)],
    ['a 503', response(503)],
    ['a 504', response(504)],
    ['a network error', failure('NETWORK')],
    ['an attempt timeout', failure('TIMEOUT')],
  ])('retries after %s', (_, outcome) => {
    expect(planRetry({ outcome, attempt: 1, remainingMs: 10_000 }, policy, half)).toEqual({
      retry: true,
      delayMs: 100, // 0.5 × min(2000, 200 × 2⁰)
    });
  });

  it.each([
    ['a success', response(200)],
    ['a redirect', response(302)],
    ['a 400 (our bug)', response(400)],
    ['a 404', response(404)],
    ['a 500 (not transient)', response(500)],
    ['an abort by the caller', failure('ABORTED')],
  ])('does not retry after %s', (_, outcome) => {
    expect(planRetry({ outcome, attempt: 1, remainingMs: 10_000 }, policy, half)).toEqual({
      retry: false,
    });
  });

  it('doubles the backoff ceiling on each attempt (full jitter)', () => {
    const second = planRetry(
      { outcome: response(503), attempt: 2, remainingMs: 10_000 },
      policy,
      half,
    );

    expect(second).toEqual({ retry: true, delayMs: 200 }); // 0.5 × 200 × 2¹
  });

  it('caps the backoff at maxDelayMs', () => {
    const generous = { ...policy, maxAttempts: 10, maxDelayMs: 1_000 };
    const fifth = planRetry(
      { outcome: response(503), attempt: 5, remainingMs: 10_000 },
      generous,
      half,
    );

    expect(fifth).toEqual({ retry: true, delayMs: 500 }); // 0.5 × min(1000, 3200)
  });

  it('can retry immediately when the jitter draws 0', () => {
    expect(
      planRetry({ outcome: response(503), attempt: 1, remainingMs: 10_000 }, policy, () => 0),
    ).toEqual({ retry: true, delayMs: 0 });
  });

  it('stops after maxAttempts', () => {
    expect(
      planRetry({ outcome: response(503), attempt: 3, remainingMs: 10_000 }, policy, half),
    ).toEqual({
      retry: false,
    });
  });

  it('uses Retry-After as-is, without jitter', () => {
    const input = { outcome: response(503), attempt: 1, remainingMs: 10_000, retryAfterMs: 2_000 };

    expect(planRetry(input, policy, () => 0.123)).toEqual({ retry: true, delayMs: 2_000 });
  });

  it('honors a Retry-After of 0', () => {
    const input = { outcome: response(503), attempt: 1, remainingMs: 10_000, retryAfterMs: 0 };

    expect(planRetry(input, policy, half)).toEqual({ retry: true, delayMs: 0 });
  });

  it('gives up when Retry-After does not fit in the remaining budget', () => {
    const input = { outcome: response(503), attempt: 1, remainingMs: 2_000, retryAfterMs: 2_000 };

    expect(planRetry(input, policy, half)).toEqual({ retry: false });
  });

  it('gives up when the backoff does not fit in the remaining budget', () => {
    expect(
      planRetry({ outcome: response(503), attempt: 1, remainingMs: 100 }, policy, half),
    ).toEqual({
      retry: false,
    }); // delay 100 >= 100 remaining
  });

  it('gives up when the budget is already exhausted', () => {
    expect(
      planRetry({ outcome: failure('TIMEOUT'), attempt: 1, remainingMs: 0 }, policy, () => 0),
    ).toEqual({ retry: false });
  });
});
