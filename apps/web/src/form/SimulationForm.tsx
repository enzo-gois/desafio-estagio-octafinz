import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  MAX_AMOUNT_CENTS,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
  STALE_CONSENT_MESSAGE,
} from '@simulador/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/context';
import { useDraft } from '../draft/draft-context';
import { remask, remaskMoney } from '../lib/caret';
import { FORM_FIELDS, type FormField, type SplitErrors } from '../lib/form-fields';
import { formatCents } from '../lib/format';
import { maskCnpjInput, maskCpfInput } from '../lib/masks';
import { reloadPage } from '../lib/page';
import { CONSENT_ID, ConsentSection } from './ConsentSection';
import { Field } from './Field';
import { EMPTY_FORM, type FormValues, validateForm } from './form-values';
import { MaskedInput } from './MaskedInput';
import styles from './SimulationForm.module.css';
import type { CatalogState } from './use-bank-catalog';

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  CLT: 'CLT (carteira assinada)',
  PUBLIC_SERVANT: 'Servidor público',
  INSS_RETIREE: 'Aposentado ou pensionista do INSS',
};

const MONEY_HINT = `Até ${formatCents(MAX_AMOUNT_CENTS)}.`;
const MESSAGES_ID = 'form-messages';
const NO_ERRORS: SplitErrors = { fieldErrors: {}, formErrors: [] };

const fieldId = (field: FormField) => (field === 'consent' ? CONSENT_ID : `field-${field}`);
const money = (cents: number | undefined) => (cents === undefined ? '' : formatCents(cents));

function waitHint(retryAfterMs: number | undefined): string {
  if (retryAfterMs === undefined) return '';
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return ` Aguarde cerca de ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'} antes de tentar de novo.`;
}

interface SimulationFormProps {
  catalog: CatalogState;
  onRetryCatalog: () => void;
  onCreated: (id: string) => void;
}

