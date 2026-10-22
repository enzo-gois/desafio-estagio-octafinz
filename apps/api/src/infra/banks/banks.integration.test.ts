import type { AddressInfo } from 'node:net';
import type { BankResult, SimulationInput } from '@simulador/shared';
import {
  abortableSleep,
  buildAlfaServer,
  buildBetaServer,
  buildGamaServer,
  type BankRuntimeConfig,
} from '@simulador/mock-banks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BankProvider } from '../../application/ports/bank-provider';
import { CONTEXT, CUSTOMER } from '../../testing/bank-fixtures';
import { createCaptureLogger } from '../../testing/capture-logger';
import { systemClock } from '../http/clock';
import { BANK_IDS, type BankId, loadBanksConfig } from './bank-config';
import { createBankProviders } from './registry';

// Real adapters against the real mock banks over HTTP: catches any contract drift between
// them (field names, money formats, status codes). Mocks run with no latency and no random
// failures; scenarios are forced with x-mock-scenario through the env-configured extra headers.

const MOCK_NOW = new Date('2026-10-22T12:00:00Z');
const RESTRICTED_CNPJ = '11222333000181';

const mockConfig: BankRuntimeConfig = {
  port: 0,
  latency: { minMs: 0, maxMs: 0 },
  failureRate: 0,
  timeoutDelayMs: 2_000,
};
const mockDeps = { random: () => 0.5, sleep: abortableSleep, now: () => MOCK_NOW };

const servers = [
  buildAlfaServer({ ...mockDeps, config: mockConfig }),
  buildBetaServer({ ...mockDeps, config: mockConfig }),
  buildGamaServer({
    ...mockDeps,
    config: { ...mockConfig, malformedRate: 0, restrictedCnpjs: new Set([RESTRICTED_CNPJ]) },
  }),
];
const urls: Record<string, string> = {};
const capture = createCaptureLogger();

