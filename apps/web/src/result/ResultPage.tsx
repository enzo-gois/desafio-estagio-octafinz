import { Link, useParams } from 'react-router';

// Placeholder until 6.5 (polling) and 6.6 (cards): enough to land after the POST and to go back
// to the form, which comes back filled in from the in-memory draft.
export function ResultPage() {
  const { id } = useParams();

  return (
    <main style={{ maxWidth: '44rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1>Resultado da simulação</h1>
      <p>Simulação {id} enviada aos bancos.</p>
      <p>
        <Link to="/">Simular novamente</Link>
      </p>
    </main>
  );
}
