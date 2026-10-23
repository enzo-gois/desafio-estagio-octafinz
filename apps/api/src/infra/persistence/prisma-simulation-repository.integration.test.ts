import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe } from 'vitest';
import { createPrismaClient, type PrismaClient } from './prisma-client';
import { PrismaSimulationRepository } from './prisma-simulation-repository';
import { simulationRepositoryContract } from './simulation-repository.contract';

// Real SQLite file, schema created by the real migrations (prisma migrate deploy), so the
// test also proves the committed migrations match what the repository expects.
const API_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PRISMA_CLI = join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js');

describe('PrismaSimulationRepository (SQLite)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'simulador-db-'));
  const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  let prisma: PrismaClient | undefined;
  let repository: PrismaSimulationRepository;

  beforeAll(async () => {
    try {
      execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
        cwd: API_ROOT,
        // CHECKPOINT_DISABLE: no telemetry call from the Prisma CLI during tests.
        env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1' },
        stdio: 'pipe',
      });
    } catch (error) {
      // Surface the CLI's own output instead of a bare "Command failed".
      const output = String((error as { stderr?: Buffer }).stderr ?? (error as Error).message);
      throw new Error(`prisma migrate deploy failed:\n${output}`, { cause: error });
    }
    prisma = await createPrismaClient(databaseUrl);
    repository = new PrismaSimulationRepository(prisma);
  });

  afterAll(async () => {
    // Optional chaining: if beforeAll failed, report that failure only, not a second one here.
    await prisma?.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  simulationRepositoryContract(() => repository);
});
