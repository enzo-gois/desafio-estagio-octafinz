import Fastify, { type FastifyInstance } from 'fastify';

export class ShutdownError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Server is shutting down');
    this.name = 'ShutdownError';
  }
}

export interface BaseServer {
  app: FastifyInstance;
  shutdownSignal: AbortSignal;
}

export function createBaseServer(bankId: string, logLevel?: string): BaseServer {
  const app = Fastify({
    // Without a level, logging is off (tests). Request bodies are never logged.
    logger: logLevel === undefined ? false : { level: logLevel, base: { bank: bankId } },
    ajv: {
      // Fastify defaults to coercing types and dropping unknown fields. A real bank
      // would reject "1000" for an integer or an extra field, so the mock does too.
      customOptions: { coerceTypes: false, removeAdditional: false },
    },
    // close() destroys every connection, not only the ones idle at that instant. A response
    // finishing during close (e.g. a "timeout" scenario cut short by preClose) would otherwise
    // leave a keep-alive connection open for Fastify's 72 s keep-alive timeout.
    forceCloseConnections: true,
  });

  const shutdown = new AbortController();
  // preClose runs before in-flight requests are awaited; onClose would only run after
  // them, i.e. after a pending 30s sleep.
  app.addHook('preClose', async () => {
    shutdown.abort(new ShutdownError());
  });

  return { app, shutdownSignal: shutdown.signal };
}

export function errorStatusCode(error: { statusCode?: number }): number {
  const { statusCode } = error;
  return statusCode !== undefined && statusCode >= 400 && statusCode < 600 ? statusCode : 500;
}
