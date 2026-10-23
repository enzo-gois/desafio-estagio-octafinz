import { CONSENT_VERSION } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { BANK_CATALOG } from './registry';

const ALL_BUT_NAME_AND_EMAIL = [
  'cpf',
  'birthDate',
  'employmentType',
  'employerCnpj',
  'netSalaryCents',
  'requestedAmountCents',
  'installments',
];

/**
 * Every consent version and the bank declaration its text shows. Stored simulations point at
 * these versions, so an entry never changes once released. When this test fails because a bank
 * was added or renamed, or its fields changed, do not edit an entry: add a new version here and
 * set CONSENT_VERSION (packages/shared) to it.
 */
const DECLARATIONS: Readonly<Record<string, unknown>> = {
  '2026-10-v1': [
    { id: 'alfa', displayName: 'Banco Alfa', sharedFields: ALL_BUT_NAME_AND_EMAIL },
    { id: 'beta', displayName: 'Banco Beta', sharedFields: ALL_BUT_NAME_AND_EMAIL },
    {
      id: 'gama',
      displayName: 'Banco Gama',
      sharedFields: ALL_BUT_NAME_AND_EMAIL.filter((field) => field !== 'employmentType'),
    },
  ],
};

describe('CONSENT_VERSION', () => {
  it('names the declaration the registry tells the customer today', () => {
    expect(
      BANK_CATALOG,
      'the bank declaration changed: add a new version to DECLARATIONS and bump CONSENT_VERSION',
    ).toEqual(DECLARATIONS[CONSENT_VERSION]);
  });
});
