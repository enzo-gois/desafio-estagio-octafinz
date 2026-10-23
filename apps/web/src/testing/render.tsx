import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import type { ApiClient } from '../api/client';
import { ApiProvider } from '../api/context';
import { AppRoutes } from '../App';
import { DraftProvider } from '../draft/draft-context';
import { createFakeApi } from './fake-api';

/**
 * The whole app on a route, with a fake API by default. In StrictMode, like main.tsx: effects
 * mount twice, so a missing cleanup shows up in the tests.
 */
export function renderApp({ api, route = '/' }: { api?: ApiClient; route?: string } = {}) {
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <ApiProvider client={api ?? createFakeApi()}>
        <DraftProvider>
          <MemoryRouter initialEntries={[route]}>
            <AppRoutes />
          </MemoryRouter>
        </DraftProvider>
      </ApiProvider>
    </StrictMode>,
  );
  return { ...view, user };
}
