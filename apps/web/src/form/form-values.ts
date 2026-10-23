import {
  type EmploymentType,
  type SimulationInput,
  simulationInputSchema,
} from '@simulador/shared';
import { z } from 'zod';
import { type SplitErrors, splitFieldErrors } from '../lib/form-fields';

/**
 * What the inputs hold, which is not a SimulationInput: documents stay masked as typed, money is
 * already integer cents (or nothing yet), the select can be empty and the number input is text.
 */
export interface FormValues {
  name: string;
  email: string;
  cpf: string;
  birthDate: string;
  employmentType: EmploymentType | '';
  employerCnpj: string;
  netSalaryCents: number | undefined;
  requestedAmountCents: number | undefined;
  installments: string;
  consent: boolean;
}

export const EMPTY_FORM: FormValues = {
  name: '',
  email: '',
  cpf: '',
  birthDate: '',
  employmentType: '',
  employerCnpj: '',
  netSalaryCents: undefined,
  requestedAmountCents: undefined,
  installments: '',
  consent: false,
};

/**
 * Form state -> the object the shared schema parses. Masked documents go as they are (the schema
 * normalizes them); `consentVersion` is the one GET /banks returned with the text on screen.
 */
export function toSimulationInput(values: FormValues, consentVersion: string): unknown {
  const installments = values.installments.trim();
  return {
    name: values.name,
    email: values.email.trim(),
    cpf: values.cpf,
    birthDate: values.birthDate,
    employmentType: values.employmentType === '' ? undefined : values.employmentType,
    employerCnpj: values.employerCnpj,
    netSalaryCents: values.netSalaryCents,
    requestedAmountCents: values.requestedAmountCents,
    installments: installments === '' ? undefined : Number(installments),
    consent: values.consent,
    consentVersion,
  };
}

export type FormValidation = { ok: true; input: SimulationInput } | ({ ok: false } & SplitErrors);

/**
 * The backend's own rules and messages: the shared schema, flattened with z.flattenError and split
 * like a 400 from the API, so local and server errors take the same path to the screen.
 */
export function validateForm(values: FormValues, consentVersion: string): FormValidation {
  const parsed = simulationInputSchema.safeParse(toSimulationInput(values, consentVersion));
  if (parsed.success) return { ok: true, input: parsed.data };

  const flattened = z.flattenError(parsed.error);
  const { fieldErrors, formErrors } = splitFieldErrors(flattened.fieldErrors);
  return { ok: false, fieldErrors, formErrors: [...flattened.formErrors, ...formErrors] };
}
