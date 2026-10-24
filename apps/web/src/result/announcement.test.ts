import type { BankResultView, SimulationView } from '@simulador/shared';
import { describe, expect, it, vi } from 'vitest';
import { API_MESSAGES } from '../api/messages';
import { completedSimulationView, simulationView } from '../testing/fixtures';
import { announcementFor } from './announcement';
import type { SimulationPollingState } from './use-simulation-polling';

// The sentences have their own table tests (summary-text.test.ts).
vi.mock('./summary-text', () => ({
  summaryText: (view: SimulationView) => `Resumo de ${view.status}.`,
}));

const loaded = (view: SimulationView, retrying = false): SimulationPollingState => ({
  status: 'loaded',
  view,
  clockOffsetMs: 0,
  retrying,
});
const LOADING: SimulationPollingState = { status: 'loading', retrying: false };
const NOT_FOUND: SimulationPollingState = { status: 'not-found', message: API_MESSAGES.NOT_FOUND };

const pending = (bankId: string, bankName: string): BankResultView => ({
  bankId,
  bankName,
  status: 'PENDING',
});
const ALL_PENDING = simulationView({
  results: [
    pending('alfa', 'Banco Alfa'),
    pending('beta', 'Banco Beta'),
    pending('gama', 'Banco Gama'),
  ],
  bestOffer: null,
});
// Alfa approved, Beta a counter-offer, Gama still pending.
const TWO_ANSWERED = simulationView();

describe('announcementFor', () => {
  it.each<{
    case: string;
    previous: SimulationPollingState;
    current: SimulationPollingState;
    expected: string | undefined;
  }>([
    {
      case: 'the first view, while processing: the summary only',
      previous: LOADING,
      current: loaded(TWO_ANSWERED),
      expected: 'Resumo de PROCESSING.',
    },
    {
      case: 'the first view of a finished simulation: the summary only, not bank by bank',
      previous: LOADING,
      current: loaded(completedSimulationView()),
      expected: 'Resumo de COMPLETED_WITH_OFFERS.',
    },
    {
      case: 'the first view after failed GETs',
      previous: { status: 'loading', retrying: true },
      current: loaded(ALL_PENDING),
      expected: 'Resumo de PROCESSING.',
    },
    {
      case: 'banks that answered since the last GET, in the API order',
      previous: loaded(ALL_PENDING),
      current: loaded(TWO_ANSWERED),
      expected: 'Banco Alfa: aprovado. Banco Beta: contraproposta.',
    },
    {
      case: 'the last bank, then the summary, when the simulation ends',
      previous: loaded(TWO_ANSWERED),
      current: loaded(completedSimulationView()),
      expected: 'Banco Gama: indisponível. Resumo de COMPLETED_WITH_OFFERS.',
    },
    {
      case: 'a denial and an error, in words',
      previous: loaded(ALL_PENDING),
      current: loaded(
        simulationView({
          results: [
            { bankId: 'alfa', bankName: 'Banco Alfa', status: 'DENIED' },
            { bankId: 'beta', bankName: 'Banco Beta', status: 'ERROR' },
            pending('gama', 'Banco Gama'),
          ],
          bestOffer: null,
        }),
      ),
      expected: 'Banco Alfa: não aprovado. Banco Beta: erro na resposta.',
    },
    {
      case: 'nothing when a GET brings no news',
      previous: loaded(TWO_ANSWERED),
      current: loaded(simulationView()),
      expected: undefined,
    },
    {
      case: 'nothing when a GET fails (the notice is in its own region)',
      previous: loaded(TWO_ANSWERED),
      current: loaded(TWO_ANSWERED, true),
      expected: undefined,
    },
    {
      case: 'nothing for the first GET that fails',
      previous: LOADING,
      current: { status: 'loading', retrying: true },
      expected: undefined,
    },
    {
      case: 'the message of a 404',
      previous: LOADING,
      current: NOT_FOUND,
      expected: API_MESSAGES.NOT_FOUND,
    },
  ])('$case', ({ previous, current, expected }) => {
    expect(announcementFor(previous, current)).toBe(expected);
  });
});
