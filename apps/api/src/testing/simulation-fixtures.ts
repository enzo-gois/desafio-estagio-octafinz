import { randomUUID } from 'node:crypto';
import type { ApprovedBankResult, SimulationInput } from '@simulador/shared';
import { vi } from 'vitest';
import type { SimulationStarter } from '../application/create-simulation';
import type { BankDescriptor } from '../application/ports/bank-catalog';
import type { NewSimulation } from '../application/ports/simulation-repository';

export const BANK_IDS = ['alfa', 'beta', 'gama'] as const;
export const T0 = new Date('2026-10-22T12:00:00.000Z');

export const BANKS: readonly BankDescriptor[] = [
  { id: 'alfa', displayName: 'Banco Alfa', sharedFields: ['cpf', 'birthDate'] },
  { id: 'beta', displayName: 'Banco Beta', sharedFields: ['cpf', 'netSalaryCents'] },
  { id: 'gama', displayName: 'Banco Gama', sharedFields: ['cpf', 'employerCnpj'] },
];

export function newSimulation(overrides: Partial<NewSimulation> = {}): NewSimulation {
  return {
    id: randomUUID(),
    createdAt: T0,
    consentedAt: T0,
    consentVersion: '2026-10-v1',
    requestedAmountCents: 1_000_000,
    installments: 48,
    cpfMasked: '***.982.247-**',
    margin: {
      percent: 35,
      referenceMonthlyRate: 0.018,
      marginCents: 256_976,
      estimatedInstallmentCents: 31_289,
      fitsMargin: true,
      commitmentBps: 1_218,
    },
    bankIds: BANK_IDS,
    ...overrides,
  };
}

export const approved = (bankId: string, amountCents = 1_000_000): ApprovedBankResult => ({
  bankId,
  status: 'APPROVED',
  offer: { amountCents, installments: 48, monthlyRate: 0.0179, installmentCents: 31_224 },
  latencyMs: 120,
  attempts: 1,
});

/** Records start() calls instead of querying banks. */
export function fakeStarter(isAccepting = true) {
  const starter: SimulationStarter & { start: ReturnType<typeof vi.fn> } = {
    isAccepting,
    bankIds: BANK_IDS,
    start: vi.fn<(simulationId: string, input: SimulationInput) => void>(),
  };
  return starter;
}
