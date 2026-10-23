import { describe, expect, it } from 'vitest';
import { bankCatalogViewSchema, CONSENT_VERSION, SIMULATION_DATA_FIELDS } from './consent';
import { simulationInputSchema } from './simulation';

describe('SIMULATION_DATA_FIELDS', () => {
  it('lists every input field except the consent itself', () => {
    const inputFields = Object.keys(simulationInputSchema.shape).filter(
      (field) => field !== 'consent' && field !== 'consentVersion',
    );

    expect([...SIMULATION_DATA_FIELDS].sort()).toEqual(inputFields.sort());
  });
});

describe('bankCatalogViewSchema', () => {
  const catalog = {
    consentVersion: CONSENT_VERSION,
    banks: [{ id: 'gama', name: 'Banco Gama', sharedFields: ['cpf', 'birthDate'] }],
  };

  it('accepts a catalog', () => {
    expect(bankCatalogViewSchema.safeParse(catalog).success).toBe(true);
  });

  it.each([
    ['an unknown field', { ...catalog.banks[0], sharedFields: ['cpf', 'motherName'] }],
    ['an extra property', { ...catalog.banks[0], url: 'http://gama.internal' }],
  ])('rejects a bank with %s', (_, bank) => {
    expect(bankCatalogViewSchema.safeParse({ ...catalog, banks: [bank] }).success).toBe(false);
  });
});
