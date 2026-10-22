import { pino } from 'pino';
import type { Logger } from '../application/ports/logger';

/** A real pino logger writing JSON lines to memory, so tests see exactly what would be logged. */
export function createCaptureLogger() {
  const lines: string[] = [];
  const logger: Logger = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });

  return {
    logger,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
