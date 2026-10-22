import type { SimulationInput } from '@simulador/shared';
import type { BankEndpointConfig, BankId } from '../infra/banks/bank-config';
import type { HttpOutcome, HttpRequest, HttpSender } from '../infra/http/resilient-http-client';

// Distinctive values so the PII test can search logs for them in every format.
export const CUSTOMER: SimulationInput = {
  name: 'Maria Teresinha Sauro',
  email: 'maria.sauro@example.com',
  cpf: '52998224725',
  birthDate: '1985-04-12',
  employmentType: 'PUBLIC_SERVANT',
  employerCnpj: '12ABC34501DE35',
  netSalaryCents: 734_219,
  requestedAmountCents: 1_000_000,
  installments: 48,
  consent: true,
};

export const CONTEXT = { simulationId: 'sim-42' };

export function endpointFor(
  id: BankId,
  overrides: Partial<BankEndpointConfig> = {},
): BankEndpointConfig {
  return {
    id,
    baseUrl: `http://bank-${id}.test`,
    timeoutMs: 3_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 3,
    extraHeaders: {},
    ...overrides,
  };
}

/** HttpSender that returns a fixed outcome and records what it was asked to send. */
export function fixedSender(outcome: HttpOutcome) {
  const requests: HttpRequest[] = [];
  const sender: HttpSender = {
    send: async (request) => {
      requests.push(request);
      return outcome;
    },
  };
  return { sender, requests };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  overrides: Partial<Extract<HttpOutcome, { kind: 'response' }>> = {},
): HttpOutcome {
  return {
    kind: 'response',
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
    attempts: 1,
    elapsedMs: 120,
    ...overrides,
  };
}
