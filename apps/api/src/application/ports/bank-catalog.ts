import type { SimulationDataField } from '@simulador/shared';

/** What the customer is told about a bank: its name and exactly which input fields it receives. */
export interface BankDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly sharedFields: readonly SimulationDataField[];
}
