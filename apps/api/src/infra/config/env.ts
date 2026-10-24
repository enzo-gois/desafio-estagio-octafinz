import { MAX_RETRY_AFTER_MS } from '@simulador/shared';
import { z } from 'zod';
import type { ShutdownOptions } from '../../application/simulation-orchestrator';
import type { MarginPolicy } from '../../domain/margin';
import { type BanksConfig, ConfigError, loadBanksConfig } from '../banks/bank-config';

type Env = Record<string, string | undefined>;

// `docker stop` sends SIGTERM and kills the process 10 s later. Drain + abort grace must fit
// with room left for closing HTTP and the database.
const DOCKER_STOP_GRACE_MS = 10_000;
const SHUTDOWN_HEADROOM_MS = 1_000;
// Added to the longest bank budget to get the PENDING TTL default.
const PENDING_TTL_SLACK_MS = 10_000;

const emptyAsUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const intVar = (fallback: number, min: number, max: number, maxMessage?: string) =>
  z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .trim()
      .regex(/^\d+$/, 'deve ser um número inteiro')
      .transform(Number)
      .pipe(z.number().min(min).max(max, maxMessage))
      .default(fallback),
  );

const optionalIntVar = (min: number, max: number) =>
  z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .trim()
      .regex(/^\d+$/, 'deve ser um número inteiro')
      .transform(Number)
      .pipe(z.number().min(min).max(max))
      .optional(),
  );

const envSchema = z.object({
  PORT: intVar(3000, 1, 65_535),
  HOST: z.preprocess(emptyAsUndefined, z.string().default('127.0.0.1')),
  LOG_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  DATABASE_URL: z.preprocess(
    emptyAsUndefined,
    z.string().startsWith('file:', 'deve começar com "file:"').default('file:./data/simulador.db'),
  ),
  CORS_ORIGIN: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .default('http://localhost:5173')
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(z.url({ protocol: /^https?$/, error: 'deve conter URLs http(s)' })).min(1)),
  ),
  TRUST_PROXY: z.preprocess(
    emptyAsUndefined,
    z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  ),
  RATE_LIMIT_POST_MAX: intVar(10, 1, 10_000),
  RATE_LIMIT_GET_MAX: intVar(120, 1, 100_000),
  // A 429's Retry-After lasts until the window ends, and the front waits at most
  // MAX_RETRY_AFTER_MS: with a longer window it would poll again while still limited.
  RATE_LIMIT_WINDOW_MS: intVar(
    60_000,
    1_000,
    MAX_RETRY_AFTER_MS,
    `deve ser no máximo ${MAX_RETRY_AFTER_MS} ms (MAX_RETRY_AFTER_MS, do shared): o Retry-After do 429 dura até o fim da janela, e o front não espera mais que isso`,
  ),
  MARGIN_PERCENT: intVar(35, 1, 100),
  MARGIN_REFERENCE_MONTHLY_RATE: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .default('0.018')
      .transform(Number)
      .pipe(z.number().positive().lt(1, 'deve ser uma fração mensal, ex.: 0.018')),
  ),
  SIMULATION_PENDING_TTL_MS: optionalIntVar(1_000, 3_600_000),
  SHUTDOWN_DRAIN_MS: intVar(6_000, 0, DOCKER_STOP_GRACE_MS),
  SHUTDOWN_ABORT_GRACE_MS: intVar(2_000, 0, DOCKER_STOP_GRACE_MS),
});

export interface AppConfig {
  http: {
    host: string;
    port: number;
    corsOrigins: string[];
    trustProxy: boolean;
    rateLimit: { postMax: number; getMax: number; windowMs: number };
  };
  logLevel: string;
  databaseUrl: string;
  marginPolicy: MarginPolicy;
  pendingTtlMs: number;
  shutdown: ShutdownOptions;
  banks: BanksConfig;
}

/** Validates the whole environment at boot and reports every problem at once. */
export function loadAppConfig(env: Env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Variáveis de ambiente inválidas:\n- ${problems.join('\n- ')}`);
  }
  const vars = parsed.data;
  const banks = loadBanksConfig(env);

  const longestBankBudgetMs = Math.max(...Object.values(banks.banks).map((bank) => bank.timeoutMs));
  const pendingTtlMs = vars.SIMULATION_PENDING_TTL_MS ?? longestBankBudgetMs + PENDING_TTL_SLACK_MS;

  const problems: string[] = [];
  if (pendingTtlMs < longestBankBudgetMs) {
    problems.push(
      `SIMULATION_PENDING_TTL_MS (${pendingTtlMs}) menor que o maior orçamento de banco (${longestBankBudgetMs})`,
    );
  }
  const shutdownBudget = vars.SHUTDOWN_DRAIN_MS + vars.SHUTDOWN_ABORT_GRACE_MS;
  if (shutdownBudget > DOCKER_STOP_GRACE_MS - SHUTDOWN_HEADROOM_MS) {
    problems.push(
      `SHUTDOWN_DRAIN_MS + SHUTDOWN_ABORT_GRACE_MS (${shutdownBudget}) deve caber em ${
        DOCKER_STOP_GRACE_MS - SHUTDOWN_HEADROOM_MS
      } ms (docker stop espera 10 s)`,
    );
  }
  if (problems.length > 0) {
    throw new ConfigError(`Variáveis de ambiente inválidas:\n- ${problems.join('\n- ')}`);
  }

  return {
    http: {
      host: vars.HOST,
      port: vars.PORT,
      corsOrigins: vars.CORS_ORIGIN,
      trustProxy: vars.TRUST_PROXY,
      rateLimit: {
        postMax: vars.RATE_LIMIT_POST_MAX,
        getMax: vars.RATE_LIMIT_GET_MAX,
        windowMs: vars.RATE_LIMIT_WINDOW_MS,
      },
    },
    logLevel: vars.LOG_LEVEL,
    databaseUrl: vars.DATABASE_URL,
    marginPolicy: {
      percent: vars.MARGIN_PERCENT,
      referenceMonthlyRate: vars.MARGIN_REFERENCE_MONTHLY_RATE,
    },
    pendingTtlMs,
    shutdown: { drainMs: vars.SHUTDOWN_DRAIN_MS, abortGraceMs: vars.SHUTDOWN_ABORT_GRACE_MS },
    banks,
  };
}
