import { describe, expect, it } from 'vitest';
import { ConfigError } from '../banks/bank-config';
import { loadAppConfig } from './env';

describe('loadAppConfig', () => {
  it('uses defaults that fit a local setup', () => {
    const config = loadAppConfig({});

    expect(config.http).toEqual({
      host: '127.0.0.1',
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      trustProxy: false,
      rateLimit: { postMax: 10, getMax: 120, windowMs: 60_000 },
    });
    expect(config.databaseUrl).toBe('file:./data/simulador.db');
    expect(config.marginPolicy).toEqual({ percent: 35, referenceMonthlyRate: 0.018 });
    // Longest bank budget (Gama, 12 s) + 10 s of slack.
    expect(config.pendingTtlMs).toBe(22_000);
    expect(config.shutdown).toEqual({ drainMs: 6_000, abortGraceMs: 2_000 });
  });

  it('reads overrides, including several CORS origins', () => {
    const config = loadAppConfig({
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:5173, https://simulador.example',
      TRUST_PROXY: 'true',
      MARGIN_PERCENT: '30',
      MARGIN_REFERENCE_MONTHLY_RATE: '0.02',
      SIMULATION_PENDING_TTL_MS: '30000',
    });

    expect(config.http).toMatchObject({
      port: 8080,
      corsOrigins: ['http://localhost:5173', 'https://simulador.example'],
      trustProxy: true,
    });
    expect(config.marginPolicy).toEqual({ percent: 30, referenceMonthlyRate: 0.02 });
    expect(config.pendingTtlMs).toBe(30_000);
  });

  it.each([
    ['a non-numeric port', { PORT: 'http' }],
    ['a database that is not a file: URL', { DATABASE_URL: 'postgres://db' }],
    ['a CORS origin that is not a URL', { CORS_ORIGIN: 'localhost' }],
    ['a margin above 100%', { MARGIN_PERCENT: '101' }],
    ['a reference rate given as percent', { MARGIN_REFERENCE_MONTHLY_RATE: '1.8' }],
    ['a PENDING TTL shorter than the longest bank budget', { SIMULATION_PENDING_TTL_MS: '5000' }],
    [
      'a shutdown that does not fit docker stop',
      { SHUTDOWN_DRAIN_MS: '8000', SHUTDOWN_ABORT_GRACE_MS: '2000' },
    ],
    ['an invalid bank setting', { BANK_ALFA_URL: 'ftp://alfa' }],
  ])('fails at boot on %s', (_, env) => {
    expect(() => loadAppConfig(env)).toThrow(ConfigError);
  });

  it('reports every invalid variable at once', () => {
    expect(() => loadAppConfig({ PORT: 'x', MARGIN_PERCENT: '0', LOG_LEVEL: 'loud' })).toThrow(
      /PORT[\s\S]*LOG_LEVEL[\s\S]*MARGIN_PERCENT/,
    );
  });
});
