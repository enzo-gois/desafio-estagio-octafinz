import type { FastifyInstance } from 'fastify';
import type { HealthCheck } from '../../application/ports/health-check';

export interface HealthRoutesOptions {
  health: HealthCheck;
}

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  app.get(
    '/health',
    // Polled by the container healthcheck every few seconds: request logs only on failure.
    // No rate limit (limits are per route): a 429 would make a healthy API look down.
    { logLevel: 'warn' },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      try {
        await options.health.checkDatabase();
      } catch (error) {
        request.log.error({ err: error }, 'health check failed: database');
        return reply.code(503).send({ status: 'unavailable' });
      }
      return reply.send({ status: 'ok' });
    },
  );
}
