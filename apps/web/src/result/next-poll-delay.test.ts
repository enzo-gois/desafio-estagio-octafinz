import { describe, expect, it } from 'vitest';
import { nextPollDelay, type PollOutcome } from './next-poll-delay';

// `failures` is the outcome's consecutiveFailures: the failure just ended included. The outcome
// carries no status: whether the server sent a Retry-After is what decides.
describe('nextPollDelay', () => {
  it('keeps the normal pace of 1 s while the simulation is processing', () => {
    expect(nextPollDelay({ kind: 'ok' })).toBe(1_000);
  });

  it.each([
    { failures: 1, expected: 1_000 },
    { failures: 2, expected: 2_000 },
    { failures: 3, expected: 4_000 },
    { failures: 4, expected: 8_000 },
    { failures: 5, expected: 8_000 },
    { failures: 50, expected: 8_000 },
  ])(
    'backs off without Retry-After: $expected ms after $failures failure(s) in a row',
    ({ failures, expected }) => {
      const outcome: PollOutcome = {
        kind: 'failed',
        consecutiveFailures: failures,
        retryAfterMs: undefined,
      };
      expect(nextPollDelay(outcome)).toBe(expected);
    },
  );

  it.each([
    { case: 'longer than the backoff', failures: 1, retryAfterMs: 5_000, expected: 5_000 },
    { case: 'shorter than the backoff', failures: 4, retryAfterMs: 2_000, expected: 2_000 },
    { case: 'equal to the backoff', failures: 3, retryAfterMs: 4_000, expected: 4_000 },
    { case: 'of exactly 1 s', failures: 2, retryAfterMs: 1_000, expected: 1_000 },
    { case: 'of 0 (floor of 1 s)', failures: 1, retryAfterMs: 0, expected: 1_000 },
    { case: 'below 1 s (floor of 1 s)', failures: 3, retryAfterMs: 500, expected: 1_000 },
    { case: 'of exactly 60 s', failures: 2, retryAfterMs: 60_000, expected: 60_000 },
    { case: 'of 2 min (ceiling of 60 s)', failures: 1, retryAfterMs: 120_000, expected: 60_000 },
    // The client reads a Retry-After of hundreds of digits as Infinity.
    {
      case: 'of Infinity (ceiling of 60 s)',
      failures: 3,
      retryAfterMs: Infinity,
      expected: 60_000,
    },
  ])('follows a Retry-After $case: $expected ms', ({ failures, retryAfterMs, expected }) => {
    const outcome: PollOutcome = { kind: 'failed', consecutiveFailures: failures, retryAfterMs };
    expect(nextPollDelay(outcome)).toBe(expected);
  });
});
