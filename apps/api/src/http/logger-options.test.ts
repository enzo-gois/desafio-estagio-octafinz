import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { CUSTOMER } from '../testing/bank-fixtures';
import { createLogger, flushThenExit } from './logger-options';

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

describe('flushThenExit', () => {
  it('exits only after the last line reached the destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'simulador-log-'));
    const file = join(directory, 'api.log');
    // Asynchronous like pino's default stdout, with a buffer large enough to hold the line.
    const destination = pino.destination({ dest: file, sync: false, minLength: 4096 });
    try {
      await once(destination, 'ready');
      const logger = createLogger('info', destination);

      logger.info('shutdown complete');
      // Still buffered: a process.exit here would lose the line.
      expect(readFileSync(file, 'utf8')).toBe('');

      const exitCode = await new Promise<number>((resolve) => flushThenExit(logger, 0, resolve));

      expect(exitCode).toBe(0);
      expect(readFileSync(file, 'utf8')).toContain('"msg":"shutdown complete"');
    } finally {
      destination.end();
      await once(destination, 'close');
      // Retries: on Windows a file closed a moment ago may still be locked.
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
