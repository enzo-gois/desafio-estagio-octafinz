import type { FastifyInstance } from 'fastify';
import type { GamaRuntimeConfig } from '../../config';
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
  type GamaErrorResponse,
  type GamaRequest,
  type GamaResponse,
  centsToReais,
  gamaRequestSchema,
  reaisToCents,
} from './contract';
import { type GamaDecision, evaluateGama } from './rules';

export const GAMA_PATH = '/simulate';
export const GAMA_RETRY_AFTER_SECONDS = 2;

export interface GamaServerOptions extends BankDeps {
  config: GamaRuntimeConfig;
}

function toGamaResponse(request: GamaRequest, decision: GamaDecision): GamaResponse {
  if (!decision.accepted) return { decision: 'DECLINE', declineReasons: decision.reasons };
  return {
    decision: 'ACCEPT',
    terms: {
      principal: request.loan.amount,
      months: request.loan.termMonths,
      ratePercent: Number((decision.monthlyRate * 100).toFixed(2)),
      monthlyPayment: centsToReais(decision.installmentCents),
    },
  };
}

export function buildGamaServer({
  config,
  random,
  sleep,
  now,
  logLevel,
}: GamaServerOptions): FastifyInstance {
  const { app, shutdownSignal } = createBaseServer('gama', logLevel);

  app.setErrorHandler<Error & { statusCode?: number }>((error, request, reply) => {
    const status = errorStatusCode(error);
    if (status < 500) {
      return reply.code(status).send({ message: 'Bad Request' } satisfies GamaErrorResponse);
    }
    request.log.error({ err: error }, 'gama internal error');
    return reply
      .code(status)
      .send({ message: 'Internal Server Error' } satisfies GamaErrorResponse);
  });

  app.post<{ Body: GamaRequest; Headers: ScenarioHeaders }>(
    GAMA_PATH,
    { schema: { body: gamaRequestSchema, headers: scenarioHeadersSchema } },
    async (request, reply) => {
      const scenario = resolveScenario(request.headers[SCENARIO_HEADER], config, random);
      await waitForScenario(scenario, { ...config, random, sleep, signal: shutdownSignal });

      switch (scenario) {
        case 'error':
          return reply
            .code(503)
            .header('retry-after', String(GAMA_RETRY_AFTER_SECONDS))
            .send({ message: 'Service temporarily unavailable' } satisfies GamaErrorResponse);
        case 'malformed':
          return sendMalformedJson(reply, '{"decision":"ACCEPT","terms":{"principal":100');
        case 'invalid-shape':
          return reply.send({ decision: 'ACCEPT', terms: { principal: '10000.00', months: 48 } });
        case 'ok':
        case 'timeout': {
          const body = request.body;
          const decision = evaluateGama(
            {
              birthDate: body.applicant.dateOfBirth,
              employerCnpj: body.employer.cnpj,
              netIncomeCents: reaisToCents(body.income.netMonthly),
              amountCents: reaisToCents(body.loan.amount),
              termMonths: body.loan.termMonths,
            },
            now(),
            config.restrictedCnpjs,
          );
          return reply.send(toGamaResponse(body, decision));
        }
      }
    },
  );

  return app;
}
