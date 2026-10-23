import { z } from 'zod';

/**
 * Version of the consent text the front shows next to the checkbox. The front sends it back with
 * the simulation and the API stores it with the moment of consent, so it is always known which
 * text the customer agreed to. The per-bank part of the text comes from GET /banks: changing a
 * bank's name or the fields it receives requires a new version (enforced by a test in the API).
 */
export const CONSENT_VERSION = '2026-10-v1';

/**
 * Every SimulationInput field that carries customer data, in form order: consent and
 * consentVersion are the agreement itself, not data. A shared test checks this list against the
 * input schema, so a new field cannot be left out of the consent text.
 */
export const SIMULATION_DATA_FIELDS = [
  'name',
  'email',
  'cpf',
  'birthDate',
  'employmentType',
  'employerCnpj',
  'netSalaryCents',
  'requestedAmountCents',
  'installments',
] as const;

export type SimulationDataField = (typeof SIMULATION_DATA_FIELDS)[number];

// How the consent text names each field ("O Banco Alfa recebe: CPF, data de nascimento...").
export const SIMULATION_DATA_FIELD_LABELS = {
  name: 'nome',
  email: 'e-mail',
  cpf: 'CPF',
  birthDate: 'data de nascimento',
  employmentType: 'tipo de vínculo',
  employerCnpj: 'CNPJ do empregador',
  netSalaryCents: 'salário líquido',
  requestedAmountCents: 'valor pedido',
  installments: 'número de parcelas',
} as const satisfies Record<SimulationDataField, string>;

/**
 * Response of GET /banks: what the form needs to tell the customer which data goes to which bank,
 * before any simulation exists. `sharedFields` lists exactly what that bank's adapter sends.
 */
export const bankCatalogViewSchema = z.strictObject({
  consentVersion: z.string().min(1),
  banks: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      sharedFields: z.array(z.enum(SIMULATION_DATA_FIELDS)),
    }),
  ),
});

export type BankCatalogView = z.infer<typeof bankCatalogViewSchema>;
