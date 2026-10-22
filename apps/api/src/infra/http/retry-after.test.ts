import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from './retry-after';

const NOW = Date.parse('2026-10-22T12:00:00Z');

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('2', NOW)).toBe(2_000);
    expect(parseRetryAfterMs(' 0 ', NOW)).toBe(0);
  });

  it('reads an HTTP-date relative to now', () => {
    expect(parseRetryAfterMs('Thu, 22 Oct 2026 12:00:05 GMT', NOW)).toBe(5_000);
  });

  it('treats an HTTP-date in the past as "now"', () => {
    expect(parseRetryAfterMs('Thu, 22 Oct 2026 11:59:00 GMT', NOW)).toBe(0);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['fractional seconds (Date.parse would read it as a date in 2001)', '1.5'],
    ['negative', '-1'],
    ['garbage', 'soon'],
    ['an ISO date (not an HTTP-date)', '2026-10-22T12:00:05Z'],
  ])('ignores a value that is %s', (_, value) => {
    expect(parseRetryAfterMs(value, NOW)).toBeUndefined();
  });
});
