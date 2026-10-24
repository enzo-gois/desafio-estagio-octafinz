import type { SimulationView } from '@simulador/shared';
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_MESSAGES } from '../api/messages';
import { answerGetsInOrder, createFakeApi, type GetSimulationResult } from '../testing/fake-api';
import { completedSimulationView, SIMULATION_ID, simulationView } from '../testing/fixtures';
import { renderApp } from '../testing/render';
import { MARGIN_NOTICE_TEXT } from './MarginNotice';
import { nextPollDelay } from './next-poll-delay';
import { RETRYING_MESSAGE } from './ResultPage';

// The delay rule and the summary sentences have their own table tests; here every wait is 1 s
// unless a test says otherwise, and the summary says which case it is.
vi.mock('./next-poll-delay', () => ({ nextPollDelay: vi.fn() }));
vi.mock('./summary-text', () => ({
  summaryText: (view: SimulationView) => `Resumo de ${view.status}.`,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(nextPollDelay).mockReturnValue(1_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const ROUTE = `/simulacoes/${SIMULATION_ID}`;
const ok = (data: SimulationView): GetSimulationResult => ({ kind: 'ok', data });
const NETWORK: GetSimulationResult = { kind: 'network', message: API_MESSAGES.NETWORK };

/** The live region: visually hidden, read by screen readers. */
const liveRegion = () => screen.getByRole('status');
const notice = () => screen.getByRole('alert');
const summary = () => screen.getByRole('region', { name: 'Resumo' });
const card = (bankName: string) => screen.getByRole('article', { name: bankName });

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('ResultPage', () => {
  // The fixture: created at 12:00:00, serverTime 12:00:03 (server clock).
  it.each([
    { clock: 'right', clientNow: '2026-10-23T12:00:03.000Z' },
    { clock: '5 min behind', clientNow: '2026-10-23T11:55:03.000Z' },
    { clock: '7 min ahead', clientNow: '2026-10-23T12:07:03.000Z' },
  ])(
    "counts the elapsed time on the server's clock when the client's is $clock",
    async ({ clientNow }) => {
      vi.setSystemTime(new Date(clientNow));
      // No new GET in the test: between answers the time moves on the client's clock alone.
      vi.mocked(nextPollDelay).mockReturnValue(60_000);
      const api = createFakeApi();
      answerGetsInOrder(api, [ok(simulationView())]);
      renderApp({ api, route: ROUTE });
      await advance(0);

      expect(screen.getByText('Tempo decorrido: 3 s')).toBeVisible();

      await advance(2_000);
      expect(screen.getByText('Tempo decorrido: 5 s')).toBeVisible();
    },
  );

  it('shows a card per bank, in the order of the API, with the name the API gives', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())]);
    renderApp({ api, route: ROUTE });
    await advance(0);

    const names = screen.getAllByRole('heading', { level: 3 }).map((each) => each.textContent);
    expect(names).toEqual(['Banco Alfa', 'Banco Beta', 'Banco Gama']);
    expect(within(card('Banco Gama')).getByText('Aguardando resposta')).toBeVisible();
  });

  it('puts no "Menor taxa" badge on a single offer: there is nothing to compare', async () => {
    const api = createFakeApi();
    const { results } = completedSimulationView();
    answerGetsInOrder(api, [
      ok(
        completedSimulationView({
          // Alfa denied, Beta's counter-offer the only offer, Gama unavailable.
          results: results.map((result) =>
            result.bankId === 'alfa'
              ? { bankId: 'alfa', bankName: 'Banco Alfa', status: 'DENIED' }
              : result,
          ),
          bestOffer: { bankId: 'beta' },
        }),
      ),
    ]);
    renderApp({ api, route: ROUTE });
    await advance(0);

    expect(within(card('Banco Beta')).getByText('Contraproposta')).toBeVisible();
    expect(screen.queryByText('Menor taxa')).not.toBeInTheDocument();
  });

  it('puts the "Menor taxa" badge only once the simulation ends', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView()), ok(completedSimulationView())]);
    renderApp({ api, route: ROUTE });
    await advance(0);

    // bestOffer is already Beta while processing, but Gama could still beat it.
    expect(screen.queryByText('Menor taxa')).not.toBeInTheDocument();

    await advance(1_000);
    expect(within(card('Banco Beta')).getByText('Menor taxa')).toBeVisible();
    expect(screen.getAllByText('Menor taxa')).toHaveLength(1);
  });

  it('stops the timer and the polling once no bank is pending', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView()), ok(completedSimulationView())]);
    renderApp({ api, route: ROUTE });
    await advance(0);

    await advance(1_000);

    expect(summary()).toHaveTextContent('Resumo de COMPLETED_WITH_OFFERS.');
    expect(screen.queryByText(/Tempo decorrido/)).not.toBeInTheDocument();
    // Neither the clock's interval nor a next GET is left.
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { fitsMargin: false, shown: true },
    { fitsMargin: true, shown: false },
  ])(
    'shows the margin notice only when it does not fit (fitsMargin: $fitsMargin)',
    async ({ fitsMargin, shown }) => {
      const api = createFakeApi();
      answerGetsInOrder(api, [ok(completedSimulationView({ margin: { fitsMargin } }))]);
      renderApp({ api, route: ROUTE });
      await advance(0);

      const margin = screen.queryByRole('region', { name: 'Estimativa de margem' });
      if (shown) {
        // An estimate, and the banks decide.
        expect(margin).toHaveTextContent(MARGIN_NOTICE_TEXT);
        expect(MARGIN_NOTICE_TEXT).toMatch(/estimativa/);
        expect(MARGIN_NOTICE_TEXT).toMatch(/cada banco faz a própria avaliação/);
      } else {
        expect(margin).not.toBeInTheDocument();
      }
    },
  );

  it('says the simulation was not found or expired on a 404, and stops', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [{ kind: 'not-found', message: API_MESSAGES.NOT_FOUND }]);
    renderApp({ api, route: ROUTE });

    await advance(0);

    // On screen; the live region (also tested below) says it to screen readers.
    expect(
      screen.getByText('Simulação não encontrada ou expirada.', { ignore: '[role="status"]' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Fazer uma nova simulação' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('live region', () => {
    it('is in the page, empty, before the first answer', async () => {
      const api = createFakeApi();
      answerGetsInOrder(api, [ok(simulationView())], 3_000);
      renderApp({ api, route: ROUTE });
      await advance(1_000);

      expect(liveRegion()).toBeEmptyDOMElement();
      expect(screen.getByText('Carregando a simulação…')).toBeVisible();
    });

    it('announces the summary, each bank as it answers, then the summary at the end', async () => {
      const api = createFakeApi();
      const allPending = simulationView({
        results: simulationView().results.map(({ bankId, bankName }) => ({
          bankId,
          bankName,
          status: 'PENDING' as const,
        })),
        bestOffer: null,
      });
      answerGetsInOrder(api, [
        ok(allPending),
        ok(simulationView()),
        ok(simulationView()), // no news: the last announcement stays
        ok(completedSimulationView()),
      ]);
      renderApp({ api, route: ROUTE });

      await advance(0);
      expect(liveRegion()).toHaveTextContent('Resumo de PROCESSING.');

      await advance(1_000);
      expect(liveRegion()).toHaveTextContent('Banco Alfa: aprovado. Banco Beta: contraproposta.');

      await advance(1_000);
      expect(liveRegion()).toHaveTextContent('Banco Alfa: aprovado. Banco Beta: contraproposta.');

      await advance(1_000);
      expect(liveRegion()).toHaveTextContent(
        'Banco Gama: indisponível. Resumo de COMPLETED_WITH_OFFERS.',
      );
    });

    it('keeps the elapsed time out of it', async () => {
      const api = createFakeApi();
      answerGetsInOrder(api, [ok(simulationView())]);
      renderApp({ api, route: ROUTE });
      await advance(0);

      const elapsed = screen.getByText(/Tempo decorrido/);
      expect(liveRegion()).not.toContainElement(elapsed);
      expect(liveRegion()).not.toHaveTextContent(/Tempo decorrido/);
    });

    it('announces the 404', async () => {
      const api = createFakeApi();
      answerGetsInOrder(api, [{ kind: 'not-found', message: API_MESSAGES.NOT_FOUND }]);
      renderApp({ api, route: ROUTE });

      await advance(0);

      expect(liveRegion()).toHaveTextContent(API_MESSAGES.NOT_FOUND);
    });
  });

  it.each<{
    failure: string;
    answer: Exclude<GetSimulationResult, { kind: 'ok' | 'not-found' | 'aborted' }>;
  }>([
    { failure: 'no connection', answer: NETWORK },
    {
      failure: 'a 503',
      answer: { kind: 'unavailable', message: API_MESSAGES.UNAVAILABLE, retryAfterMs: undefined },
    },
    {
      failure: 'an invalid answer',
      answer: { kind: 'unexpected', message: API_MESSAGES.UNEXPECTED, detail: 'HTTP 500' },
    },
    {
      failure: 'a 429',
      answer: { kind: 'rate-limited', message: API_MESSAGES.RATE_LIMITED, retryAfterMs: 5_000 },
    },
  ])(
    'after $failure, keeps the last result with a neutral notice until a GET succeeds',
    async ({ answer }) => {
      const api = createFakeApi();
      answerGetsInOrder(api, [ok(simulationView()), answer, ok(completedSimulationView())]);
      renderApp({ api, route: ROUTE });
      await advance(0);
      expect(notice()).toBeEmptyDOMElement();

      await advance(1_000);
      expect(summary()).toHaveTextContent('Resumo de PROCESSING.');
      expect(within(card('Banco Beta')).getByText('Contraproposta')).toBeVisible();
      expect(notice()).toHaveTextContent(RETRYING_MESSAGE);
      // Not the client's message: "Verifique sua conexão" would blame the customer's network.
      expect(screen.queryByText(answer.message)).not.toBeInTheDocument();

      await advance(1_000);
      expect(summary()).toHaveTextContent('Resumo de COMPLETED_WITH_OFFERS.');
      expect(notice()).toBeEmptyDOMElement();
    },
  );

  it('shows the notice while the first GET fails, before any result', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [NETWORK, ok(simulationView())]);
    renderApp({ api, route: ROUTE });

    await advance(0);

    expect(screen.getByText('Carregando a simulação…')).toBeVisible();
    expect(notice()).toHaveTextContent(RETRYING_MESSAGE);
  });
});
