import type { FastifyInstance } from 'fastify';
import { toBankCatalogView } from '../../application/bank-catalog-view';
import type { BankDescriptor } from '../../application/ports/bank-catalog';

export interface BankRoutesOptions {
  banks: readonly BankDescriptor[];
  rateLimit: { max: number; windowMs: number };
}

export async function bankRoutes(app: FastifyInstance, options: BankRoutesOptions): Promise<void> {
  // Fixed for the life of the process: built once, not per request.
  const catalog = toBankCatalogView(options.banks);

  app.get(
    '/banks',
    {
      config: { rateLimit: { max: options.rateLimit.max, timeWindow: options.rateLimit.windowMs } },
    },
    async (_request, reply) =>
      // Changes on deploy: a cached copy would show an outdated consent text and version.
      reply.header('cache-control', 'no-store').send(catalog),
  );
}
