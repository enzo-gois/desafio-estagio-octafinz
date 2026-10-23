import { CONSENT_VERSION, STALE_CONSENT_MESSAGE, simulationInputSchema } from '@simulador/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { INPUT } from '../testing/fixtures';
import { FORM_FIELDS, splitFieldErrors } from './form-fields';

describe('FORM_FIELDS', () => {
  it('shows every input field except the consent version', () => {
    // A field added to the shared input breaks this test until the form decides to show it.
    const inputFields = Object.keys(simulationInputSchema.shape).filter(
      (field) => field !== 'consentVersion',
    );

    expect([...FORM_FIELDS].sort()).toEqual(inputFields.sort());
  });
});

describe('splitFieldErrors', () => {
  it('keeps errors of visible fields next to their input', () => {
    expect(splitFieldErrors({ cpf: ['CPF inválido'], consent: ['Autorize'] })).toEqual({
      fieldErrors: { cpf: ['CPF inválido'], consent: ['Autorize'] },
      formErrors: [],
    });
  });

  it.each([
    ['the consent version (sent, never shown)', 'consentVersion'],
    ['a field this form does not know', 'role'],
  ])('turns an error of %s into a general message', (_, field) => {
    expect(splitFieldErrors({ [field]: ['Mensagem'] })).toEqual({
      fieldErrors: {},
      formErrors: ['Mensagem'],
    });
  });

  it('loses no message: every one ends up next to an input or in the general messages', () => {
    const errors = {
      cpf: ['CPF inválido'],
      consentVersion: [STALE_CONSENT_MESSAGE],
      role: ['Campo desconhecido', 'Outro motivo'],
    };
    const { fieldErrors, formErrors } = splitFieldErrors(errors);

    const kept = [...Object.values(fieldErrors).flat(), ...formErrors];
    expect(kept.sort()).toEqual(Object.values(errors).flat().sort());
  });

  it('shows a repeated general message once', () => {
    expect(splitFieldErrors({ a: ['Igual'], b: ['Igual'] }).formErrors).toEqual(['Igual']);
  });

  it('ignores fields without messages', () => {
    expect(splitFieldErrors({ cpf: [], name: undefined })).toEqual({
      fieldErrors: {},
      formErrors: [],
    });
  });

  it("takes the form's own z.flattenError output: an outdated consent becomes a general message", () => {
    const result = simulationInputSchema.safeParse({ ...INPUT, consentVersion: '2026-09-v1' });
    expect(CONSENT_VERSION).not.toBe('2026-09-v1');

    const { fieldErrors } = z.flattenError(result.error ?? new z.ZodError([]));
    expect(splitFieldErrors(fieldErrors)).toEqual({
      fieldErrors: {},
      formErrors: [STALE_CONSENT_MESSAGE],
    });
  });
});
