import type { SimulationView } from '@simulador/shared';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_MESSAGES } from '../api/messages';
import { answerGetsInOrder, createFakeApi, type GetSimulationResult } from '../testing/fake-api';
import { completedSimulationView, SIMULATION_ID, simulationView } from '../testing/fixtures';
import { renderApp } from '../testing/render';
import { nextPollDelay } from './next-poll-delay';
import { RETRYING_MESSAGE } from './ResultPage';

// The delay rule has its own table tests; here every wait is 1 s unless a test says otherwise.
vi.mock('./next-poll-delay', () => ({ nextPollDelay: vi.fn() }));

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

const status = () => screen.getByRole('status');
const notice = () => screen.getByRole('alert');

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

      expect(status()).toHaveTextContent('Consultando os bancos: 2 de 3 consultas concluídas.');
      expect(screen.getByText('Tempo decorrido: 3 s')).toBeVisible();

      await advance(2_000);
      expect(screen.getByText('Tempo decorrido: 5 s')).toBeVisible();
    },
  );

  it('stops the timer and the polling once no bank is pending', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView()), ok(completedSimulationView())]);
    renderApp({ api, route: ROUTE });
    await advance(0);

    await advance(1_000);

    expect(status()).toHaveTextContent('Consulta aos bancos concluída.');
    expect(screen.queryByText(/Tempo decorrido/)).not.toBeInTheDocument();
    // Neither the clock's interval nor a next GET is left.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says the simulation was not found or expired on a 404, and stops', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [{ kind: 'not-found', message: API_MESSAGES.NOT_FOUND }]);
    renderApp({ api, route: ROUTE });

    await advance(0);

    expect(status()).toHaveTextContent('Simulação não encontrada ou expirada.');
    expect(screen.getByRole('link', { name: 'Simular novamente' })).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
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
      expect(status()).toHaveTextContent('Consultando os bancos: 2 de 3 consultas concluídas.');
      expect(notice()).toHaveTextContent(RETRYING_MESSAGE);
      // Not the client's message: "Verifique sua conexão" would blame the customer's network.
      expect(screen.queryByText(answer.message)).not.toBeInTheDocument();

      await advance(1_000);
      expect(status()).toHaveTextContent('Consulta aos bancos concluída.');
      expect(notice()).toBeEmptyDOMElement();
    },
  );

  it('shows the notice while the first GET fails, before any result', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [NETWORK, ok(simulationView())]);
    renderApp({ api, route: ROUTE });

    await advance(0);

    expect(status()).toHaveTextContent('Carregando a simulação…');
    expect(notice()).toHaveTextContent(RETRYING_MESSAGE);
  });
});
