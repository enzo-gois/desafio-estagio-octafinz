import type { BankResultView } from '@simulador/shared';
import { type ReactNode, useId } from 'react';
import { formatCents, formatMonthlyRate } from '../lib/format';
import styles from './BankCard.module.css';
import { type BankTone, bankStateLabel, bankTone } from './bank-state';

// 24×24, drawn with the text color: the icon repeats what the text says, so it is aria-hidden.
const ICONS: Record<BankTone, ReactNode> = {
  pending: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  approved: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  // An arrow down: less than what was asked.
  'counter-offer': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10m-4-4 4 4 4-4" />
    </>
  ),
  denied: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  unavailable: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  error: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4m0 4h.01" />
    </>
  ),
};

function StateIcon({ tone }: { tone: BankTone }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[tone]}
    </svg>
  );
}

type ApprovedResult = Extract<BankResultView, { status: 'APPROVED' }>;

function OfferDetails({
  result,
  requestedAmountCents,
}: {
  result: ApprovedResult;
  requestedAmountCents: number;
}) {
  const { offer } = result;
  return (
    <>
      {result.isCounterOffer && (
        <p className={styles.counterOffer}>
          <strong>{formatCents(offer.amountCents)}</strong> de {formatCents(requestedAmountCents)}{' '}
          pedidos
        </p>
      )}
      <dl className={styles.offer}>
        <div>
          <dt>Valor</dt>
          <dd>{formatCents(offer.amountCents)}</dd>
        </div>
        <div>
          <dt>Parcelas</dt>
          <dd>{offer.installments}</dd>
        </div>
        <div>
          <dt>Taxa</dt>
          <dd>{formatMonthlyRate(offer.monthlyRate)}</dd>
        </div>
        <div>
          <dt>Parcela</dt>
          <dd>{formatCents(offer.installmentCents)}</dd>
        </div>
        <div>
          <dt>Total a pagar</dt>
          <dd>{formatCents(result.totalPayableCents)}</dd>
        </div>
      </dl>
    </>
  );
}

interface BankCardProps {
  result: BankResultView;
  /** What the customer asked for: a counter-offer is shown against it. */
  requestedAmountCents: number;
  /** Shows the "Menor taxa" badge. The page sets it only once the simulation has ended. */
  isBestOffer: boolean;
}

export function BankCard({ result, requestedAmountCents, isBestOffer }: BankCardProps) {
  const headingId = useId();
  const tone = bankTone(result);

  return (
    <article className={styles.card} data-tone={tone} aria-labelledby={headingId}>
      <div className={styles.header}>
        {/* h3: the page has h1, and h2 for the list of banks. */}
        <h3 id={headingId} className={styles.name}>
          {result.bankName}
        </h3>
        {isBestOffer && <span className={styles.badge}>Menor taxa</span>}
      </div>
      <p className={styles.state}>
        <StateIcon tone={tone} />
        {bankStateLabel(result)}
      </p>
      {result.status === 'APPROVED' && (
        <OfferDetails result={result} requestedAmountCents={requestedAmountCents} />
      )}
      {/* The API's own words for the customer: why it was denied, or why there is no answer. */}
      {result.reason && <p className={styles.reason}>{result.reason}</p>}
    </article>
  );
}
