import { vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { BANK_CATALOG, completedSimulationView, SIMULATION_ID } from './fixtures';

/** An ApiClient whose calls are vi.fn mocks, answering success by default. */
export function createFakeApi() {
  return {
    createSimulation: vi.fn<ApiClient['createSimulation']>(async () => ({
      kind: 'ok',
      data: { id: SIMULATION_ID },
    })),
    // Finished by default: a test that only passes through the result page leaves no polling
    // behind. Polling tests answer PROCESSING themselves.
    getSimulation: vi.fn<ApiClient['getSimulation']>(async () => ({
      kind: 'ok',
      data: completedSimulationView(),
    })),
    getBanks: vi.fn<ApiClient['getBanks']>(async () => ({ kind: 'ok', data: BANK_CATALOG })),
  } satisfies ApiClient;
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export type GetSimulationResult = Awaited<ReturnType<ApiClient['getSimulation']>>;

/**
 * Answers the GETs of the simulation with `answers` in order (the last one repeats), each after
 * `latencyMs`. The answer is picked when the request settles: by then StrictMode's discarded
 * first mount has aborted its request, which gets 'aborted' like from the real client instead
 * of using up an answer.
 */
export function answerGetsInOrder(api: FakeApi, answers: GetSimulationResult[], latencyMs = 0) {
  let next = 0;
  api.getSimulation.mockImplementation(async (_id, signal) => {
    // Without latency, a microtask rather than setTimeout(0): fake timers do not run a timer
    // created at the very end of an advance, which would hold the last answer back.
    await (latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, latencyMs)) : undefined);
    if (signal?.aborted) return { kind: 'aborted' };
    const answer = answers[Math.min(next, answers.length - 1)];
    if (!answer) throw new Error('answerGetsInOrder: no answers given');
    next += 1;
    return answer;
  });
}
