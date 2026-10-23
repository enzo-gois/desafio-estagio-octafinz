import {
  SIMULATION_DATA_FIELDS,
  type SimulationDataField,
  type SimulationInput,
} from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT,
  CUSTOMER,
  endpointFor,
  fixedSender,
  jsonResponse,
} from '../../testing/bank-fixtures';
import { createCaptureLogger } from '../../testing/capture-logger';
import { BANK_IDS, type BankId } from './bank-config';
import { BANK_REGISTRY } from './registry';

// A value different from CUSTOMER's for every data field. The mapped type breaks the build when
// the input gains a field without a variant here, so no field escapes the check below.
const VARIANTS: { [F in SimulationDataField]-?: NonNullable<SimulationInput[F]> } = {
  name: 'Outra Pessoa',
  email: 'outra.pessoa@example.com',
  cpf: '11144477735',
  birthDate: '1990-01-01',
  employmentType: 'CLT',
  employerCnpj: '11222333000181',
  netSalaryCents: 734_220,
  requestedAmountCents: 1_000_001,
  installments: 24,
};

async function requestBody(bankId: BankId, input: SimulationInput): Promise<string> {
  const { sender, requests } = fixedSender(jsonResponse({}, 503));
  const provider = BANK_REGISTRY[bankId].create({
    endpoint: endpointFor(bankId),
    client: sender,
    logger: createCaptureLogger().logger,
  });
  await provider.simulate(input, new AbortController().signal, CONTEXT);
  return requests[0]?.body ?? '';
}

// The consent text promises the customer which data each bank receives. The proof is behavioral:
// change one field and see whether the bytes sent to the bank change.
describe.each(BANK_IDS)('%s declared fields', (bankId) => {
  const declared: readonly SimulationDataField[] = BANK_REGISTRY[bankId].sharedFields;

  it.each(SIMULATION_DATA_FIELDS)('%s is sent if and only if declared', async (field) => {
    expect(VARIANTS[field]).not.toEqual(CUSTOMER[field]);

    const base = await requestBody(bankId, CUSTOMER);
    const changed = await requestBody(bankId, { ...CUSTOMER, [field]: VARIANTS[field] });

    expect(changed !== base).toBe(declared.includes(field));
  });
});
