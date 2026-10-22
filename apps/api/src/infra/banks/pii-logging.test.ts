import { describe, expect, it } from 'vitest';
import type { BankProvider } from '../../application/ports/bank-provider';
import {
  CONTEXT,
  CUSTOMER,
  endpointFor,
  fixedSender,
  jsonResponse,
} from '../../testing/bank-fixtures';
import { createCaptureLogger } from '../../testing/capture-logger';
import type { HttpOutcome, HttpSender } from '../http/resilient-http-client';
import { createAlfaAdapter } from './alfa/alfa-adapter';
import type { BankAdapterDeps } from './common/bank-adapter';
import { createBetaAdapter } from './beta/beta-adapter';
import { createGamaAdapter } from './gama/gama-adapter';

// Every way the customer's data could appear in a log line.
const FORBIDDEN = [
  CUSTOMER.cpf, // 52998224725
  '529.982.247-25',
  'Maria',
  'Sauro',
  CUSTOMER.email,
  CUSTOMER.birthDate,
  '734219', // salary in cents
  '7342.19', // salary as Beta/Gama receive it
];

// A bank that echoes the customer's data back in an invalid response must not leak it either.
const ECHO = {
  status: 'MAYBE',
  customer: { taxId: CUSTOMER.cpf, name: CUSTOMER.name, salary: 7342.19 },
};

const OUTCOMES: Record<string, HttpOutcome> = {
  'denied with unknown code': jsonResponse({
    proposalId: 'x',
    status: 'REJECTED',
    rejectionReason: 'NEW',
    result_code: 2,
    reason_code: 'NEW',
    decision: 'DECLINE',
    declineReasons: ['NEW'],
  }),
  'malformed JSON echoing data': jsonResponse(`{"cpf":"${CUSTOMER.cpf}","name":"${CUSTOMER.name}`),
  'contract violation echoing data': jsonResponse(ECHO),
  'bad request echoing data': jsonResponse(ECHO, 400),
  'internal error': jsonResponse(ECHO, 500),
  unavailable: jsonResponse(ECHO, 503),
  redirect: jsonResponse('', 302),
  timeout: { kind: 'failure', reason: 'TIMEOUT', attempts: 3, elapsedMs: 3_000 },
  aborted: { kind: 'failure', reason: 'ABORTED', attempts: 1, elapsedMs: 10 },
};

const FACTORIES: Record<string, (deps: BankAdapterDeps) => BankProvider> = {
  alfa: createAlfaAdapter,
  beta: createBetaAdapter,
  gama: createGamaAdapter,
};

describe('adapter logs', () => {
  it('never contain CPF, name, e-mail, birth date or salary, in any scenario', async () => {
    const capture = createCaptureLogger();
    const throwing: HttpSender = { send: () => Promise.reject(new Error(`boom ${CUSTOMER.cpf}`)) };

    for (const [id, create] of Object.entries(FACTORIES)) {
      const senders = [
        ...Object.values(OUTCOMES).map((outcome) => fixedSender(outcome).sender),
        throwing,
      ];
      for (const client of senders) {
        const adapter = create({
          endpoint: endpointFor(id as 'alfa' | 'beta' | 'gama'),
          client,
          logger: capture.logger,
        });
        await adapter.simulate(CUSTOMER, new AbortController().signal, CONTEXT);
      }
    }

    // Guard against a vacuous pass: every adapter logged every scenario.
    expect(capture.lines.length).toBeGreaterThanOrEqual(3 * (Object.keys(OUTCOMES).length + 1));
    const everything = capture.lines.join('\n');
    for (const value of FORBIDDEN) expect(everything).not.toContain(value);
  });
});
