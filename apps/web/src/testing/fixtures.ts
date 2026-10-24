import {
  type BankCatalogView,
  type BankResultView,
  CONSENT_VERSION,
  type SimulationInput,
  type SimulationView,
} from '@simulador/shared';

export const SIMULATION_ID = '2f1c6b8e-4f5a-4b7e-9c3d-1a2b3c4d5e6f';

// What the form sends: already parsed by the shared schema (normalized documents).
export const INPUT: SimulationInput = {
  name: 'Maria Silva',
  email: 'maria@example.com',
  cpf: '52998224725',
  birthDate: '1985-04-12',
  employmentType: 'CLT',
  employerCnpj: '12ABC34501DE35',
  netSalaryCents: 500_000,
  requestedAmountCents: 1_000_000,
  installments: 48,
  consent: true,
  consentVersion: CONSENT_VERSION,
};

/** A view valid against the shared schema: one approved bank, one counter-offer, one pending. */
export function simulationView(overrides: Partial<SimulationView> = {}): SimulationView {
  return {
    id: SIMULATION_ID,
    createdAt: '2026-10-23T12:00:00.000Z',
    serverTime: '2026-10-23T12:00:03.000Z',
    status: 'PROCESSING',
    retryable: false,
    request: { requestedAmountCents: 1_000_000, installments: 48, cpfMasked: '***.982.247-**' },
    margin: { fitsMargin: true },
    bestOffer: { bankId: 'beta' },
    results: [
      {
        bankId: 'alfa',
        bankName: 'Banco Alfa',
        status: 'APPROVED',
        offer: {
          amountCents: 1_000_000,
          installments: 48,
          monthlyRate: 0.0179,
          installmentCents: 31_224,
        },
        isCounterOffer: false,
        totalPayableCents: 1_498_752,
        latencyMs: 120,
        attempts: 1,
      },
      {
        bankId: 'beta',
        bankName: 'Banco Beta',
        status: 'APPROVED',
        offer: {
          amountCents: 818_255,
          installments: 48,
          monthlyRate: 0.0159,
          installmentCents: 24_500,
        },
        isCounterOffer: true,
        totalPayableCents: 1_176_000,
      },
      { bankId: 'gama', bankName: 'Banco Gama', status: 'PENDING' },
    ],
    ...overrides,
  };
}

/** The same simulation once no bank is PENDING: Gama did not answer in time. */
export function completedSimulationView(overrides: Partial<SimulationView> = {}): SimulationView {
  const { results } = simulationView();
  return simulationView({
    status: 'COMPLETED_WITH_OFFERS',
    retryable: true,
    serverTime: '2026-10-23T12:00:09.000Z',
    results: results.map((result) =>
      result.status === 'PENDING'
        ? { bankId: result.bankId, bankName: result.bankName, status: 'UNAVAILABLE', attempts: 3 }
        : result,
    ),
    ...overrides,
  });
}

/** One bank of completedSimulationView(): Alfa approved, Beta a counter-offer, Gama unavailable. */
export function completedResult(bankId: 'alfa' | 'beta' | 'gama'): BankResultView {
  const result = completedSimulationView().results.find((each) => each.bankId === bankId);
  if (!result) throw new Error(`no ${bankId} in completedSimulationView`);
  return result;
}

export const BANK_CATALOG: BankCatalogView = {
  consentVersion: CONSENT_VERSION,
  banks: [
    { id: 'alfa', name: 'Banco Alfa', sharedFields: ['cpf', 'birthDate', 'netSalaryCents'] },
    { id: 'gama', name: 'Banco Gama', sharedFields: ['cpf', 'employerCnpj'] },
  ],
};
