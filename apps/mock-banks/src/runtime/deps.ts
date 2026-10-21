import type { Sleep } from './sleep';

// Everything nondeterministic is injected so tests control randomness, time and waiting.
export interface BankDeps {
  random: () => number;
  sleep: Sleep;
  now: () => Date;
  logLevel?: string;
}
