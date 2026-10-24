import type { BankResultView, SimulationView } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { completedResult, completedSimulationView, simulationView } from '../testing/fixtures';
import { summaryText } from './summary-text';

const ALFA_APPROVED = completedResult('alfa');
const BETA_COUNTER_OFFER = completedResult('beta');
const pending = (bankId: string, bankName: string): BankResultView => ({
  bankId,
  bankName,
  status: 'PENDING',
});
const denied = (bankId: string, bankName: string): BankResultView => ({
  bankId,
  bankName,
  status: 'DENIED',
});

const RETRY_HINT =
  'Nem todos os bancos responderam: simular novamente pode trazer a resposta dos que faltaram.';

describe('summaryText', () => {
  it.each<{ case: string; view: SimulationView; expected: string }>([
    {
      case: 'processing, no bank answered yet',
      view: simulationView({
        results: [
          pending('alfa', 'Banco Alfa'),
          pending('beta', 'Banco Beta'),
          pending('gama', 'Banco Gama'),
        ],
        bestOffer: null,
      }),
      expected: 'Consultando os bancos: 0 de 3 responderam.',
    },
    {
      case: 'processing, one bank answered (singular)',
      view: simulationView({
        results: [ALFA_APPROVED, pending('beta', 'Banco Beta'), pending('gama', 'Banco Gama')],
        bestOffer: { bankId: 'alfa' },
      }),
      expected: 'Consultando os bancos: 1 de 3 respondeu.',
    },
    {
      case: 'processing, two banks answered',
      view: simulationView(),
      expected: 'Consultando os bancos: 2 de 3 responderam.',
    },
    {
      case: 'with offers, the best one a counter-offer',
      view: simulationView({
        status: 'COMPLETED_WITH_OFFERS',
        results: [ALFA_APPROVED, BETA_COUNTER_OFFER, denied('gama', 'Banco Gama')],
        bestOffer: { bankId: 'beta' },
      }),
      expected: '2 ofertas recebidas. A menor taxa é do Banco Beta.',
    },
    {
      case: 'with a single offer: whose it is, no "lowest rate" with nothing to compare',
      view: simulationView({
        status: 'COMPLETED_WITH_OFFERS',
        results: [ALFA_APPROVED, denied('beta', 'Banco Beta'), denied('gama', 'Banco Gama')],
        bestOffer: { bankId: 'alfa' },
      }),
      expected: '1 oferta recebida, do Banco Alfa.',
    },
    {
      case: 'with offers and a bank that did not answer (retryable)',
      view: completedSimulationView(),
      expected: `2 ofertas recebidas. A menor taxa é do Banco Beta. ${RETRY_HINT}`,
    },
    {
      case: 'with a single offer, a counter-offer, and a bank that did not answer (retryable)',
      view: completedSimulationView({
        results: [
          denied('alfa', 'Banco Alfa'),
          BETA_COUNTER_OFFER,
          { bankId: 'gama', bankName: 'Banco Gama', status: 'UNAVAILABLE' },
        ],
      }),
      expected: `1 oferta recebida, do Banco Beta. ${RETRY_HINT}`,
    },
    {
      case: 'without offers',
      view: simulationView({
        status: 'COMPLETED_WITHOUT_OFFERS',
        results: [
          denied('alfa', 'Banco Alfa'),
          denied('beta', 'Banco Beta'),
          denied('gama', 'Banco Gama'),
        ],
        bestOffer: null,
      }),
      expected: 'Nenhum banco aprovou o pedido.',
    },
    {
      case: 'without offers and with banks that did not answer (retryable)',
      view: simulationView({
        status: 'COMPLETED_WITHOUT_OFFERS',
        retryable: true,
        results: [
          denied('alfa', 'Banco Alfa'),
          { bankId: 'beta', bankName: 'Banco Beta', status: 'ERROR' },
          { bankId: 'gama', bankName: 'Banco Gama', status: 'UNAVAILABLE' },
        ],
        bestOffer: null,
      }),
      expected: `Nenhum banco aprovou o pedido. ${RETRY_HINT}`,
    },
    {
      // "No" is not "don't know": without a single denial, nobody said no.
      case: 'without offers and without any answer (every bank UNAVAILABLE or ERROR)',
      view: simulationView({
        status: 'COMPLETED_WITHOUT_OFFERS',
        retryable: true,
        results: [
          { bankId: 'alfa', bankName: 'Banco Alfa', status: 'UNAVAILABLE' },
          { bankId: 'beta', bankName: 'Banco Beta', status: 'ERROR' },
          { bankId: 'gama', bankName: 'Banco Gama', status: 'UNAVAILABLE' },
        ],
        bestOffer: null,
      }),
      // A sentence of its own: the usual complement ("nem todos") would repeat "nenhum".
      expected: 'Nenhum banco respondeu. Simular novamente pode trazer as respostas.',
    },
  ])('$case', ({ view, expected }) => {
    expect(summaryText(view)).toBe(expected);
  });
});
