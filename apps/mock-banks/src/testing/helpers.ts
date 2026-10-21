import { vi } from 'vitest';
import type { BankRuntimeConfig } from '../config';
import type { Sleep } from '../runtime/sleep';

export const TODAY = new Date('2026-10-21T12:00:00Z');

export const testBankConfig: BankRuntimeConfig = {
  port: 0,
  latency: { minMs: 0, maxMs: 0 },
  failureRate: 0,
  timeoutDelayMs: 30_000,
};

// Sleep resolves immediately but records the requested delay.
export function testDeps(random: () => number = () => 0.5) {
  const sleep = vi.fn<Sleep>(async () => {});
  return { random, sleep, now: () => TODAY };
}

export const scenarioHeader = (scenario: string) => ({ 'x-mock-scenario': scenario });
