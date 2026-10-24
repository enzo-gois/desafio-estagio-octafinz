import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { elapsedSeconds } from './elapsed';
import styles from './ResultPage.module.css';
import { type SimulationPollingState, useSimulationPolling } from './use-simulation-polling';

// Neutral on purpose: after a 429 or a 5xx the customer's connection is fine, and the notice
// must not blame it.
export const RETRYING_MESSAGE = 'Não foi possível atualizar o resultado agora. Tentando novamente…';

function statusText(state: SimulationPollingState): string {
  switch (state.status) {
    case 'loading':
      return 'Carregando a simulação…';
    case 'not-found':
      return state.message;
    case 'loaded': {
      const { status, results } = state.view;
      if (status !== 'PROCESSING') return 'Consulta aos bancos concluída.';
      const done = results.filter((result) => result.status !== 'PENDING').length;
      return `Consultando os bancos: ${done} de ${results.length} consultas concluídas.`;
    }
  }
}

/** The client's clock, read again every second while `running`: the timer moves between GETs. */
function useClientClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function SimulationResult({ id }: { id: string }) {
  const state = useSimulationPolling(id);
  const finished =
    state.status === 'not-found' ||
    (state.status === 'loaded' && state.view.status !== 'PROCESSING');
  // Also while loading, so the first view is measured against a clock at most 1 s old.
  const now = useClientClock(!finished);
  const retrying = state.status !== 'not-found' && state.retrying;

  return (
    <main className={styles.page}>
      {/* tabIndex: receives the focus when the route changes (App.tsx). */}
      <h1 tabIndex={-1} className={styles.title}>
        Resultado da simulação
      </h1>

      <p role="status">{statusText(state)}</p>
      {/* Outside the status region: a screen reader would read it out every second. */}
      {state.status === 'loaded' && !finished && (
        <p className={styles.elapsed}>
          Tempo decorrido: {elapsedSeconds(state.view.createdAt, state.clockOffsetMs, now)} s
        </p>
      )}
      <div role="alert" className={styles.notice}>
        {retrying && <p>{RETRYING_MESSAGE}</p>}
      </div>

      <p>
        <Link to="/">Simular novamente</Link>
      </p>
    </main>
  );
}

export function ResultPage() {
  const { id = '' } = useParams();
  // Another id starts over (state, polling, clock) instead of showing the previous one meanwhile.
  return <SimulationResult key={id} id={id} />;
}
