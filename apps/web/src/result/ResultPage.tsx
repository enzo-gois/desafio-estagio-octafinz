import type { SimulationView } from '@simulador/shared';
import { useEffect, useId, useState } from 'react';
import { useParams } from 'react-router';
import { Announcer } from './Announcer';
import { BankCard } from './BankCard';
import { elapsedSeconds } from './elapsed';
import { MarginNotice } from './MarginNotice';
import styles from './ResultPage.module.css';
import { NewSimulationLink, Summary } from './Summary';
import { useSimulationPolling } from './use-simulation-polling';

// Neutral on purpose: after a 429 or a 5xx the customer's connection is fine, and the notice
// must not blame it.
export const RETRYING_MESSAGE = 'Não foi possível atualizar o resultado agora. Tentando novamente…';

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

function BankList({ view }: { view: SimulationView }) {
  const headingId = useId();
  // bestOffer exists while processing too, as the best so far: the badge waits for the end so
  // it does not jump to another bank when a slower one answers. With a single offer there is
  // nothing to compare, so no "lowest rate" either.
  const offers = view.results.filter((result) => result.status === 'APPROVED').length;
  const bestBankId =
    view.status === 'PROCESSING' || offers < 2 ? undefined : view.bestOffer?.bankId;

  return (
    <section className={styles.banks} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        Respostas dos bancos
      </h2>
      {/* The API's order, which is the registry's: cards do not move as answers arrive. */}
      <ul className={styles.cards}>
        {view.results.map((result) => (
          <li key={result.bankId}>
            <BankCard
              result={result}
              requestedAmountCents={view.request.requestedAmountCents}
              isBestOffer={result.bankId === bestBankId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
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

      <Announcer state={state} />
      {/* Outside the live region: a screen reader would read it out every second. */}
      {state.status === 'loaded' && !finished && (
        <p className={styles.elapsed}>
          Tempo decorrido: {elapsedSeconds(state.view.createdAt, state.clockOffsetMs, now)} s
        </p>
      )}
      <div role="alert" className={styles.notice}>
        {retrying && <p>{RETRYING_MESSAGE}</p>}
      </div>

      {state.status === 'loading' && <p>Carregando a simulação…</p>}
      {state.status === 'not-found' && (
        <div className={styles.notFound}>
          <p>{state.message}</p>
          <NewSimulationLink primary>Fazer uma nova simulação</NewSimulationLink>
        </div>
      )}
      {state.status === 'loaded' && (
        <>
          <Summary view={state.view} />
          {!state.view.margin.fitsMargin && <MarginNotice />}
          <BankList view={state.view} />
        </>
      )}
    </main>
  );
}

export function ResultPage() {
  const { id = '' } = useParams();
  // Another id starts over (state, polling, clock) instead of showing the previous one meanwhile.
  return <SimulationResult key={id} id={id} />;
}
