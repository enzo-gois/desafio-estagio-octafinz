import type { BankResultView } from '@simulador/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { completedResult } from '../testing/fixtures';
import { BankCard } from './BankCard';

const REQUESTED = 1_000_000;
const ALFA_APPROVED = completedResult('alfa');
const BETA_COUNTER_OFFER = completedResult('beta');
const GAMA_UNAVAILABLE = completedResult('gama');

function renderCard(result: BankResultView, { isBestOffer = false } = {}) {
  render(<BankCard result={result} requestedAmountCents={REQUESTED} isBestOffer={isBestOffer} />);
  return screen.getByRole('article', { name: result.bankName });
}

/** The card's <dl> as { term: definition }, with Intl's no-break spaces made plain. */
function offerDetails(card: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(card)
      .queryAllByRole('term')
      .map((term) => [
        term.textContent,
        (term.nextElementSibling?.textContent ?? '').replace(/\s/g, ' '),
      ]),
  );
}

describe('BankCard', () => {
  it.each<{ state: string; result: BankResultView; label: string; tone: string }>([
    {
      state: 'pending',
      result: { bankId: 'gama', bankName: 'Banco Gama', status: 'PENDING' },
      label: 'Aguardando resposta',
      tone: 'pending',
    },
    { state: 'approved', result: ALFA_APPROVED, label: 'Aprovado', tone: 'approved' },
    {
      state: 'a counter-offer',
      result: BETA_COUNTER_OFFER,
      label: 'Contraproposta',
      tone: 'counter-offer',
    },
    {
      state: 'denied',
      result: { bankId: 'alfa', bankName: 'Banco Alfa', status: 'DENIED' },
      label: 'Não aprovado',
      tone: 'denied',
    },
    { state: 'unavailable', result: GAMA_UNAVAILABLE, label: 'Indisponível', tone: 'unavailable' },
    {
      state: 'an error',
      result: { bankId: 'beta', bankName: 'Banco Beta', status: 'ERROR' },
      label: 'Erro na resposta',
      tone: 'error',
    },
  ])('says $state in words, next to a hidden icon', ({ result, label, tone }) => {
    const card = renderCard(result);

    const state = within(card).getByText(label);
    expect(state.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // data-tone picks the color; the text above already says the same without it.
    expect(card).toHaveAttribute('data-tone', tone);
  });

  it('shows an approved offer: amount, installments, monthly rate, installment and total', () => {
    const card = renderCard(ALFA_APPROVED);

    expect(offerDetails(card)).toEqual({
      Valor: 'R$ 10.000,00',
      Parcelas: '48',
      Taxa: '1,79% a.m.',
      Parcela: 'R$ 312,24',
      'Total a pagar': 'R$ 14.987,52',
    });
    expect(within(card).queryByText(/pedidos/)).not.toBeInTheDocument();
  });

  it('highlights a counter-offer against the amount asked for, with its own details', () => {
    const card = renderCard(BETA_COUNTER_OFFER);

    expect(within(card).getByText(/pedidos/)).toHaveTextContent(
      'R$ 8.182,55 de R$ 10.000,00 pedidos',
    );
    expect(offerDetails(card)).toEqual({
      Valor: 'R$ 8.182,55',
      Parcelas: '48',
      Taxa: '1,59% a.m.',
      Parcela: 'R$ 245,00',
      'Total a pagar': 'R$ 11.760,00',
    });
  });

  it.each<{ state: string; result: BankResultView & { reason: string } }>([
    {
      state: 'a denial',
      result: {
        bankId: 'alfa',
        bankName: 'Banco Alfa',
        status: 'DENIED',
        reason: 'Margem consignável insuficiente para a parcela.',
      },
    },
    {
      state: 'an unavailable bank',
      result: {
        bankId: 'gama',
        bankName: 'Banco Gama',
        status: 'UNAVAILABLE',
        reason: 'O banco não respondeu a tempo.',
      },
    },
    {
      state: 'an error',
      result: {
        bankId: 'beta',
        bankName: 'Banco Beta',
        status: 'ERROR',
        reason: 'Não foi possível concluir a consulta neste banco.',
      },
    },
  ])('shows the reason the API gives for $state, and no offer', ({ result }) => {
    const card = renderCard(result);

    expect(within(card).getByText(result.reason)).toBeVisible();
    expect(offerDetails(card)).toEqual({});
  });

  it('shows the "Menor taxa" badge when told to', () => {
    const card = renderCard(BETA_COUNTER_OFFER, { isBestOffer: true });

    expect(within(card).getByText('Menor taxa')).toBeVisible();
  });

  it('has no badge otherwise', () => {
    const card = renderCard(BETA_COUNTER_OFFER);

    expect(within(card).queryByText('Menor taxa')).not.toBeInTheDocument();
  });
});
