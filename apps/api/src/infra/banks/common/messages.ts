import type { TransportFailure } from '../../http/resilient-http-client';

// Customer-facing texts (Portuguese) for results that are not a bank's own decision.

export const UNAVAILABLE_MESSAGES: Readonly<Record<TransportFailure | 'TRANSIENT_STATUS', string>> =
  {
    TIMEOUT: 'O banco não respondeu a tempo.',
    NETWORK: 'Não foi possível conectar ao banco.',
    CIRCUIT_OPEN: 'O banco está temporariamente indisponível.',
    TRANSIENT_STATUS: 'O banco está temporariamente indisponível.',
    ABORTED: 'A consulta foi cancelada.',
  };

export const ERROR_MESSAGES = {
  INVALID_RESPONSE: 'O banco retornou uma resposta inválida.',
  REQUEST_REJECTED: 'Não foi possível processar a consulta neste banco.',
  BANK_INTERNAL_ERROR: 'O banco encontrou um erro interno.',
  UNEXPECTED_RESPONSE: 'O banco retornou uma resposta inesperada.',
} as const;

export const GENERIC_DENIAL = 'O banco não aprovou a simulação.';
