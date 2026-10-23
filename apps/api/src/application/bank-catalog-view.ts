import { type BankCatalogView, CONSENT_VERSION } from '@simulador/shared';
import type { BankDescriptor } from './ports/bank-catalog';

/**
 * What GET /banks returns: the consent version and, per bank, the name and the fields it receives,
 * for the form to tell the customer which data goes to which bank before anything is sent.
 */
export function toBankCatalogView(banks: readonly BankDescriptor[]): BankCatalogView {
  return {
    consentVersion: CONSENT_VERSION,
    banks: banks.map(({ id, displayName, sharedFields }) => ({
      id,
      name: displayName,
      sharedFields: [...sharedFields],
    })),
  };
}
