import { describe, expect, it } from 'vitest';
import { CUSTOMER } from '../testing/bank-fixtures';
import { createLogger } from './logger-options';

function capture() {
  const lines: string[] = [];
  const logger = createLogger('info', { write: (line: string) => lines.push(line) });
  return { logger, text: () => lines.join('\n') };
}

describe('logger options', () => {
  it.each([
    ['at the top level', CUSTOMER],
    ['one level deep', { input: CUSTOMER }],
    ['two levels deep', { request: { body: CUSTOMER } }],
  ])('redacts personal data logged by mistake %s', (_, bindings) => {
    const { logger, text } = capture();
    logger.info(bindings, 'oops');

    for (const value of [
      CUSTOMER.cpf,
      CUSTOMER.name,
      CUSTOMER.email,
      CUSTOMER.birthDate,
      '734219',
    ]) {
      expect(text()).not.toContain(value);
    }
    expect(text()).toContain('[REDACTED]');
  });

  it('serializes requests without headers, body or client IP', () => {
    const { logger, text } = capture();
    logger.info(
      {
        req: {
          id: 'req-1',
          method: 'POST',
          url: '/simulations',
          headers: { authorization: 'secret' },
          body: CUSTOMER,
          ip: '203.0.113.7',
          socket: { remoteAddress: '203.0.113.7' },
        },
      },
      'incoming request',
    );

    expect(JSON.parse(text())).toMatchObject({
      req: { id: 'req-1', method: 'POST', url: '/simulations' },
    });
    expect(text()).not.toContain('203.0.113.7');
    expect(text()).not.toContain('secret');
  });
});