beforeAll(async () => {
  await Promise.all(servers.map((server) => server.listen({ host: '127.0.0.1', port: 0 })));
  BANK_IDS.forEach((id, index) => {
    const { port } = servers[index]?.server.address() as AddressInfo;
    urls[id] = `http://127.0.0.1:${port}`;
  });
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

/** Providers built exactly as in production, from env-style config, with short timeouts. */
function providers(scenario?: string): Record<BankId, BankProvider> {
  const env: Record<string, string> = {
    BANK_RETRY_BASE_DELAY_MS: '0',
    BANK_RETRY_MAX_DELAY_MS: '0',
    BANK_BREAKER_FAILURE_THRESHOLD: '1000',
  };
  for (const id of BANK_IDS) {
    const prefix = `BANK_${id.toUpperCase()}`;
    env[`${prefix}_URL`] = urls[id] ?? '';
    env[`${prefix}_TIMEOUT_MS`] = '400';
    env[`${prefix}_ATTEMPT_TIMEOUT_MS`] = '150';
    if (scenario) env[`${prefix}_EXTRA_HEADERS`] = JSON.stringify({ 'x-mock-scenario': scenario });
  }
  const list = createBankProviders(loadBanksConfig(env), {
    fetch: globalThis.fetch,
    clock: systemClock,
    random: () => 0,
    logger: capture.logger,
  });
  return Object.fromEntries(list.map((provider) => [provider.id, provider])) as Record<
    BankId,
    BankProvider
  >;
}

const simulate = (provider: BankProvider, input: SimulationInput = CUSTOMER): Promise<BankResult> =>
  provider.simulate(input, new AbortController().signal, CONTEXT);

async function simulateAll(scenario?: string): Promise<Record<BankId, BankResult>> {
  const banks = providers(scenario);
  const [alfa, beta, gama] = await Promise.all([
    simulate(banks.alfa),
    simulate(banks.beta),
    simulate(banks.gama),
  ]);
  return { alfa, beta, gama };
}

describe('adapters against the mock banks', () => {
  it('builds one provider per bank', () => {
    expect(Object.keys(providers())).toEqual(['alfa', 'beta', 'gama']);
  });

  it('all three approve a public servant, each in its own format', async () => {
    const results = await simulateAll('ok');

    expect(results.alfa).toMatchObject({
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 0.0179,
        installmentCents: 31_224,
      },
      attempts: 1,
    });
    expect(results.beta).toMatchObject({
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 0.0159,
        installmentCents: 29_942,
      },
    });
    expect(results.gama).toMatchObject({
      status: 'APPROVED',
      offer: {
        amountCents: 1_000_000,
        installments: 48,
        monthlyRate: 2.05 / 100,
        installmentCents: 32_934,
      },
    });
  });

  it('Beta counter-offer arrives as APPROVED with the smaller amount', async () => {
    const result = await simulate(providers('ok').beta, { ...CUSTOMER, netSalaryCents: 70_000 });

    expect(result).toMatchObject({
      status: 'APPROVED',
      offer: { amountCents: 818_255, installmentCents: 24_500 },
    });
  });

  it('each bank denial is translated to Portuguese', async () => {
    const banks = providers('ok');

    expect(await simulate(banks.alfa, { ...CUSTOMER, installments: 96 })).toMatchObject({
      status: 'DENIED',
      reason: 'Prazo acima do máximo aceito pelo banco.',
    });
    expect(await simulate(banks.beta, { ...CUSTOMER, employmentType: 'CLT' })).toMatchObject({
      status: 'DENIED',
      reason: 'Tipo de vínculo não atendido pelo banco.',
    });
    expect(
      await simulate(banks.gama, { ...CUSTOMER, employerCnpj: RESTRICTED_CNPJ }),
    ).toMatchObject({
      status: 'DENIED',
      reason: 'Empresa empregadora não atendida pelo banco.',
    });
  });

  it.each(['malformed', 'invalid-shape'])('"%s" becomes ERROR for every bank', async (scenario) => {
    const results = await simulateAll(scenario);

    for (const result of Object.values(results)) {
      expect(result).toMatchObject({
        status: 'ERROR',
        reason: 'O banco retornou uma resposta inválida.',
      });
    }
  });

  it('"error": Alfa 500 is ERROR; Beta 502 and Gama 503 are UNAVAILABLE', async () => {
    const results = await simulateAll('error');

    expect(results.alfa).toMatchObject({ status: 'ERROR', attempts: 1 });
    // HTML 502 from Beta's proxy: retried until attempts ran out.
    expect(results.beta).toMatchObject({ status: 'UNAVAILABLE', attempts: 3 });
    // Gama asks for Retry-After: 2 s, which does not fit in the 400 ms budget: no retry.
    expect(results.gama).toMatchObject({ status: 'UNAVAILABLE', attempts: 1 });
  });

  it('"timeout" becomes UNAVAILABLE within the total budget', async () => {
    const startedAt = Date.now();
    const results = await simulateAll('timeout');

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    for (const result of Object.values(results)) {
      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'O banco não respondeu a tempo.',
      });
    }
  });

  it('a 400 from the bank (our bug) is ERROR and raises an alert log', async () => {
    const results = await simulateAll('chaos'); // unknown scenario: every mock answers 400

    for (const result of Object.values(results)) expect(result).toMatchObject({ status: 'ERROR' });
    const alerts = capture.entries().filter((entry) => entry.alert === 'BANK_REJECTED_OUR_REQUEST');
    expect(alerts.map((entry) => entry.bankId).sort()).toEqual(['alfa', 'beta', 'gama']);
  });

  it('logged nothing that identifies the customer', () => {
    const everything = capture.lines.join('\n');

    for (const value of [CUSTOMER.cpf, 'Maria', 'Sauro', '734219', '7342.19']) {
      expect(everything).not.toContain(value);
    }
  });
});
