import { CONSENT_VERSION, STALE_CONSENT_MESSAGE } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { INPUT } from '../testing/fixtures';
import { EMPTY_FORM, type FormValues, toSimulationInput, validateForm } from './form-values';

// The fixture INPUT as the customer typed it: masked documents, a lowercase CNPJ.
const FILLED: FormValues = {
  name: 'Maria Silva',
  email: ' maria@example.com ',
  cpf: '529.982.247-25',
  birthDate: '1985-04-12',
  employmentType: 'CLT',
  employerCnpj: '12.abc.345/01de-35',
  netSalaryCents: 500_000,
  requestedAmountCents: 1_000_000,
  installments: '48',
  consent: true,
};

describe('toSimulationInput', () => {
  it('leaves an unanswered employment type and empty installments out', () => {
    expect(toSimulationInput(EMPTY_FORM, CONSENT_VERSION)).toMatchObject({
      employmentType: undefined,
      installments: undefined,
    });
  });

  it('sends the consent version it is given', () => {
    expect(toSimulationInput(FILLED, '2026-11-v2')).toMatchObject({ consentVersion: '2026-11-v2' });
  });
});

describe('validateForm', () => {
  it('returns the parsed input: documents normalized, e-mail trimmed, numbers as numbers', () => {
    expect(validateForm(FILLED, CONSENT_VERSION)).toEqual({ ok: true, input: INPUT });
  });

  it('reports every field of an empty form with the shared messages', () => {
    const result = validateForm(EMPTY_FORM, CONSENT_VERSION);

    expect(result).toMatchObject({
      ok: false,
      formErrors: [],
      fieldErrors: {
        name: ['Informe o nome'],
        email: ['E-mail inválido'],
        cpf: ['CPF inválido'],
        birthDate: ['Data de nascimento inválida'],
        employerCnpj: ['CNPJ inválido'],
        netSalaryCents: ['Valor inválido'],
        requestedAmountCents: ['Valor inválido'],
        installments: ['Número de parcelas inválido'],
        consent: ['É necessário autorizar a consulta aos bancos'],
      },
    });
  });

  it('accepts an amount above the cap only to report it', () => {
    const result = validateForm({ ...FILLED, requestedAmountCents: 100_000_001 }, CONSENT_VERSION);

    expect(result).toEqual({
      ok: false,
      fieldErrors: { requestedAmountCents: ['Valor máximo: R$ 1.000.000,00'] },
      formErrors: [],
    });
  });

  it('turns an outdated consent version into a general message', () => {
    expect(validateForm(FILLED, '2026-09-v1')).toEqual({
      ok: false,
      fieldErrors: {},
      formErrors: [STALE_CONSENT_MESSAGE],
    });
  });

  it('rejects installments that are not an integer', () => {
    expect(validateForm({ ...FILLED, installments: '12.5' }, CONSENT_VERSION)).toMatchObject({
      fieldErrors: { installments: ['Número de parcelas deve ser inteiro'] },
    });
  });
});
