import { SIMULATION_DATA_FIELDS, type SimulationDataField } from '@simulador/shared';
import type { BankDescriptor } from '../../application/ports/bank-catalog';
import type { BankProvider } from '../../application/ports/bank-provider';
import type { Logger } from '../../application/ports/logger';
import type { Clock } from '../http/clock';
import { ResilientHttpClient } from '../http/resilient-http-client';
import { ALFA_SHARED_FIELDS, createAlfaAdapter } from './alfa/alfa-adapter';
import { BANK_IDS, type BankId, type BanksConfig } from './bank-config';
import { BETA_SHARED_FIELDS, createBetaAdapter } from './beta/beta-adapter';
import type { BankAdapterDeps } from './common/bank-adapter';
import { createGamaAdapter, GAMA_SHARED_FIELDS } from './gama/gama-adapter';

export interface BankProviderDeps {
  fetch: typeof fetch;
  clock: Clock;
  random: () => number;
  logger: Logger;
}

export interface BankRegistration {
  /** Shown to the customer in the consent text and on the result cards. */
  displayName: string;
  /** Declared by the adapter, next to its toRequestBody. */
  sharedFields: readonly SimulationDataField[];
  create: (deps: BankAdapterDeps) => BankProvider;
}

// Adding a bank is its adapter plus one entry here (and its endpoint in bank-config). A new name
// or field list changes the consent text: consent-version.test.ts asks for a new CONSENT_VERSION.
export const BANK_REGISTRY: Readonly<Record<BankId, BankRegistration>> = {
  alfa: { displayName: 'Banco Alfa', sharedFields: ALFA_SHARED_FIELDS, create: createAlfaAdapter },
  beta: { displayName: 'Banco Beta', sharedFields: BETA_SHARED_FIELDS, create: createBetaAdapter },
  gama: { displayName: 'Banco Gama', sharedFields: GAMA_SHARED_FIELDS, create: createGamaAdapter },
};

/** Every bank, in BANK_IDS order, as GET /banks and the simulation view describe it. */
export const BANK_CATALOG: readonly BankDescriptor[] = BANK_IDS.map((id) => {
  const { displayName, sharedFields } = BANK_REGISTRY[id];
  // Form order, whatever order the adapter declared them in: the consent text reads the same.
  return {
    id,
    displayName,
    sharedFields: SIMULATION_DATA_FIELDS.filter((field) => sharedFields.includes(field)),
  };
});

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
    return BANK_REGISTRY[id].create({ endpoint, client, logger: deps.logger });
  });
}
