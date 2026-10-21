import { describe, expect, it } from 'vitest';
import { simulationInputSchema } from './simulation';

const validInput = {
  name: 'Maria Silva',
  email: 'maria@example.com',
  cpf: '529.982.247-25',
  birthDate: '1985-04-12',
  employmentType: 'CLT',
  employerCnpj: '12.abc.345/01de-35',
  netSalaryCents: 500_000,
  requestedAmountCents: 1_000_000,
  installments: 48,
  consent: true,
};

const issuesFor = (input: unknown) => {
  const result = simulationInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('simulationInputSchema', () => {
  it('parses a valid input and normalizes the documents', () => {
    const parsed = simulationInputSchema.parse(validInput);

    expect(parsed.cpf).toBe('52998224725');
    expect(parsed.employerCnpj).toBe('12ABC34501DE35');
  });

  it('treats employmentType as optional', () => {
    const { employmentType: _omitted, ...input } = validInput;

    expect(simulationInputSchema.safeParse(input).success).toBe(true);
  });

  it('reports a Portuguese message for an invalid CPF', () => {
    const result = simulationInputSchema.safeParse({ ...validInput, cpf: '529.982.247-26' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('CPF inválido');
  });

  it('rejects a CNPJ with an unexpected character', () => {
    expect(issuesFor({ ...validInput, employerCnpj: '11.222.333/0001-81@' })).toEqual([
      'employerCnpj',
    ]);
  });

  it.each([
    ['decimal cents', { netSalaryCents: 5000.5 }, 'netSalaryCents'],
    ['zero amount', { requestedAmountCents: 0 }, 'requestedAmountCents'],
    ['amount as string', { requestedAmountCents: '1000000' }, 'requestedAmountCents'],
    ['installments below minimum', { installments: 5 }, 'installments'],
    ['installments above maximum', { installments: 97 }, 'installments'],
    ['non-integer installments', { installments: 12.5 }, 'installments'],
    ['invalid e-mail', { email: 'maria@' }, 'email'],
    ['non-ISO birth date', { birthDate: '12/04/1985' }, 'birthDate'],
    ['impossible birth date', { birthDate: '1985-02-30' }, 'birthDate'],
    ['unknown employment type', { employmentType: 'INTERN' }, 'employmentType'],
    ['consent false', { consent: false }, 'consent'],
    ['blank name', { name: '   ' }, 'name'],
  ])('rejects %s', (_, override, field) => {
    expect(issuesFor({ ...validInput, ...override })).toEqual([field]);
  });

  it('accepts the installment limits', () => {
    expect(issuesFor({ ...validInput, installments: 6 })).toEqual([]);
    expect(issuesFor({ ...validInput, installments: 96 })).toEqual([]);
  });

  it('requires consent to be present', () => {
    const { consent: _omitted, ...input } = validInput;

    expect(issuesFor(input)).toEqual(['consent']);
  });
});
