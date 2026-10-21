export interface LatencyRange {
  minMs: number;
  maxMs: number;
}

export interface BankRuntimeConfig {
  port: number;
  latency: LatencyRange;
  failureRate: number;
  timeoutDelayMs: number;
}

export interface GamaRuntimeConfig extends BankRuntimeConfig {
  malformedRate: number;
  restrictedCnpjs: ReadonlySet<string>;
}

export interface MockBanksConfig {
  host: string;
  logLevel: string;
  alfa: BankRuntimeConfig;
  beta: BankRuntimeConfig;
  gama: GamaRuntimeConfig;
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/;

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

function readRate(env: Env, name: string, fallback: number): number {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigError(`${name} deve ser um número entre 0 e 1 (recebido: "${raw}")`);
  }
  return value;
}

function readLatency(env: Env, prefix: string, fallback: LatencyRange): LatencyRange {
  const minMs = readInt(env, `${prefix}_LATENCY_MIN_MS`, fallback.minMs, 0, 600_000);
  const maxMs = readInt(env, `${prefix}_LATENCY_MAX_MS`, fallback.maxMs, 0, 600_000);
  if (minMs > maxMs) {
    throw new ConfigError(
      `${prefix}_LATENCY_MIN_MS (${minMs}) maior que ${prefix}_LATENCY_MAX_MS (${maxMs})`,
    );
  }
  return { minMs, maxMs };
}

function readCnpjList(env: Env, name: string, fallback: readonly string[]): ReadonlySet<string> {
  const raw = readRaw(env, name);
  const items = raw === undefined ? fallback : raw.split(',').map((item) => item.trim());

  for (const item of items) {
    if (!CNPJ_PATTERN.test(item)) {
      throw new ConfigError(
        `${name} contém um CNPJ fora do formato (14 caracteres, sem máscara): "${item}"`,
      );
    }
  }
  return new Set(items);
}

function readBank(
  env: Env,
  prefix: string,
  defaults: { port: number; latency: LatencyRange; failureRate: number },
  timeoutDelayMs: number,
): BankRuntimeConfig {
  return {
    port: readInt(env, `${prefix}_PORT`, defaults.port, 1, 65_535),
    latency: readLatency(env, prefix, defaults.latency),
    failureRate: readRate(env, `${prefix}_FAILURE_RATE`, defaults.failureRate),
    timeoutDelayMs,
  };
}

export function loadConfig(env: Env): MockBanksConfig {
  const timeoutDelayMs = readInt(env, 'MOCK_TIMEOUT_DELAY_MS', 30_000, 0, 600_000);

  const alfa = readBank(
    env,
    'ALFA',
    { port: 4001, latency: { minMs: 50, maxMs: 200 }, failureRate: 0 },
    timeoutDelayMs,
  );
  const beta = readBank(
    env,
    'BETA',
    { port: 4002, latency: { minMs: 300, maxMs: 1200 }, failureRate: 0.05 },
    timeoutDelayMs,
  );
  const gama: GamaRuntimeConfig = {
    ...readBank(
      env,
      'GAMA',
      { port: 4003, latency: { minMs: 2000, maxMs: 6000 }, failureRate: 0.2 },
      timeoutDelayMs,
    ),
    malformedRate: readRate(env, 'GAMA_MALFORMED_RATE', 0.1),
    restrictedCnpjs: readCnpjList(env, 'GAMA_RESTRICTED_CNPJS', ['11222333000181']),
  };

  if (gama.failureRate + gama.malformedRate > 1) {
    throw new ConfigError('GAMA_FAILURE_RATE + GAMA_MALFORMED_RATE não pode passar de 1');
  }

  const ports = [alfa.port, beta.port, gama.port];
  if (new Set(ports).size !== ports.length) {
    throw new ConfigError(
      `As portas dos bancos devem ser diferentes (recebido: ${ports.join(', ')})`,
    );
  }

  return {
    host: readRaw(env, 'MOCK_BANKS_HOST') ?? '127.0.0.1',
    logLevel: readRaw(env, 'LOG_LEVEL') ?? 'info',
    alfa,
    beta,
    gama,
  };
}
