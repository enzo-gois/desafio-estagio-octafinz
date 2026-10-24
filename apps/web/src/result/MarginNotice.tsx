import { useId } from 'react';
import styles from './MarginNotice.module.css';

// The README's text (decision A1): an estimate, and the banks decide. The GET carries only
// fitsMargin, so it shows no amounts.
export const MARGIN_NOTICE_TEXT =
  'Pela nossa estimativa, a parcela deste pedido pode não caber na sua margem consignável. É ' +
  'apenas uma referência: cada banco faz a própria avaliação e dá a resposta final.';

/** Shown only when the estimated installment does not fit the margin (fitsMargin: false). */
export function MarginNotice() {
  const headingId = useId();
  return (
    <section className={styles.notice} aria-labelledby={headingId}>
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5m0-8h.01" />
      </svg>
      <div className={styles.body}>
        <h2 id={headingId} className={styles.heading}>
          Estimativa de margem
        </h2>
        <p>{MARGIN_NOTICE_TEXT}</p>
      </div>
    </section>
  );
}
