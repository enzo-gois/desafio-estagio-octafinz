import {
  CONSENT_VERSION,
  SIMULATION_DATA_FIELD_LABELS,
  STALE_CONSENT_MESSAGE,
} from '@simulador/shared';
import { reloadPage } from '../lib/page';
import styles from './ConsentSection.module.css';
import type { CatalogState } from './use-bank-catalog';

const LIST = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });

export const CONSENT_ID = 'field-consent';

interface ConsentSectionProps {
  catalog: CatalogState;
  onRetry: () => void;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  errors?: readonly string[];
}

/**
 * Which data goes to which bank, from GET /banks, and the checkbox that authorizes it. Without
 * the list there is nothing to consent to, so every other state blocks sending.
 */
export function ConsentSection({
  catalog,
  onRetry,
  checked,
  onCheckedChange,
  errors = [],
}: ConsentSectionProps) {
  switch (catalog.status) {
    case 'loading':
      return <p role="status">Carregando a lista de bancos que recebem seus dados…</p>;

    case 'failed':
      return (
        <div role="alert" className={styles.problem}>
          <p>
            A lista de bancos que recebem seus dados não carregou. Sem ela não é possível autorizar
            a consulta.
          </p>
          <p>{catalog.message}</p>
          <button type="button" className={styles.secondaryButton} onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      );

    case 'outdated':
      return (
        <div role="alert" className={styles.problem}>
          <p>{STALE_CONSENT_MESSAGE}</p>
          <button type="button" className={styles.secondaryButton} onClick={reloadPage}>
            Recarregar a página
          </button>
        </div>
      );

    case 'ready': {
      const errorId = errors.length > 0 ? `${CONSENT_ID}-error` : undefined;
      return (
        <>
          <p id="consent-banks-intro">Para simular, enviamos estes dados a cada banco:</p>
          <ul className={styles.banks} aria-labelledby="consent-banks-intro" id="consent-banks">
            {catalog.catalog.banks.map((bank) => (
              <li key={bank.id}>
                <strong>{bank.name}</strong>:{' '}
                {LIST.format(bank.sharedFields.map((field) => SIMULATION_DATA_FIELD_LABELS[field]))}
                .
              </li>
            ))}
          </ul>
          {/* Fixed text from this bundle. It matches the API's list because the consent
              versions are equal; otherwise the catalog would be 'outdated'. */}
          <p className={styles.notShared} id="consent-not-shared">
            Seu nome e seu e-mail não são enviados a nenhum banco e não são gravados.
          </p>
          {errorId && (
            <p id={errorId} className={styles.error}>
              <span className="visually-hidden">Erro:</span> {errors.join(' ')}
            </p>
          )}
          <label className={styles.checkbox}>
            <input
              id={CONSENT_ID}
              type="checkbox"
              checked={checked}
              onChange={(event) => onCheckedChange(event.target.checked)}
              aria-invalid={errorId ? true : undefined}
              aria-describedby={[
                'consent-banks-intro',
                'consent-banks',
                'consent-not-shared',
                errorId,
              ]
                .filter(Boolean)
                .join(' ')}
            />
            Autorizo o envio desses dados aos bancos listados, para esta simulação.
          </label>
          <p className={styles.version}>Termos de consentimento, versão {CONSENT_VERSION}.</p>
        </>
      );
    }
  }
}
