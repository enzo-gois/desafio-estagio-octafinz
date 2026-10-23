import { simulationInputSchema } from '@simulador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CreateSimulation } from '../../application/create-simulation';
import type { GetSimulation } from '../../application/get-simulation';
import { HTTP_MESSAGES, validationErrorBody } from '../errors';

export interface SimulationRoutesOptions {
  createSimulation: Pick<CreateSimulation, 'execute'>;
  getSimulation: Pick<GetSimulation, 'execute'>;
  rateLimit: { postMax: number; getMax: number; windowMs: number };
}

const idSchema = z.uuid();

// Thin controllers: validate, call the use case, shape the HTTP response.
export async function simulationRoutes(
  app: FastifyInstance,
  options: SimulationRoutesOptions,
): Promise<void> {
  const { createSimulation, getSimulation, rateLimit } = options;

  app.post(
    '/simulations',
    { config: { rateLimit: { max: rateLimit.postMax, timeWindow: rateLimit.windowMs } } },
    async (request, reply) => {
      const parsed = simulationInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send(validationErrorBody(parsed.error));

      const { id } = await createSimulation.execute(parsed.data);
      // Links this request's reqId to the simulationId the bank adapters log with.
      request.log.info({ simulationId: id }, 'simulation created');
      return reply
        .code(202)
        .header('location', `/simulations/${id}`)
        .header('cache-control', 'no-store')
        .send({ id });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/simulations/:id',
    // Generous: the front polls this route while the banks answer.
    { config: { rateLimit: { max: rateLimit.getMax, timeWindow: rateLimit.windowMs } } },
    async (request, reply) => {
      // Polled for changing results: no cache layer may serve a stale state.
      reply.header('cache-control', 'no-store');

      // A malformed id is answered exactly like an unknown one: there is no simulation here.
      const id = idSchema.safeParse(request.params.id);
      const view = id.success ? await getSimulation.execute(id.data) : undefined;
      if (!view) return reply.code(404).send({ message: HTTP_MESSAGES.NOT_FOUND });

      return reply.send(view);
    },
  );
}
