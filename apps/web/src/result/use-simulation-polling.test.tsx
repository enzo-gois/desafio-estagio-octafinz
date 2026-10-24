import type { SimulationView } from '@simulador/shared';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/context';
import { API_MESSAGES } from '../api/messages';
import {
  answerGetsInOrder,
  createFakeApi,
  type FakeApi,
  type GetSimulationResult,
} from '../testing/fake-api';
import { completedSimulationView, SIMULATION_ID, simulationView } from '../testing/fixtures';
import { nextPollDelay } from './next-poll-delay';
import { useSimulationPolling } from './use-simulation-polling';

// The delay rule has its own table tests. Here: what the hook reports to it and that it waits
// for what it returns.
vi.mock('./next-poll-delay', () => ({ nextPollDelay: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(nextPollDelay).mockReturnValue(1_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const ok = (data: SimulationView): GetSimulationResult => ({ kind: 'ok', data });
const NETWORK: GetSimulationResult = { kind: 'network', message: API_MESSAGES.NETWORK };

function renderPolling(api: FakeApi) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={api}>{children}</ApiProvider>
  );
  // StrictMode like main.tsx: effects mount, unmount and mount again. The option, not a
  // <StrictMode> in the wrapper: there it does not run the effects twice.
  return renderHook(() => useSimulationPolling(SIMULATION_ID), { wrapper, reactStrictMode: true });
}

/** Moves the fake clock, letting the answers due meanwhile reach the state. */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** GETs of the mount that is alive: StrictMode's discarded first mount aborted its own. */
const liveCalls = (api: FakeApi) =>
  api.getSimulation.mock.calls.filter(([, signal]) => signal?.aborted === false);

const reportedOutcomes = () => vi.mocked(nextPollDelay).mock.calls.map(([outcome]) => outcome);

describe('useSimulationPolling', () => {
  it('polls while the simulation is processing and stops once it completes', async () => {
    const api = createFakeApi();
    const completed = completedSimulationView();
    answerGetsInOrder(api, [ok(simulationView()), ok(simulationView()), ok(completed)]);
    const { result } = renderPolling(api);
    expect(result.current).toEqual({ status: 'loading', retrying: false });

    await advance(0);
    expect(result.current).toMatchObject({ status: 'loaded', view: { status: 'PROCESSING' } });

    await advance(2_000);
    expect(result.current).toMatchObject({ status: 'loaded', view: completed, retrying: false });
    expect(liveCalls(api)).toHaveLength(3);
    expect(reportedOutcomes()).toEqual([{ kind: 'ok' }, { kind: 'ok' }]);

    await advance(60_000);
    expect(liveCalls(api)).toHaveLength(3);
  });

  it('waits for each answer before scheduling the next GET, so two never overlap', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())], 3_000); // every GET takes 3 s
    renderPolling(api);

    await advance(10_000);

    // GETs at 0, 4 s (3 s answer + 1 s wait) and 8 s; setInterval would have sent 10 by now,
    // three of them in flight at once.
    expect(liveCalls(api)).toHaveLength(3);
  });

  it('waits the delay nextPollDelay returns before the next GET', async () => {
    vi.mocked(nextPollDelay).mockReturnValue(5_000);
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())]);
    renderPolling(api);
    await advance(0);

    await advance(4_999);
    expect(liveCalls(api)).toHaveLength(1);

    await advance(1);
    expect(liveCalls(api)).toHaveLength(2);
  });

  it('keeps the last view while GETs fail, flagged as retrying, until one succeeds', async () => {
    const api = createFakeApi();
    const first = simulationView();
    const completed = completedSimulationView();
    answerGetsInOrder(api, [ok(first), NETWORK, ok(completed)]);
    const { result } = renderPolling(api);
    await advance(0);

    await advance(1_000);
    expect(result.current).toMatchObject({ status: 'loaded', view: first, retrying: true });

    await advance(1_000);
    expect(result.current).toMatchObject({ status: 'loaded', view: completed, retrying: false });
  });

  it('flags retrying while still loading when the first GET fails', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [NETWORK, ok(simulationView())]);
    const { result } = renderPolling(api);

    await advance(0);
    expect(result.current).toEqual({ status: 'loading', retrying: true });

    await advance(1_000);
    expect(result.current).toMatchObject({ status: 'loaded', retrying: false });
  });

  it('counts failures of every kind in a row, passing on any Retry-After, and restarts after a success', async () => {
    const api = createFakeApi();
    const view = simulationView();
    answerGetsInOrder(api, [
      ok(view),
      NETWORK,
      { kind: 'unavailable', message: API_MESSAGES.UNAVAILABLE, retryAfterMs: 5_000 },
      { kind: 'unexpected', message: API_MESSAGES.UNEXPECTED, detail: 'HTTP 500' },
      { kind: 'rate-limited', message: API_MESSAGES.RATE_LIMITED, retryAfterMs: 3_000 },
      { kind: 'unavailable', message: API_MESSAGES.UNAVAILABLE, retryAfterMs: undefined },
      ok(view),
      NETWORK,
    ]);
    renderPolling(api);
    await advance(0);

    await advance(7_000);

    // toStrictEqual: retryAfterMs: undefined must be there, not just missing.
    expect(reportedOutcomes()).toStrictEqual([
      { kind: 'ok' },
      { kind: 'failed', consecutiveFailures: 1, retryAfterMs: undefined },
      { kind: 'failed', consecutiveFailures: 2, retryAfterMs: 5_000 },
      { kind: 'failed', consecutiveFailures: 3, retryAfterMs: undefined },
      { kind: 'failed', consecutiveFailures: 4, retryAfterMs: 3_000 },
      { kind: 'failed', consecutiveFailures: 5, retryAfterMs: undefined },
      { kind: 'ok' },
      { kind: 'failed', consecutiveFailures: 1, retryAfterMs: undefined },
    ]);
  });

  it('stops on a 404 with the message of the client', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [{ kind: 'not-found', message: API_MESSAGES.NOT_FOUND }]);
    const { result } = renderPolling(api);

    await advance(0);
    expect(result.current).toEqual({ status: 'not-found', message: API_MESSAGES.NOT_FOUND });

    await advance(60_000);
    expect(liveCalls(api)).toHaveLength(1);
    expect(nextPollDelay).not.toHaveBeenCalled();
  });

  it('measures how far the client clock is from serverTime', async () => {
    vi.setSystemTime(new Date('2026-10-23T11:55:00.000Z')); // 5 min behind the server
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView({ serverTime: '2026-10-23T12:00:03.000Z' }))]);
    const { result } = renderPolling(api);

    await advance(0);

    expect(result.current).toMatchObject({ clockOffsetMs: 303_000 });
  });

  it("aborts the discarded first mount's GET and polls with a single chain", async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())]);
    renderPolling(api);

    const [discarded, live] = api.getSimulation.mock.calls;
    expect(discarded?.[1]?.aborted).toBe(true);
    expect(live?.[1]?.aborted).toBe(false);

    await advance(3_000);
    // GETs at 0, 1, 2 and 3 s, plus the discarded one. A second chain would double that.
    expect(api.getSimulation).toHaveBeenCalledTimes(1 + 4);
  });

  it('on unmount, aborts the GET in flight and schedules nothing after its answer', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())], 3_000);
    const { unmount } = renderPolling(api);
    await advance(1_000);
    const signal = api.getSimulation.mock.lastCall?.[1];

    unmount();

    expect(signal?.aborted).toBe(true);
    await advance(60_000);
    expect(api.getSimulation).toHaveBeenCalledTimes(2); // the discarded mount's and the live one
    expect(nextPollDelay).not.toHaveBeenCalled();
  });

  it('on unmount, cancels the GET already scheduled', async () => {
    const api = createFakeApi();
    answerGetsInOrder(api, [ok(simulationView())]);
    const { unmount } = renderPolling(api);
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(api.getSimulation).toHaveBeenCalledTimes(2);
  });
});
