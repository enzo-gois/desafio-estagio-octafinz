import { type BankCatalogView, CONSENT_VERSION } from '@simulador/shared';
import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '../api/client';
import { useApi } from '../api/context';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: BankCatalogView }
  | { status: 'failed'; message: string }
  /**
   * The API's consent version differs from this bundle's. The fixed part of the consent text
   * (e.g. "nome e e-mail não vão para os bancos") comes from the bundle and the per-bank list
   * from the API: with different versions the screen would mix two texts, so only a reload helps.
   */
  | { status: 'outdated' };

function toCatalogState(result: Exclude<ApiResult<BankCatalogView>, { kind: 'aborted' }>) {
  switch (result.kind) {
    case 'ok':
      return result.data.consentVersion === CONSENT_VERSION
        ? ({ status: 'ready', catalog: result.data } as const)
        : ({ status: 'outdated' } as const);
    default:
      return { status: 'failed', message: result.message } as const;
  }
}

/** GET /banks for the consent text. Sending is blocked until it is `ready`. */
export function useBankCatalog(): { state: CatalogState; retry: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void api.getBanks(controller.signal).then((result) => {
      // Unmounted (or StrictMode's first mount): nothing to update, whatever the client returned.
      if (result.kind === 'aborted' || controller.signal.aborted) return;
      setState(toCatalogState(result));
    });
    return () => controller.abort();
  }, [api, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { state, retry };
}
