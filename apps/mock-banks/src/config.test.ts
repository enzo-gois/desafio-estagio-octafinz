import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('uses the documented defaults', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.alfa).toEqual({
      port: 4001,
      latency: { minMs: 50, maxMs: 200 },
      failureRate: 0,
      timeoutDelayMs: 30_000,
    });
    expect(config.beta.port).toBe(4002);
    expect(config.gama).toMatchObject({
      port: 4003,
      latency: { minMs: 2000, maxMs: 6000 },
      failureRate: 0.2,
      malformedRate: 0.1,
    });
    expect([...config.gama.restrictedCnpjs]).toEqual(['11222333000181']);
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      ALFA_PORT: '5001',
      GAMA_LATENCY_MIN_MS: '0',
      GAMA_LATENCY_MAX_MS: '10',
      BETA_FAILURE_RATE: '0.5',
      MOCK_TIMEOUT_DELAY_MS: '1000',
      GAMA_RESTRICTED_CNPJS: '11222333000181, 12ABC34501DE35',
      MOCK_BANKS_HOST: '0.0.0.0',
    });

    expect(config.alfa.port).toBe(5001);
    expect(config.gama.latency).toEqual({ minMs: 0, maxMs: 10 });
    expect(config.beta.failureRate).toBe(0.5);
    expect(config.beta.timeoutDelayMs).toBe(1000);
    expect(config.gama.restrictedCnpjs.has('12ABC34501DE35')).toBe(true);
    expect(config.host).toBe('0.0.0.0');
  });

  it.each([
    ['a non-numeric port', { ALFA_PORT: 'abc' }],
    ['a port out of range', { BETA_PORT: '70000' }],
    ['a fractional latency', { ALFA_LATENCY_MIN_MS: '1.5' }],
    ['min latency above max', { GAMA_LATENCY_MIN_MS: '7000' }],
    ['a failure rate above 1', { ALFA_FAILURE_RATE: '1.5' }],
    ['a non-numeric failure rate', { ALFA_FAILURE_RATE: 'high' }],
    ['failure + malformed above 1', { GAMA_FAILURE_RATE: '0.8', GAMA_MALFORMED_RATE: '0.3' }],
    ['duplicated ports', { ALFA_PORT: '4002' }],
    ['a masked CNPJ in the restricted list', { GAMA_RESTRICTED_CNPJS: '11.222.333/0001-81' }],
  ])('fails fast on %s', (_, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });
});
