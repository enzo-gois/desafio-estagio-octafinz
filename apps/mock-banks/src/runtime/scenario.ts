import type { FastifyReply } from 'fastify';
import type { LatencyRange } from '../config';
import type { Sleep } from './sleep';

export const SCENARIO_HEADER = 'x-mock-scenario';

export const SCENARIOS = ['ok', 'timeout', 'error', 'malformed', 'invalid-shape'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const scenarioHeadersSchema = {
  type: 'object',
  properties: {
    [SCENARIO_HEADER]: { type: 'string', enum: SCENARIOS },
  },
} as const;

export interface ScenarioHeaders {
  [SCENARIO_HEADER]?: Scenario;
}

export interface ScenarioRates {
  failureRate: number;
  malformedRate?: number;
}

// A forced scenario wins over the random draw. 'invalid-shape' and 'timeout' are never
// drawn: they are only reachable through the header.
export function resolveScenario(
  forced: Scenario | undefined,
  rates: ScenarioRates,
  random: () => number,
): Scenario {
  if (forced !== undefined) return forced;

  const roll = random();
  if (roll < rates.failureRate) return 'error';
  if (roll < rates.failureRate + (rates.malformedRate ?? 0)) return 'malformed';
  return 'ok';
}

export function pickLatencyMs({ minMs, maxMs }: LatencyRange, random: () => number): number {
  return minMs + Math.floor(random() * (maxMs - minMs + 1));
}

export interface LatencyOptions {
  latency: LatencyRange;
  timeoutDelayMs: number;
  random: () => number;
  sleep: Sleep;
  signal: AbortSignal;
}

export function waitForScenario(scenario: Scenario, options: LatencyOptions): Promise<void> {
  const delayMs =
    scenario === 'timeout'
      ? options.timeoutDelayMs
      : pickLatencyMs(options.latency, options.random);
  return options.sleep(delayMs, options.signal);
}

// Declares JSON but sends a truncated body, like a bank that crashed mid-response.
export function sendMalformedJson(reply: FastifyReply, truncatedBody: string): FastifyReply {
  return reply.type('application/json').send(truncatedBody);
}
