import type { ReactNode } from 'react';
import styles from './Field.module.css';

/** What a control needs to be tied to its label, hint and error. */
export interface ControlProps {
  id: string;
  className: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  errors?: readonly string[];
  wide?: boolean;
  children: (control: ControlProps) => ReactNode;
}

/**
 * Label, error, control and hint. Hint and error are both in aria-describedby, so a screen reader
 * reads them when the field gets focus. The hint goes below the control: side by side, a field
 * with a long hint would otherwise push its control out of line with its neighbor's.
 */
export function Field({ id, label, hint, errors = [], wide = false, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors.length > 0 ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {errorId && (
        <p id={errorId} className={styles.error}>
          {/* The space outside the span: trailing spaces inside an element are dropped from the
              accessible description, which would read "Erro:Informe o nome". */}
          <span className="visually-hidden">Erro:</span> {errors.join(' ')}
        </p>
      )}
      {children({
        id,
        className: styles.control ?? '',
        'aria-invalid': errorId ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
