import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client';

export type { PrismaClient };

/**
 * Prisma Client over better-sqlite3. WAL lets reads (the polling GET) proceed while a bank
 * result is being written; busy_timeout makes concurrent writers wait instead of failing.
 */
export async function createPrismaClient(databaseUrl: string): Promise<PrismaClient> {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 5_000 }),
  });
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  return prisma;
}
