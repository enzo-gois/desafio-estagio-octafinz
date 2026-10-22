import {
  type BankResult,
  bankResultSchema,
  type Offer,
  type SimulationInput,
} from '@simulador/shared';
import type { z } from 'zod';
import type { BankProvider } from '../../../application/ports/bank-provider';
import type { Logger } from '../../../application/ports/logger';
import type { HttpOutcome, HttpRequest, HttpSender } from '../../http/resilient-http-client';
import { RETRYABLE_STATUSES } from '../../http/retry-policy';
import type { BankEndpointConfig } from '../bank-config';
import { parseJson } from './json';
import { ERROR_MESSAGES, GENERIC_DENIAL, UNAVAILABLE_MESSAGES } from './messages';

/** A bank's answer, already validated and translated to our units (cents, fraction rates). */
export type BankDecision =
  { status: 'APPROVED'; offer: Offer } | { status: 'DENIED'; reasonCodes: readonly string[] };

/** What differs between banks. Everything else (HTTP, errors, logging) is shared below. */
export interface BankAdapterSpec<TResponse> {
  id: string;
  path: string;
  toRequestBody(input: SimulationInput): unknown;
  responseSchema: z.ZodType<TResponse>;
  toDecision(response: TResponse): BankDecision;
  /** Bank reason code -> Portuguese message. A Map, so codes like "constructor" are not found. */
  reasonMessages: ReadonlyMap<string, string>;
}

export interface BankAdapterDeps {
  endpoint: BankEndpointConfig;
  client: HttpSender;
  logger: Logger;
}

// Logged reason codes come from the bank: cap their size so a misbehaving bank cannot flood logs.
const MAX_LOGGED_CODE_LENGTH = 64;

function translateReasons(
  codes: readonly string[],
  messages: ReadonlyMap<string, string>,
  logger: Logger,
): string {
  const translated = new Set<string>();
  for (const code of codes) {
    const message = messages.get(code);
    if (message === undefined) {
      logger.warn(
        { reasonCode: code.slice(0, MAX_LOGGED_CODE_LENGTH) },
        'unknown denial reason code; using generic message',
      );
      translated.add(GENERIC_DENIAL);
    } else {
      translated.add(message);
    }
  }
  return [...translated].join(' ');
}

function toBankResult<T>(
  spec: BankAdapterSpec<T>,
  outcome: HttpOutcome,
  logger: Logger,
): BankResult {
  // Only these metadata are ever logged: never request or response bodies, which carry (or
  // may echo) the customer's CPF, salary or name.
  const stats = { latencyMs: Math.round(outcome.elapsedMs), attempts: outcome.attempts };
  const meta = { ...stats, ...(outcome.kind === 'response' && { httpStatus: outcome.status }) };
  const unavailable = (reason: string): BankResult => ({
    bankId: spec.id,
    status: 'UNAVAILABLE',
    reason,
    ...stats,
  });
  const error = (reason: string): BankResult => ({
    bankId: spec.id,
    status: 'ERROR',
    reason,
    ...stats,
  });

  if (outcome.kind === 'failure') {
    const log = outcome.reason === 'ABORTED' ? logger.info : logger.warn;
    log.call(logger, { ...meta, failure: outcome.reason }, 'bank did not answer');
    return unavailable(UNAVAILABLE_MESSAGES[outcome.reason]);
  }

  const { status } = outcome;
  if (RETRYABLE_STATUSES.has(status)) {
    logger.warn(meta, 'bank unavailable after retries');
    return unavailable(UNAVAILABLE_MESSAGES.TRANSIENT_STATUS);
  }
  if (status === 400) {
    // The bank says our request is invalid: an adapter/contract bug on our side.
    logger.error(
      { ...meta, alert: 'BANK_REJECTED_OUR_REQUEST' },
      'bank rejected our request with 400; adapter and bank contract diverge',
    );
    return error(ERROR_MESSAGES.REQUEST_REJECTED);
  }
  if (status === 500) {
    logger.error(meta, 'bank internal error');
    return error(ERROR_MESSAGES.BANK_INTERNAL_ERROR);
  }
  if (status < 200 || status >= 300) {
    logger.error(meta, 'unexpected HTTP status from bank');
    return error(ERROR_MESSAGES.UNEXPECTED_RESPONSE);
  }

  const json = parseJson(outcome.bodyText);
  if (!json.ok) {
    logger.error(meta, 'bank sent malformed JSON');
    return error(ERROR_MESSAGES.INVALID_RESPONSE);
  }

  const parsed = spec.responseSchema.safeParse(json.value);
  if (!parsed.success) {
    // Paths and codes only: Zod messages and inputs could carry values from the body.
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    }));
    logger.error({ ...meta, issues }, 'bank response does not match its contract');
    return error(ERROR_MESSAGES.INVALID_RESPONSE);
  }

  const decision = spec.toDecision(parsed.data);
  const result: BankResult =
    decision.status === 'APPROVED'
      ? { bankId: spec.id, status: 'APPROVED', offer: decision.offer, ...stats }
      : {
          bankId: spec.id,
          status: 'DENIED',
          reason: translateReasons(decision.reasonCodes, spec.reasonMessages, logger),
          ...stats,
        };

  // Last line of defense: whatever leaves the adapter respects the shared contract.
  const checked = bankResultSchema.safeParse(result);
  if (!checked.success) {
    logger.error(meta, 'adapter produced a BankResult outside the shared contract');
    return error(ERROR_MESSAGES.INVALID_RESPONSE);
  }

  logger.info(
    {
      ...meta,
      status: result.status,
      ...(decision.status === 'DENIED' && {
        reasonCodes: decision.reasonCodes.map((code) => code.slice(0, MAX_LOGGED_CODE_LENGTH)),
      }),
    },
    'bank answered',
  );
  return checked.data;
}

export function createBankAdapter<T>(
  spec: BankAdapterSpec<T>,
  deps: BankAdapterDeps,
): BankProvider {
  const logger = deps.logger.child({ bankId: spec.id });
  const url = new URL(spec.path, deps.endpoint.baseUrl).toString();

  return {
    id: spec.id,
    async simulate(input, signal, context) {
      const request: HttpRequest = {
        url,
        headers: {
          ...deps.endpoint.extraHeaders,
          'content-type': 'application/json',
          accept: 'application/json',
          // Same value on every attempt of this call: a retried POST (after a timeout the bank
          // may still have processed) must not create a second proposal.
          'idempotency-key': `${context.simulationId}:${spec.id}`,
        },
        body: JSON.stringify(spec.toRequestBody(input)),
      };

      try {
        return toBankResult(spec, await deps.client.send(request, signal), logger);
      } catch (cause) {
        // The client never throws by contract; if it does, it is a bug, not a bank answer.
        logger.error(
          { errorName: cause instanceof Error ? cause.name : typeof cause },
          'unexpected failure calling bank',
        );
        return { bankId: spec.id, status: 'ERROR', reason: ERROR_MESSAGES.UNEXPECTED_RESPONSE };
      }
    },
  };
}
