import { MAX_INSTALLMENTS, MIN_INSTALLMENTS } from '@simulador/shared';

// Placeholder until the form (6.4); importing the shared limits proves the workspace link works
// in the dev server, the build and the tests.
export function App() {
  return (
    <main>
      <h1>Simulador de empréstimo consignado</h1>
      <p>
        Prazos de {MIN_INSTALLMENTS} a {MAX_INSTALLMENTS} parcelas.
      </p>
    </main>
  );
}
