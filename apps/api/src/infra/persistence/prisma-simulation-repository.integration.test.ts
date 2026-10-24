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

// `migrate deploy` starts a separate Node process (CLI load, schema engine): ~1.5 s on its own,
// but past Vitest's default 10 s hook timeout when the machine is busy, e.g. right after the
// whole unit suite. A timed-out hook keeps running, so afterAll then deletes a directory whose
// SQLite file is still open, and Windows answers EPERM: a second failure caused by the first.
const SETUP_TIMEOUT_MS = 60_000;

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
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    // Optional chaining: if beforeAll failed, report that failure only, not a second one here.
    await prisma?.$disconnect();
    // Retries: on Windows a file closed a moment ago may still be locked (EPERM/EBUSY).
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  simulationRepositoryContract(() => repository);
});
