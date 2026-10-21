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
  BETA_REASON_MESSAGES,
  BETA_RESULT_CODES,
  type BetaErrorResponse,
  type BetaRequest,
  type BetaResponse,
  betaRequestSchema,
  formatBetaMoney,
  parseBetaMoney,
} from './contract';
import { type BetaDecision, evaluateBeta } from './rules';

export const BETA_PATH = '/api/v2/simulations';

const BAD_GATEWAY_HTML =
  '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';

export interface BetaServerOptions extends BankDeps {
  config: BankRuntimeConfig;
}

function toBetaResponse(request: BetaRequest, decision: BetaDecision): BetaResponse {
  if (decision.outcome === 'REJECTED') {
    return {
      result_code: BETA_RESULT_CODES.REJECTED,
      result_message: BETA_REASON_MESSAGES[decision.reasonCode],
      reason_code: decision.reasonCode,
    };
  }
  const approved = decision.outcome === 'APPROVED';
  return {
    result_code: approved ? BETA_RESULT_CODES.APPROVED : BETA_RESULT_CODES.PARTIALLY_APPROVED,
    result_message: approved ? 'APROVADO' : 'APROVADO PARCIAL',
    proposal: {
      approved_amount: formatBetaMoney(decision.amountCents),
      term_months: request.term_months,
      monthly_rate_pct: (decision.monthlyRate * 100).toFixed(2),
      installment_amount: formatBetaMoney(decision.installmentCents),
    },
  };
}

export function buildBetaServer({
  config,
  random,
  sleep,
  now,
  logLevel,
}: BetaServerOptions): FastifyInstance {
  const { app, shutdownSignal } = createBaseServer('beta', logLevel);

  app.setErrorHandler<Error & { statusCode?: number }>((error, request, reply) => {
    const status = errorStatusCode(error);
    if (status < 500) {
      const body: BetaErrorResponse = {
        result_code: BETA_RESULT_CODES.INVALID_REQUEST,
        result_message: 'REQUISICAO INVALIDA',
      };
      return reply.code(status).send(body);
    }
    request.log.error({ err: error }, 'beta internal error');
    const body: BetaErrorResponse = {
      result_code: BETA_RESULT_CODES.INTERNAL_ERROR,
      result_message: 'ERRO INTERNO',
    };
    return reply.code(status).send(body);
  });

  app.post<{ Body: BetaRequest; Headers: ScenarioHeaders }>(
    BETA_PATH,
    { schema: { body: betaRequestSchema, headers: scenarioHeadersSchema } },
    async (request, reply) => {
      const scenario = resolveScenario(request.headers[SCENARIO_HEADER], config, random);
      await waitForScenario(scenario, { ...config, random, sleep, signal: shutdownSignal });

      switch (scenario) {
        case 'error':
          // A proxy in front of the bank answers, so the body is HTML, not JSON.
          return reply.code(502).type('text/html').send(BAD_GATEWAY_HTML);
        case 'malformed':
          return sendMalformedJson(reply, '{"result_code":0,"proposal":{"approved_amount":"10');
        case 'invalid-shape':
          return reply.send({
            result_code: '0',
            proposal: { approved_amount: 10000, term_months: '48' },
          });
        case 'ok':
        case 'timeout': {
          const body = request.body;
          const decision = evaluateBeta(
            {
              employmentType: body.employment_type,
              birthDate: body.borrower_birth_date,
              netSalaryCents: parseBetaMoney(body.net_salary),
              requestedAmountCents: parseBetaMoney(body.requested_amount),
              termMonths: body.term_months,
            },
            now(),
          );
          return reply.send(toBetaResponse(body, decision));
        }
      }
    },
  );

  return app;
}
