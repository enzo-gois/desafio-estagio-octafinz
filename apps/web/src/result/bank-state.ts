import type { BankResultView } from '@simulador/shared';

/** A card's look. Each tone has a color, an icon and a text: none of them relies on color. */
export type BankTone =
  'pending' | 'approved' | 'counter-offer' | 'denied' | 'unavailable' | 'error';

const LABELS: Record<BankTone, string> = {
  pending: 'Aguardando resposta',
  approved: 'Aprovado',
  'counter-offer': 'Contraproposta',
  denied: 'Não aprovado',
  // Did not answer (timeout, 5xx, circuit open): the bank may answer another time.
  unavailable: 'Indisponível',
  // Answered something the adapter could not read.
  error: 'Erro na resposta',
};

export function bankTone(result: BankResultView): BankTone {
  switch (result.status) {
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
      return result.isCounterOffer ? 'counter-offer' : 'approved';
    case 'DENIED':
      return 'denied';
    case 'UNAVAILABLE':
      return 'unavailable';
    case 'ERROR':
      return 'error';
  }
}

/** What the card says about the bank, also announced when it answers. */
export function bankStateLabel(result: BankResultView): string {
  return LABELS[bankTone(result)];
}
