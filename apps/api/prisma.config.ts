import { defineConfig } from 'prisma/config';

// Used by the Prisma CLI (migrate, generate). The API reads DATABASE_URL itself at boot.
// Relative file: paths resolve from apps/api, where npm workspace scripts run.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? 'file:./data/simulador.db' },
});
