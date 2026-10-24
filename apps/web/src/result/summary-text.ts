import type { SimulationView } from '@simulador/shared';

const RETRY_HINT =
  'Nem todos os bancos responderam: simular novamente pode trazer a resposta dos que faltaram.';
// Every bank UNAVAILABLE or ERROR: "nem todos" after "nenhum" would say the same thing twice.
const NO_ANSWER = 'Nenhum banco respondeu. Simular novamente pode trazer as respostas.';

/**
 * The summary sentence, shown above the cards and announced when the simulation ends. One case
 * per status, and per `retryable` once it has ended:
 *
 * - PROCESSING: how many banks answered so far (any status other than PENDING).
 *   "Consultando os bancos: 2 de 3 responderam." / with 1: "1 de 3 respondeu."
 * - COMPLETED_WITH_OFFERS: how many offers (APPROVED, counter-offers included).
 *   - 2 or more: and the bankName of `bestOffer` (the API picks it among the APPROVED results).
 *     "2 ofertas recebidas. A menor taxa é do Banco Beta."
 *   - 1: whose it is, with no "lowest rate": there is nothing to compare it with (the page shows
 *     no badge either). "1 oferta recebida, do Banco Beta."
 * - COMPLETED_WITHOUT_OFFERS: "no" is not "don't know".
 *   - Some bank DENIED: "Nenhum banco aprovou o pedido."
 *   - None did (every bank UNAVAILABLE or ERROR), always retryable: a sentence of its own,
 *     without the complement below, which would repeat it.
 *     "Nenhum banco respondeu. Simular novamente pode trazer as respostas."
 * - retryable (some bank UNAVAILABLE or ERROR), in the other completed cases: the sentence
 *   above, then "Nem todos os bancos responderam: simular novamente pode trazer a resposta dos
 *   que faltaram."
 */
export function summaryText(view: SimulationView): string {
  const { results } = view;

  if (view.status === 'PROCESSING') {
    const answered = results.filter((result) => result.status !== 'PENDING').length;
    const verb = answered === 1 ? 'respondeu' : 'responderam';
    return `Consultando os bancos: ${answered} de ${results.length} ${verb}.`;
  }

  let outcome: string;
  if (view.status === 'COMPLETED_WITH_OFFERS') {
    outcome = offersText(view);
  } else if (results.some((result) => result.status === 'DENIED')) {
    outcome = 'Nenhum banco aprovou o pedido.';
  } else {
    return NO_ANSWER;
  }
  return view.retryable ? `${outcome} ${RETRY_HINT}` : outcome;
}

function offersText({ results, bestOffer }: SimulationView): string {
  const offers = results.filter((result) => result.status === 'APPROVED');
  const [single] = offers;
  if (offers.length === 1 && single) return `1 oferta recebida, do ${single.bankName}.`;

  const best = results.find((result) => result.bankId === bestOffer?.bankId);
  // Always found (see above); the bankId is the same fallback the API's registry uses for names.
  const bestName = best?.bankName ?? bestOffer?.bankId;
  return `${offers.length} ofertas recebidas. A menor taxa é do ${bestName}.`;
}
