import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from './consent';
import {
  MAX_AMOUNT_CENTS,
  STALE_CONSENT_MESSAGE,
  simulationInputSchema,
  simulationViewSchema,
} from './simulation';

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
  consentVersion: CONSENT_VERSION,
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

  it.each([
    ['an older consent version', { ...validInput, consentVersion: '2026-09-v1' }],
    ['no consent version', (({ consentVersion: _omitted, ...rest }) => rest)(validInput)],
  ])('asks to reload the page for %s', (_, input) => {
    const result = simulationInputSchema.safeParse(input);

    expect(result.error?.issues).toMatchObject([
      { path: ['consentVersion'], message: STALE_CONSENT_MESSAGE },
    ]);
  });

  it.each(['netSalaryCents', 'requestedAmountCents'])(
    'caps %s at R$ 1.000.000,00 with a Portuguese message',
    (field) => {
      expect(issuesFor({ ...validInput, [field]: MAX_AMOUNT_CENTS })).toEqual([]);
      const result = simulationInputSchema.safeParse({
        ...validInput,
        [field]: MAX_AMOUNT_CENTS + 1,
      });
      expect(result.error?.issues[0]).toMatchObject({
        path: [field],
        message: 'Valor máximo: R$ 1.000.000,00',
      });
    },
  );
});

describe('simulationViewSchema', () => {
  const view = {
    id: '2f1c6b8e-4f5a-4b7e-9c3d-1a2b3c4d5e6f',
    createdAt: '2026-10-22T12:00:00.000Z',
    serverTime: '2026-10-22T12:00:07.000Z',
    status: 'COMPLETED_WITH_OFFERS',
    retryable: false,
    request: { requestedAmountCents: 1_000_000, installments: 48, cpfMasked: '***.982.247-**' },
    margin: { fitsMargin: true },
    bestOffer: { bankId: 'beta' },
    results: [
      {
        bankId: 'beta',
        bankName: 'Banco Beta',
        status: 'APPROVED',
        offer: {
          amountCents: 818_255,
          installments: 48,
          monthlyRate: 0.0159,
          installmentCents: 24_500,
        },
        isCounterOffer: true,
        totalPayableCents: 1_176_000,
        latencyMs: 820,
        attempts: 1,
      },
      {
        bankId: 'gama',
        bankName: 'Banco Gama',
        status: 'UNAVAILABLE',
        reason: 'O banco não respondeu a tempo.',
      },
    ],
  };

  it('accepts a complete view', () => {
    expect(simulationViewSchema.safeParse(view).success).toBe(true);
  });

  it.each([
    ['marginCents', { ...view, margin: { ...view.margin, marginCents: 175_000 } }],
    ['commitmentBps', { ...view, margin: { ...view.margin, commitmentBps: 1_788 } }],
    ['a full CPF', { ...view, request: { ...view.request, cpf: '52998224725' } }],
  ])('rejects extra data such as %s', (_, candidate) => {
    expect(simulationViewSchema.safeParse(candidate).success).toBe(false);
  });

  it('requires the server time and a bank name on every result', () => {
    const { serverTime: _omitted, ...withoutServerTime } = view;
    const [, unavailable] = view.results;
    const { bankName: _name, ...withoutName } = unavailable ?? {};

    expect(simulationViewSchema.safeParse(withoutServerTime).success).toBe(false);
    expect(simulationViewSchema.safeParse({ ...view, results: [withoutName] }).success).toBe(false);
  });

  it('requires the counter-offer flag and total on approved results only', () => {
    const [approved, unavailable] = view.results;
    const { isCounterOffer: _flag, ...withoutFlag } = approved ?? {};

    expect(simulationViewSchema.safeParse({ ...view, results: [withoutFlag] }).success).toBe(false);
    expect(
      simulationViewSchema.safeParse({
        ...view,
        results: [{ ...unavailable, isCounterOffer: false }],
      }).success,
    ).toBe(false);
  });
});
