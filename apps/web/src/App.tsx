import { useEffect, useRef } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import type { ApiClient } from './api/client';
import { ApiProvider } from './api/context';
import { DraftProvider } from './draft/draft-context';
import { SimulationPage } from './form/SimulationPage';
import { ResultPage } from './result/ResultPage';

function NotFoundPage() {
  return (
    <main style={{ maxWidth: '44rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1 tabIndex={-1}>Página não encontrada</h1>
      <p>
        <Link to="/">Ir para a simulação</Link>
      </p>
    </main>
  );
}

/**
 * After a route change, focus goes to the new page's h1 (each page has one, with tabIndex -1).
 * There was no page load, so otherwise a screen reader announces nothing and the focus stays on
 * a link or button that no longer exists. The first load keeps the browser's default.
 */
function useFocusHeadingOnNavigation() {
  const { key } = useLocation();
  const previousKey = useRef(key);

  useEffect(() => {
    // The same key on the first load and on StrictMode's second run: not a navigation.
    if (previousKey.current === key) return;
    previousKey.current = key;
    // Effects run after the commit: the new page is already in the DOM.
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [key]);
}

/** The routes alone, so tests can render them in a MemoryRouter. */
export function AppRoutes() {
  useFocusHeadingOnNavigation();

  return (
    <Routes>
      <Route path="/" element={<SimulationPage />} />
      <Route path="/simulacoes/:id" element={<ResultPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App({ api }: { api: ApiClient }) {
  return (
    <ApiProvider client={api}>
      <DraftProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </DraftProvider>
    </ApiProvider>
  );
}
