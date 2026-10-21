import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BankRuntimeConfig } from '../../config';
import type { BankDeps } from '../../runtime/deps';
import {
  SCENARIO_HEADER,
  type ScenarioHeaders,
  scenarioHeadersSchema,
  resolveScenario,
  sendMalformedJson,
  waitForScenario,
} from '../../runtime/scenario';
import { createBaseServer, errorStatusCode } from '../../runtime/server';
import {
  type AlfaErrorResponse,
  type AlfaRequest,
  type AlfaResponse,
  alfaRequestSchema,
} from './contract';
import { ALFA_MONTHLY_RATE, type AlfaDecision, evaluateAlfa } from './rules';

export const ALFA_PATH = '/v1/loan-simulations';

export interface AlfaServerOptions extends BankDeps {
  config: BankRuntimeConfig;
}

function toAlfaResponse(
  proposalId: string,
  request: AlfaRequest,
  decision: AlfaDecision,
): AlfaResponse {
  if (!decision.approved) {
    return { proposalId, status: 'REJECTED', rejectionReason: decision.reason };
  }
  return {
    proposalId,
    status: 'APPROVED',
    offer: {
      approvedAmountCents: request.requestedAmountCents,
      installments: request.installments,
      monthlyInterestRate: ALFA_MONTHLY_RATE,
      installmentAmountCents: decision.installmentCents,
    },
  };
}

export function buildAlfaServer({
  config,
  random,
  sleep,
  now,
  logLevel,
}: AlfaServerOptions): FastifyInstance {
  const { app, shutdownSignal } = createBaseServer('alfa', logLevel);

  app.setErrorHandler<Error & { statusCode?: number }>((error, request, reply) => {
    const status = errorStatusCode(error);
    if (status < 500) {
      const body: AlfaErrorResponse = {
        error: { code: 'INVALID_REQUEST', message: error.message },
      };
      return reply.code(status).send(body);
    }
    request.log.error({ err: error }, 'alfa internal error');
    const body: AlfaErrorResponse = { error: { code: 'INTERNAL_ERROR' } };
    return reply.code(status).send(body);
  });

  app.post<{ Body: AlfaRequest; Headers: ScenarioHeaders }>(
    ALFA_PATH,
    { schema: { body: alfaRequestSchema, headers: scenarioHeadersSchema } },
    async (request, reply) => {
      const scenario = resolveScenario(request.headers[SCENARIO_HEADER], config, random);
      await waitForScenario(scenario, { ...config, random, sleep, signal: shutdownSignal });

      const proposalId = `alfa-${randomUUID()}`;
      switch (scenario) {
        case 'error':
          return reply
            .code(500)
            .send({ error: { code: 'INTERNAL_ERROR' } } satisfies AlfaErrorResponse);
        case 'malformed':
          return sendMalformedJson(reply, `{"proposalId":"${proposalId}","status":"APPR`);
        case 'invalid-shape':
          return reply.send({ proposalId, status: 'MAYBE', offer: null });
        case 'ok':
        case 'timeout':
          return reply.send(
            toAlfaResponse(proposalId, request.body, evaluateAlfa(request.body, now())),
          );
      }
    },
  );

  return app;
}
