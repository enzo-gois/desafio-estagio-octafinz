import { describe, expect, it } from 'vitest';
import { ConfigError, loadBanksConfig } from './bank-config';

describe('loadBanksConfig', () => {
  it('uses defaults sized from each mock bank latency', () => {
    const config = loadBanksConfig({});

    expect(config.banks.alfa).toEqual({
      id: 'alfa',
      baseUrl: 'http://127.0.0.1:4001/',
      timeoutMs: 3_000,
      attemptTimeoutMs: 1_000,
      maxAttempts: 3,
      extraHeaders: {},
    });
    expect(config.banks.beta).toMatchObject({ timeoutMs: 6_000, attemptTimeoutMs: 2_500 });
    expect(config.banks.gama).toMatchObject({ timeoutMs: 12_000, attemptTimeoutMs: 7_000 });
    expect(config.retry).toEqual({ baseDelayMs: 200, maxDelayMs: 2_000 });
    expect(config.breaker).toEqual({ failureThreshold: 5, openMs: 30_000 });
  });

  it('reads overrides, including extra headers as a JSON object', () => {
    const config = loadBanksConfig({
      BANK_GAMA_URL: 'http://mock-banks:4003',
      BANK_GAMA_TIMEOUT_MS: '15000',
      BANK_GAMA_MAX_ATTEMPTS: '2',
      BANK_GAMA_EXTRA_HEADERS: '{"X-Mock-Scenario":"error"}',
      BANK_BREAKER_OPEN_MS: '5000',
    });

    expect(config.banks.gama).toMatchObject({
      baseUrl: 'http://mock-banks:4003/',
      timeoutMs: 15_000,
      maxAttempts: 2,
      extraHeaders: { 'x-mock-scenario': 'error' },
    });
    expect(config.banks.alfa.extraHeaders).toEqual({});
    expect(config.breaker.openMs).toBe(5_000);
  });

  it.each([
    ['a non-numeric timeout', { BANK_ALFA_TIMEOUT_MS: 'fast' }],
    ['an attempt timeout above the total', { BANK_BETA_ATTEMPT_TIMEOUT_MS: '7000' }],
    ['zero attempts', { BANK_ALFA_MAX_ATTEMPTS: '0' }],
    ['an invalid URL', { BANK_ALFA_URL: 'not a url' }],
    ['a non-HTTP URL', { BANK_ALFA_URL: 'ftp://bank.test' }],
    ['a base delay above the max delay', { BANK_RETRY_BASE_DELAY_MS: '5000' }],
    ['extra headers that are not JSON', { BANK_ALFA_EXTRA_HEADERS: 'x-mock-scenario=error' }],
    ['extra headers as an array', { BANK_ALFA_EXTRA_HEADERS: '["x"]' }],
    ['an extra header with a non-string value', { BANK_ALFA_EXTRA_HEADERS: '{"x-retries":3}' }],
    [
      'an extra header overriding Idempotency-Key',
      { BANK_ALFA_EXTRA_HEADERS: '{"Idempotency-Key":"x"}' },
    ],
    [
      'an extra header overriding Content-Type',
      { BANK_ALFA_EXTRA_HEADERS: '{"content-type":"text/plain"}' },
    ],
    ['an extra header with an invalid name', { BANK_ALFA_EXTRA_HEADERS: '{"bad header":"x"}' }],
    [
      'an extra header value with CR/LF (header injection)',
      {
        BANK_ALFA_EXTRA_HEADERS: '{"x-a":"ok\\r\\nx-injected: 1"}',
      },
    ],
  ])('fails fast on %s', (_, env) => {
    expect(() => loadBanksConfig(env)).toThrow(ConfigError);
  });
});
