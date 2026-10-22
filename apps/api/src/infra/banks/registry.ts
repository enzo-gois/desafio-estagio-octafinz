import type { BankProvider } from '../../application/ports/bank-provider';
import type { Logger } from '../../application/ports/logger';
import type { Clock } from '../http/clock';
import { ResilientHttpClient } from '../http/resilient-http-client';
import { createAlfaAdapter } from './alfa/alfa-adapter';
import { BANK_IDS, type BankId, type BanksConfig } from './bank-config';
import { createBetaAdapter } from './beta/beta-adapter';
import type { BankAdapterDeps } from './common/bank-adapter';
import { createGamaAdapter } from './gama/gama-adapter';

export interface BankProviderDeps {
  fetch: typeof fetch;
  clock: Clock;
  random: () => number;
  logger: Logger;
}

const ADAPTER_FACTORIES: Record<BankId, (deps: BankAdapterDeps) => BankProvider> = {
  alfa: createAlfaAdapter,
  beta: createBetaAdapter,
  gama: createGamaAdapter,
};

/** One provider per bank, each with its own HTTP client and therefore its own circuit breaker. */
export function createBankProviders(config: BanksConfig, deps: BankProviderDeps): BankProvider[] {
  return BANK_IDS.map((id) => {
    const endpoint = config.banks[id];
    const breakerLogger = deps.logger.child({ bankId: id });
    const client = new ResilientHttpClient(
      {
        timeoutMs: endpoint.timeoutMs,
        attemptTimeoutMs: endpoint.attemptTimeoutMs,
        maxAttempts: endpoint.maxAttempts,
        ...config.retry,
        breaker: config.breaker,
      },
      deps,
      (from, to) => breakerLogger.warn({ from, to }, 'circuit breaker state changed'),
    );
    return ADAPTER_FACTORIES[id]({ endpoint, client, logger: deps.logger });
  });
}
