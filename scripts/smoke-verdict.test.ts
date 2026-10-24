import type {
  BankResultStatus,
  BankResultView,
  SimulationStatus,
  SimulationView,
} from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { judgeFinalSimulation, type SmokeProblem } from './smoke-verdict';

const CATALOG = ['alfa', 'beta', 'gama'];
const WITH_OFFERS = 'COMPLETED_WITH_OFFERS';
const WITHOUT_OFFERS = 'COMPLETED_WITHOUT_OFFERS';

function result(bankId: string, status: BankResultStatus): BankResultView {
  const base = { bankId, bankName: `Banco ${bankId}` };
  if (status !== 'APPROVED') return { ...base, status };
  return {
    ...base,
    status,
    offer: {
      amountCents: 1_000_000,
      installments: 48,
      monthlyRate: 0.0179,
      installmentCents: 31_224,
    },
    isCounterOffer: false,
    totalPayableCents: 1_498_752,
  };
}

/** A schema-valid view. Only `status` and each result's bankId and status matter here. */
function view(status: SimulationStatus, results: [string, BankResultStatus][]): SimulationView {
  return {
    id: '2f1c6b8e-4f5a-4b7e-9c3d-1a2b3c4d5e6f',
    createdAt: '2026-10-24T12:00:00.000Z',
    serverTime: '2026-10-24T12:00:05.000Z',
    status,
    retryable: false,
    request: { requestedAmountCents: 1_000_000, installments: 48, cpfMasked: '***.982.247-**' },
    margin: { fitsMargin: true },
    bestOffer: null,
    results: results.map(([bankId, bankStatus]) => result(bankId, bankStatus)),
  };
}

describe('judgeFinalSimulation', () => {
  it.each<[string, SimulationView]>([
    [
      'every bank approved',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'APPROVED'],
        ['gama', 'APPROVED'],
      ]),
    ],
    [
      'a bank denied the request',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'DENIED'],
        ['gama', 'APPROVED'],
      ]),
    ],
    [
      'other banks ended UNAVAILABLE or ERROR, as the mocks draw failures',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'UNAVAILABLE'],
        ['gama', 'ERROR'],
      ]),
    ],
    [
      'the only answer is a denial: a denial is an answer',
      view(WITHOUT_OFFERS, [
        ['alfa', 'DENIED'],
        ['beta', 'UNAVAILABLE'],
        ['gama', 'ERROR'],
      ]),
    ],
    [
      'the results come in another order than the catalog',
      view(WITH_OFFERS, [
        ['gama', 'APPROVED'],
        ['alfa', 'DENIED'],
        ['beta', 'APPROVED'],
      ]),
    ],
  ])('passes when %s', (_, finalView) => {
    expect(judgeFinalSimulation(finalView, CATALOG)).toEqual({ ok: true });
  });

  it.each<[string, SimulationView, SmokeProblem]>([
    [
      'every bank ended UNAVAILABLE',
      view(WITHOUT_OFFERS, [
        ['alfa', 'UNAVAILABLE'],
        ['beta', 'UNAVAILABLE'],
        ['gama', 'UNAVAILABLE'],
      ]),
      { kind: 'no-bank-answered' },
    ],
    [
      'every bank ended UNAVAILABLE or ERROR',
      view(WITHOUT_OFFERS, [
        ['alfa', 'ERROR'],
        ['beta', 'UNAVAILABLE'],
        ['gama', 'ERROR'],
      ]),
      { kind: 'no-bank-answered' },
    ],
    [
      'the deadline ran out while PROCESSING',
      view('PROCESSING', [
        ['alfa', 'APPROVED'],
        ['beta', 'PENDING'],
        ['gama', 'PENDING'],
      ]),
      { kind: 'still-processing', pendingBankIds: ['beta', 'gama'] },
    ],
    [
      'a bank is PENDING although the simulation finished',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'APPROVED'],
        ['gama', 'PENDING'],
      ]),
      { kind: 'pending-after-completion', pendingBankIds: ['gama'] },
    ],
    [
      'a catalog bank is missing',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'APPROVED'],
      ]),
      { kind: 'banks-differ-from-catalog', expected: CATALOG, received: ['alfa', 'beta'] },
    ],
    [
      'a bank outside the catalog shows up',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'APPROVED'],
        ['gama', 'APPROVED'],
        ['delta', 'APPROVED'],
      ]),
      {
        kind: 'banks-differ-from-catalog',
        expected: CATALOG,
        received: ['alfa', 'beta', 'gama', 'delta'],
      },
    ],
    [
      'a bank appears twice (same set of banks, one result too many)',
      view(WITH_OFFERS, [
        ['alfa', 'APPROVED'],
        ['beta', 'APPROVED'],
        ['gama', 'APPROVED'],
        ['gama', 'APPROVED'],
      ]),
      {
        kind: 'banks-differ-from-catalog',
        expected: CATALOG,
        received: ['alfa', 'beta', 'gama', 'gama'],
      },
    ],
    [
      'the bank list is wrong, even while PROCESSING (checked first)',
      view('PROCESSING', [
        ['alfa', 'PENDING'],
        ['beta', 'PENDING'],
      ]),
      { kind: 'banks-differ-from-catalog', expected: CATALOG, received: ['alfa', 'beta'] },
    ],
    [
      'still PROCESSING with no answer so far (PROCESSING is checked before the answers)',
      view('PROCESSING', [
        ['alfa', 'UNAVAILABLE'],
        ['beta', 'ERROR'],
        ['gama', 'PENDING'],
      ]),
      { kind: 'still-processing', pendingBankIds: ['gama'] },
    ],
  ])('fails when %s', (_, finalView, problem) => {
    expect(judgeFinalSimulation(finalView, CATALOG)).toEqual({ ok: false, problem });
  });
});
