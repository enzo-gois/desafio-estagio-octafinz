import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { errorHandler, HTTP_MESSAGES } from './errors';
import { type SimulationRoutesOptions, simulationRoutes } from './routes/simulations';

export interface AppOptions extends SimulationRoutesOptions {
  /** A pino logger built with loggerOptions() (redaction, no bodies, no client IP). */
  logger: FastifyBaseLogger;
  corsOrigins: string[];
  trustProxy: boolean;
}

const BODY_LIMIT_BYTES = 16 * 1024;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: options.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Behind a proxy the rate limit must see the client's IP, not the proxy's.
    trustProxy: options.trustProxy,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);
  await app.register(cors, { origin: options.corsOrigins, methods: ['GET', 'POST'] });
  // Limits are set per route; the builder's result is thrown and handled by errorHandler.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      message: HTTP_MESSAGES.RATE_LIMITED,
    }),
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ message: HTTP_MESSAGES.ROUTE_NOT_FOUND }),
  );

  await app.register(simulationRoutes, {
    createSimulation: options.createSimulation,
    getSimulation: options.getSimulation,
    rateLimit: options.rateLimit,
  });

  return app;
}
