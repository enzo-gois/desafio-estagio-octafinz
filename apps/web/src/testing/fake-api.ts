import { vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { BANK_CATALOG, SIMULATION_ID, simulationView } from './fixtures';

/** An ApiClient whose calls are vi.fn mocks, answering success by default. */
export function createFakeApi() {
  return {
    createSimulation: vi.fn<ApiClient['createSimulation']>(async () => ({
      kind: 'ok',
      data: { id: SIMULATION_ID },
    })),
    getSimulation: vi.fn<ApiClient['getSimulation']>(async () => ({
      kind: 'ok',
      data: simulationView(),
    })),
    getBanks: vi.fn<ApiClient['getBanks']>(async () => ({ kind: 'ok', data: BANK_CATALOG })),
  } satisfies ApiClient;
}

export type FakeApi = ReturnType<typeof createFakeApi>;
