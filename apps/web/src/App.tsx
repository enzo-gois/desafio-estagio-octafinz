import { BrowserRouter, Link, Route, Routes } from 'react-router';
import type { ApiClient } from './api/client';
import { ApiProvider } from './api/context';
import { DraftProvider } from './draft/draft-context';
import { SimulationPage } from './form/SimulationPage';
import { ResultPage } from './result/ResultPage';

function NotFoundPage() {
  return (
    <main style={{ maxWidth: '44rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1>Página não encontrada</h1>
      <p>
        <Link to="/">Ir para a simulação</Link>
      </p>
    </main>
  );
}

/** The routes alone, so tests can render them in a MemoryRouter. */
export function AppRoutes() {
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
