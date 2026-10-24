import type { SimulationView } from '@simulador/shared';
import { bankStateLabel } from './bank-state';
import { summaryText } from './summary-text';
import type { SimulationPollingState } from './use-simulation-polling';

function wasPending(view: SimulationView, bankId: string): boolean {
  return view.results.some((result) => result.bankId === bankId && result.status === 'PENDING');
}

/**
 * What the live region says when the polling state goes from `previous` to `current`, or
 * undefined when there is nothing new (a GET that changed nothing, a failed GET).
 *
 * - The first view: the summary only. A page opened on a finished simulation is not read out
 *   bank by bank; the cards are there to be read.
 * - Then each bank that left PENDING, in the API's order: "Banco Beta: contraproposta."
 * - When the simulation ends: those banks, then the summary, in one message. Two messages in a
 *   row could make the screen reader drop the first.
 * - A 404: its message.
 */
export function announcementFor(
  previous: SimulationPollingState,
  current: SimulationPollingState,
): string | undefined {
  if (current.status === 'not-found') {
    return previous.status === 'not-found' ? undefined : current.message;
  }
  if (current.status !== 'loaded') return undefined;
  if (previous.status !== 'loaded') return summaryText(current.view);

  const before = previous.view;
  const now = current.view;
  const parts = now.results
    .filter((result) => result.status !== 'PENDING' && wasPending(before, result.bankId))
    .map((result) => `${result.bankName}: ${bankStateLabel(result).toLocaleLowerCase('pt-BR')}.`);
  if (before.status === 'PROCESSING' && now.status !== 'PROCESSING') {
    parts.push(summaryText(now));
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
