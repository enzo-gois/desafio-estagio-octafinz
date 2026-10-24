import { describe, expect, it } from 'vitest';
import { elapsedSeconds } from './elapsed';

const CREATED_AT = '2026-10-23T12:00:00.000Z';
const at = (iso: string) => Date.parse(iso);

describe('elapsedSeconds', () => {
  it.each([
    { clock: 'right', clientNow: '2026-10-23T12:00:03.000Z', offsetMs: 0 },
    { clock: '5 min behind', clientNow: '2026-10-23T11:55:03.000Z', offsetMs: 300_000 },
    { clock: '7 min ahead', clientNow: '2026-10-23T12:07:03.000Z', offsetMs: -420_000 },
  ])('counts on the server clock when the client clock is $clock', ({ clientNow, offsetMs }) => {
    expect(elapsedSeconds(CREATED_AT, offsetMs, at(clientNow))).toBe(3);
  });

  it('rounds down to whole seconds', () => {
    expect(elapsedSeconds(CREATED_AT, 0, at('2026-10-23T12:00:04.999Z'))).toBe(4);
  });

  it('never goes below zero', () => {
    expect(elapsedSeconds(CREATED_AT, 0, at('2026-10-23T11:59:58.000Z'))).toBe(0);
  });
});
