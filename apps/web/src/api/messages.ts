// Customer-facing texts (Portuguese) for outcomes the API did not explain itself: no answer,
// an answer that is not the API's JSON, or a status whose body brought no message.
export const API_MESSAGES = {
  NETWORK: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
  TIMEOUT: 'O servidor demorou demais para responder. Tente novamente.',
  UNEXPECTED: 'Ocorreu um erro inesperado. Tente novamente.',
  NOT_FOUND: 'Simulação não encontrada ou expirada.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  UNAVAILABLE: 'O serviço está indisponível no momento. Tente novamente em instantes.',
} as const;
