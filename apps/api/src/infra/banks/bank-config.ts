import type { BreakerOptions } from '../http/circuit-breaker';

export const BANK_IDS = ['alfa', 'beta', 'gama'] as const;
export type BankId = (typeof BANK_IDS)[number];

export interface BankEndpointConfig {
  id: BankId;
  baseUrl: string;
  /** Total budget for one call to this bank, retries and waits included. */
  timeoutMs: number;
  attemptTimeoutMs: number;
  maxAttempts: number;
  /**
   * Extra request headers, for demos and tests (e.g. x-mock-scenario). Read only from the
   * environment, empty by default, and never filled from customer input.
   */
  extraHeaders: Readonly<Record<string, string>>;
}

export interface BanksConfig {
  banks: Readonly<Record<BankId, BankEndpointConfig>>;
  retry: { baseDelayMs: number; maxDelayMs: number };
  breaker: BreakerOptions;
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Defaults are sized from each mock's latency (apps/mock-banks).
const BANK_DEFAULTS: Record<BankId, { port: number; timeoutMs: number; attemptTimeoutMs: number }> =
  {
    // 50–200 ms: 5× the maximum per attempt, leaving room for 3 attempts.
    alfa: { port: 4001, timeoutMs: 3_000, attemptTimeoutMs: 1_000 },
    // 300–1200 ms: ~2× the maximum per attempt; 2 full attempts plus a partial one.
    beta: { port: 4002, timeoutMs: 6_000, attemptTimeoutMs: 2_500 },
    // 2–6 s, and its 503s also take 2–6 s: maximum + 1 s per attempt. A 503, its 2 s
    // Retry-After and a second attempt fit in 12 s for most latency draws.
    gama: { port: 4003, timeoutMs: 12_000, attemptTimeoutMs: 7_000 },
  };

// Headers the adapters set themselves; config must not be able to override them.
const RESERVED_HEADERS = new Set([
  'accept',
  'connection',
  'content-length',
  'content-type',
  'host',
  'idempotency-key',
  'transfer-encoding',
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e]*$/; // printable ASCII: no CR/LF header injection

function readRaw(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    throw new ConfigError(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: "${raw}")`);
  }
  return value;
}

function readUrl(env: Env, name: string, fallback: string): string {
  const raw = readRaw(env, name) ?? fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} não é uma URL válida (recebido: "${raw}")`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${name} deve usar http ou https (recebido: "${raw}")`);
  }
  return url.toString();
}

function readExtraHeaders(env: Env, name: string): Readonly<Record<string, string>> {
  const raw = readRaw(env, name);
  if (raw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${name} deve ser um objeto JSON, ex.: {"x-mock-scenario":"error"}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${name} deve ser um objeto JSON, ex.: {"x-mock-scenario":"error"}`);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const headerName = key.toLowerCase();
    if (!HEADER_NAME.test(headerName) || RESERVED_HEADERS.has(headerName)) {
      throw new ConfigError(`${name}: header não permitido "${key}"`);
    }
    if (typeof value !== 'string' || !HEADER_VALUE.test(value)) {
      throw new ConfigError(`${name}: valor inválido para o header "${key}"`);
    }
    headers[headerName] = value;
  }
  return headers;
}

export function loadBanksConfig(env: Env): BanksConfig {
  const banks = {} as Record<BankId, BankEndpointConfig>;

  for (const id of BANK_IDS) {
    const prefix = `BANK_${id.toUpperCase()}`;
    const defaults = BANK_DEFAULTS[id];
    const timeoutMs = readInt(env, `${prefix}_TIMEOUT_MS`, defaults.timeoutMs, 1, 120_000);
    const attemptTimeoutMs = readInt(
      env,
      `${prefix}_ATTEMPT_TIMEOUT_MS`,
      defaults.attemptTimeoutMs,
      1,
      120_000,
    );
    if (attemptTimeoutMs > timeoutMs) {
      throw new ConfigError(
        `${prefix}_ATTEMPT_TIMEOUT_MS (${attemptTimeoutMs}) maior que ${prefix}_TIMEOUT_MS (${timeoutMs})`,
      );
    }

    banks[id] = {
      id,
      baseUrl: readUrl(env, `${prefix}_URL`, `http://127.0.0.1:${defaults.port}`),
      timeoutMs,
      attemptTimeoutMs,
      maxAttempts: readInt(env, `${prefix}_MAX_ATTEMPTS`, 3, 1, 10),
      extraHeaders: readExtraHeaders(env, `${prefix}_EXTRA_HEADERS`),
    };
  }

  const baseDelayMs = readInt(env, 'BANK_RETRY_BASE_DELAY_MS', 200, 0, 60_000);
  const maxDelayMs = readInt(env, 'BANK_RETRY_MAX_DELAY_MS', 2_000, 0, 60_000);
  if (baseDelayMs > maxDelayMs) {
    throw new ConfigError(
      `BANK_RETRY_BASE_DELAY_MS (${baseDelayMs}) maior que BANK_RETRY_MAX_DELAY_MS (${maxDelayMs})`,
    );
  }

  return {
    banks,
    retry: { baseDelayMs, maxDelayMs },
    breaker: {
      failureThreshold: readInt(env, 'BANK_BREAKER_FAILURE_THRESHOLD', 5, 1, 1_000),
      openMs: readInt(env, 'BANK_BREAKER_OPEN_MS', 30_000, 1, 3_600_000),
    },
  };
}
