import { createContext, type ReactNode, useContext } from 'react';
import type { ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

/** The real client in main.tsx, a fake one in tests. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}
