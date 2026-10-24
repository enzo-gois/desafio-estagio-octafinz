import type { SimulationView } from '@simulador/shared';
import { useId } from 'react';
import { Link } from 'react-router';
import styles from './Summary.module.css';
import { summaryText } from './summary-text';

/** Back to the form, which keeps the draft in memory and asks for the consent again. */
export function NewSimulationLink({ primary, children }: { primary: boolean; children: string }) {
  return (
    <Link to="/" className={styles.link} data-variant={primary ? 'primary' : 'secondary'}>
      {children}
    </Link>
  );
}

export function Summary({ view }: { view: SimulationView }) {
  const headingId = useId();
  const finished = view.status !== 'PROCESSING';

  return (
    <section className={styles.summary} data-status={view.status} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Resumo
      </h2>
      <p>{summaryText(view)}</p>
      {/* Nothing to redo while the banks are still answering. */}
      {finished &&
        (view.retryable ? (
          // Some bank did not answer: the same data may bring its answer.
          <NewSimulationLink primary>Simular novamente</NewSimulationLink>
        ) : (
          // Every bank answered: the same data would get the same answers.
          <NewSimulationLink primary={false}>Ajustar e simular de novo</NewSimulationLink>
        ))}
    </section>
  );
}
