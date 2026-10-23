import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ServiceUnavailableError } from '../application/create-simulation';

// Customer-facing messages (Portuguese). Bodies never include stack traces or internals.
export const HTTP_MESSAGES = {
  INVALID_DATA: 'Dados inválidos.',
  INVALID_BODY: 'Corpo da requisição inválido.',
  NOT_FOUND: 'Simulação não encontrada.',
  ROUTE_NOT_FOUND: 'Recurso não encontrado.',
  UNSUPPORTED_MEDIA_TYPE: 'Envie os dados em JSON.',
  PAYLOAD_TOO_LARGE: 'Requisição grande demais.',
  RATE_LIMITED: 'Muitas requisições. Tente novamente em instantes.',
  SHUTTING_DOWN: 'O serviço está reiniciando. Tente novamente em instantes.',
  INTERNAL: 'Erro interno. Tente novamente.',
} as const;

const CLIENT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: HTTP_MESSAGES.INVALID_BODY,
  404: HTTP_MESSAGES.ROUTE_NOT_FOUND,
  413: HTTP_MESSAGES.PAYLOAD_TOO_LARGE,
  415: HTTP_MESSAGES.UNSUPPORTED_MEDIA_TYPE,
  429: HTTP_MESSAGES.RATE_LIMITED,
};

/**
 * 400 body with one list of messages per field, for the form to show next to each input. The
 * messages come from the shared schema, already in Portuguese. A body that is not even an
 * object has no field errors, only the generic message.
 */
export function validationErrorBody(error: z.ZodError) {
  const { formErrors, fieldErrors } = z.flattenError(error);
  return formErrors.length > 0 && Object.keys(fieldErrors).length === 0
    ? { message: HTTP_MESSAGES.INVALID_BODY, errors: {} }
    : { message: HTTP_MESSAGES.INVALID_DATA, errors: fieldErrors };
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ServiceUnavailableError) {
    return reply
      .code(503)
      .header('retry-after', '5')
      .send({ message: HTTP_MESSAGES.SHUTTING_DOWN });
  }

  // Errors raised by Fastify or its plugins for a bad request (invalid JSON, wrong content
  // type, body too large, rate limit) keep their status with a Portuguese message.
  const status = error.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    return reply
      .code(status)
      .send({ message: CLIENT_ERROR_MESSAGES[status] ?? HTTP_MESSAGES.INVALID_BODY });
  }

  request.log.error({ err: error }, 'unhandled error');
  return reply.code(500).send({ message: HTTP_MESSAGES.INTERNAL });
}