export function SimulationForm({ catalog, onRetryCatalog, onCreated }: SimulationFormProps) {
  const api = useApi();
  const { draft, saveDraft } = useDraft();
  const [values, setValues] = useState<FormValues>(() => draft ?? EMPTY_FORM);
  const [errors, setErrors] = useState<SplitErrors>(NO_ERRORS);
  // A general message that is not a validation error: 429, 503, no connection...
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // State only disables the button on the next render; two submits in the same frame (a double
  // click, Enter plus click) would both get through. The ref closes that gap synchronously.
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  // A new object per request, so asking twice for the same field still moves the focus.
  const [focusRequest, setFocusRequest] = useState<{ id: string }>();

  useEffect(() => () => request.current?.abort(), []);
  // After the render: the field already has aria-invalid and its message when it gets focus.
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  const ready = catalog.status === 'ready';
  const general = [...errors.formErrors, ...(notice ? [notice] : [])];
  const staleConsent = errors.formErrors.includes(STALE_CONSENT_MESSAGE);

  function update<K extends FormField>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    // The customer is fixing this field: its old message no longer applies.
    setErrors((current) =>
      current.fieldErrors[field]
        ? { ...current, fieldErrors: { ...current.fieldErrors, [field]: undefined } }
        : current,
    );
  }

  function show(split: SplitErrors, fallback?: string) {
    setErrors(split);
    const generalOnly = split.formErrors.length === 0 && fallback !== undefined;
    setNotice(generalOnly ? fallback : undefined);
    const firstInvalid = FORM_FIELDS.find((field) => split.fieldErrors[field]?.length);
    setFocusRequest({ id: firstInvalid ? fieldId(firstInvalid) : MESSAGES_ID });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || catalog.status !== 'ready') return;

    // The version of the text on screen, which is also the bundle's (otherwise: 'outdated').
    const validation = validateForm(values, catalog.catalog.consentVersion);
    if (!validation.ok) {
      show(validation);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setErrors(NO_ERRORS);
    setNotice(undefined);
    const controller = new AbortController();
    request.current = controller;

    const result = await api.createSimulation(validation.input, controller.signal);
    if (result.kind === 'aborted' || controller.signal.aborted) return; // the form is gone
    inFlight.current = false;
    setSubmitting(false);

    switch (result.kind) {
      case 'ok':
        saveDraft(values);
        onCreated(result.data.id);
        return;
      case 'validation': {
        const { fieldErrors, formErrors } = result;
        const nothingToShow =
          formErrors.length === 0 && Object.values(fieldErrors).every((m) => !m);
        show({ fieldErrors, formErrors }, nothingToShow ? result.message : undefined);
        return;
      }
      case 'rate-limited':
        show(NO_ERRORS, `${result.message}${waitHint(result.retryAfterMs)}`);
        return;
      default:
        show(NO_ERRORS, result.message);
    }
  }

  const { fieldErrors } = errors;

  return (
    <main className={styles.page}>
      <form
        className={styles.form}
        noValidate
        aria-labelledby="form-title"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <header className={styles.header}>
          {/* tabIndex: receives the focus when the route changes (App.tsx). */}
          <h1 id="form-title" tabIndex={-1} className={styles.title}>
            Simule seu empréstimo consignado
          </h1>
          <p className={styles.intro}>
            Consultamos os bancos ao mesmo tempo e mostramos a resposta de cada um.
          </p>
        </header>

        <div id={MESSAGES_ID} role="alert" tabIndex={-1} className={styles.messages}>
          {general.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {staleConsent && (
            <button type="button" className={styles.secondaryButton} onClick={reloadPage}>
              Recarregar a página
            </button>
          )}
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Seus dados</legend>
          <Field id={fieldId('name')} label="Nome completo" errors={fieldErrors.name} wide>
            {(control) => (
              <input
                {...control}
                type="text"
                autoComplete="name"
                value={values.name}
                onChange={(event) => update('name', event.target.value)}
              />
            )}
          </Field>
          <Field id={fieldId('email')} label="E-mail" errors={fieldErrors.email}>
            {(control) => (
              <input
                {...control}
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={values.email}
                onChange={(event) => update('email', event.target.value)}
              />
            )}
          </Field>
          <Field id={fieldId('cpf')} label="CPF" errors={fieldErrors.cpf}>
            {(control) => (
              <MaskedInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                value={values.cpf}
                remask={(raw, caret) => remask(maskCpfInput, raw, caret)}
                onEdit={(edit) => update('cpf', edit.value)}
              />
            )}
          </Field>
          <Field
            id={fieldId('birthDate')}
            label="Data de nascimento"
            errors={fieldErrors.birthDate}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                autoComplete="bday"
                value={values.birthDate}
                onChange={(event) => update('birthDate', event.target.value)}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Vínculo e renda</legend>
          <Field
            id={fieldId('employmentType')}
            label="Tipo de vínculo (opcional)"
            errors={fieldErrors.employmentType}
          >
            {(control) => (
              <select
                {...control}
                value={values.employmentType}
                onChange={(event) =>
                  update('employmentType', event.target.value as EmploymentType | '')
                }
              >
                <option value="">Não informar</option>
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EMPLOYMENT_LABELS[type]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={fieldId('employerCnpj')}
            label="CNPJ do empregador"
            hint="Pode ter letras nas 12 primeiras posições, como 12.ABC.345/01DE-35."
            errors={fieldErrors.employerCnpj}
          >
            {(control) => (
              <MaskedInput
                {...control}
                // Alphanumeric since 2026: a numeric keyboard would leave no way to type letters.
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={values.employerCnpj}
                remask={(raw, caret) => remask(maskCnpjInput, raw, caret)}
                onEdit={(edit) => update('employerCnpj', edit.value)}
              />
            )}
          </Field>
          <Field
            id={fieldId('netSalaryCents')}
            label="Salário líquido (após descontos)"
            hint={MONEY_HINT}
            errors={fieldErrors.netSalaryCents}
          >
            {(control) => (
              <MaskedInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                value={money(values.netSalaryCents)}
                remask={remaskMoney}
                onEdit={(edit) => update('netSalaryCents', edit.cents)}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Empréstimo</legend>
          <Field
            id={fieldId('requestedAmountCents')}
            label="Valor desejado"
            hint={MONEY_HINT}
            errors={fieldErrors.requestedAmountCents}
          >
            {(control) => (
              <MaskedInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                value={money(values.requestedAmountCents)}
                remask={remaskMoney}
                onEdit={(edit) => update('requestedAmountCents', edit.cents)}
              />
            )}
          </Field>
          <Field
            id={fieldId('installments')}
            label="Número de parcelas"
            hint={`De ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.`}
            errors={fieldErrors.installments}
          >
            {(control) => (
              <input
                {...control}
                type="number"
                inputMode="numeric"
                min={MIN_INSTALLMENTS}
                max={MAX_INSTALLMENTS}
                step={1}
                value={values.installments}
                onChange={(event) => update('installments', event.target.value)}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={`${styles.group} ${styles.consent}`}>
          <legend className={styles.legend}>Autorização</legend>
          <ConsentSection
            catalog={catalog}
            onRetry={onRetryCatalog}
            checked={values.consent}
            onCheckedChange={(checked) => update('consent', checked)}
            errors={fieldErrors.consent}
          />
        </fieldset>

        <div>
          <button type="submit" className={styles.submit} disabled={!ready || submitting}>
            {submitting ? 'Enviando…' : 'Simular'}
          </button>
        </div>
      </form>
    </main>
  );
}
