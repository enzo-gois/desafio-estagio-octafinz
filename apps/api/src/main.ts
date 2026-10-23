import { randomUUID } from 'node:crypto';
import { CreateSimulation } from './application/create-simulation';
import { GetSimulation, PENDING_EXPIRED_MESSAGE } from './application/get-simulation';
import { SimulationOrchestrator } from './application/simulation-orchestrator';
import { buildApp } from './http/app';
import { createLogger } from './http/logger-options';
import { BANK_CATALOG, createBankProviders } from './infra/banks/registry';
import { type AppConfig, loadAppConfig } from './infra/config/env';
import { systemClock } from './infra/http/clock';
import { createPrismaClient } from './infra/persistence/prisma-client';
import { PrismaSimulationRepository } from './infra/persistence/prisma-simulation-repository';

// Exit on our own just before docker's SIGKILL (10 s after SIGTERM) if something hangs.
const HARD_STOP_MS = 9_500;

let config: AppConfig;
try {
  config = loadAppConfig(process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const logger = createLogger(config.logLevel);

try {
  const prisma = await createPrismaClient(config.databaseUrl);
  const repository = new PrismaSimulationRepository(prisma);

  // Decision E3 (at boot): results a previous process left PENDING when it stopped.
  const expired = await repository.expirePending(
    new Date(systemClock.now() - config.pendingTtlMs),
    PENDING_EXPIRED_MESSAGE,
  );
  if (expired > 0) logger.warn({ expired }, 'expired PENDING bank results from a previous run');

  const orchestrator = new SimulationOrchestrator({
    providers: createBankProviders(config.banks, {
      fetch: globalThis.fetch,
      clock: systemClock,
      random: Math.random,
      logger,
    }),
    repository,
    clock: systemClock,
    logger,
  });

  const app = await buildApp({
    logger,
    corsOrigins: config.http.corsOrigins,
    trustProxy: config.http.trustProxy,
    rateLimit: config.http.rateLimit,
    banks: BANK_CATALOG,
    createSimulation: new CreateSimulation({
      repository,
      starter: orchestrator,
      clock: systemClock,
      generateId: randomUUID,
      marginPolicy: config.marginPolicy,
    }),
    getSimulation: new GetSimulation({
      repository,
      clock: systemClock,
      pendingTtlMs: config.pendingTtlMs,
      banks: BANK_CATALOG,
    }),
  });

  await app.listen({ host: config.http.host, port: config.http.port });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => {
      logger.error('shutdown did not finish in time; exiting');
      process.exit(1);
    }, HARD_STOP_MS).unref();

    logger.info({ signal }, 'shutting down');
    // HTTP stays up while draining: POST answers 503, GET keeps serving the polling.
    const { drained, aborted } = await orchestrator.shutdown(config.shutdown);
    logger.info({ drained, aborted }, 'bank calls finished');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
} catch (error) {
  logger.error({ err: error }, 'API failed to start');
  process.exit(1);
}
