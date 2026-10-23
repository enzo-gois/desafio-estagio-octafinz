import { SIMULATION_DATA_FIELDS } from '@simulador/shared';

/**
 * The input fields the form shows, in screen order (focus goes to the first one with an error).
 * consentVersion is sent with every simulation but has no input of its own.
 */
export const FORM_FIELDS = [...SIMULATION_DATA_FIELDS, 'consent'] as const;

export type FormField = (typeof FORM_FIELDS)[number];

/** One message list per visible field: the shape of z.flattenError(...).fieldErrors. */
export type FieldErrors = { [K in FormField]?: string[] };

export interface SplitErrors {
  /** Shown next to their input. */
  fieldErrors: FieldErrors;
  /** Shown as a general message at the top of the form. */
  formErrors: string[];
}

const VISIBLE = new Set<string>(FORM_FIELDS);
const isFormField = (field: string): field is FormField => VISIBLE.has(field);

/**
 * Splits errors keyed by field into the ones shown next to an input and the rest. A field with no
 * input on screen (consentVersion, or one this form does not know) must not make its message
 * disappear: the customer would click "submit" again and again without seeing why it fails.
 * Takes the API's 400 `errors` and z.flattenError(...).fieldErrors alike.
 */
export function splitFieldErrors(
  errors: Readonly<Record<string, readonly string[] | undefined>>,
): SplitErrors {
  const fieldErrors: FieldErrors = {};
  const formErrors = new Set<string>();

  for (const [field, messages = []] of Object.entries(errors)) {
    if (messages.length === 0) continue;
    if (isFormField(field)) fieldErrors[field] = [...messages];
    else for (const message of messages) formErrors.add(message);
  }
  return { fieldErrors, formErrors: [...formErrors] };
}
