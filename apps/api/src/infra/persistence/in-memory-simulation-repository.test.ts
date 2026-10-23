import { describe } from 'vitest';
import { InMemorySimulationRepository } from './in-memory-simulation-repository';
import { simulationRepositoryContract } from './simulation-repository.contract';

describe('InMemorySimulationRepository', () => {
  const repository = new InMemorySimulationRepository();
  simulationRepositoryContract(() => repository);
});
