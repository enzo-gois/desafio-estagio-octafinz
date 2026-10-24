import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino';

/**
 * Fields that must never appear in clear in a log line. Second line of defense: the first is
 * never logging request bodies or customer input at all.
 */
export const REDACTED_FIELDS = [
  'cpf',
  'name',
  'email',
  'birthDate',
  'netSalaryCents',
  'employerCnpj',
  'marginCents',
  'estimatedInstallmentCents',
] as const;

// pino's redact has no "any depth" wildcard, so each field is listed at the first three levels.
const REDACT_PATHS = REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]);

interface SerializableRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

interface SerializableReply {
  statusCode?: number;
}

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      // Method, URL and request id only: no headers, no body, no client IP (personal data).
      req: (request: SerializableRequest) => ({
        id: request.id,
        method: request.method,
        url: request.url,
      }),
      res: (reply: SerializableReply) => ({ statusCode: reply.statusCode }),
    },
  };
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return destination ? pino(loggerOptions(level), destination) : pino(loggerOptions(level));
}

/**
 * Exits once the logger has written everything it holds. pino's default stdout destination is
 * asynchronous, so a line logged right before process.exit may still be in its buffer.
 */
export function flushThenExit(
  logger: Logger,
  code: number,
  exit: (code: number) => void = (exitCode) => process.exit(exitCode),
): void {
  logger.flush(() => exit(code));
}
