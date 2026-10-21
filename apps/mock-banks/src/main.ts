import type { FastifyInstance } from 'fastify';
import { buildAlfaServer } from './banks/alfa/server';
import { buildBetaServer } from './banks/beta/server';
import { buildGamaServer } from './banks/gama/server';
import { type MockBanksConfig, loadConfig } from './config';
import { abortableSleep } from './runtime/sleep';

let config: MockBanksConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`Configuração inválida dos bancos simulados: ${(error as Error).message}`);
  process.exit(1);
}

const deps = {
  random: Math.random,
  sleep: abortableSleep,
  now: () => new Date(),
  logLevel: config.logLevel,
};

const banks: { name: string; port: number; app: FastifyInstance }[] = [
  { name: 'alfa', port: config.alfa.port, app: buildAlfaServer({ ...deps, config: config.alfa }) },
  { name: 'beta', port: config.beta.port, app: buildBetaServer({ ...deps, config: config.beta }) },
  { name: 'gama', port: config.gama.port, app: buildGamaServer({ ...deps, config: config.gama }) },
];

async function closeAll(): Promise<void> {
  await Promise.allSettled(banks.map(({ app }) => app.close()));
}

try {
  await Promise.all(banks.map(({ app, port }) => app.listen({ host: config.host, port })));
} catch (error) {
  // Never keep running with only some banks up.
  console.error('Falha ao subir os bancos simulados:', error);
  await closeAll();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void closeAll().then(() => process.exit(0));
  });
}
