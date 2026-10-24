import type { SimulationView } from '@simulador/shared';

/** Why the final simulation fails the smoke test. smoke.ts turns each kind into a message. */
export type SmokeProblem =
  /** The results do not name exactly the catalog's banks. */
  | { kind: 'banks-differ-from-catalog'; expected: readonly string[]; received: readonly string[] }
  /** The deadline ran out with the simulation still PROCESSING. */
  | { kind: 'still-processing'; pendingBankIds: readonly string[] }
  /** The status says the simulation finished, but some bank is still PENDING. */
  | { kind: 'pending-after-completion'; pendingBankIds: readonly string[] }
  /** Every bank ended UNAVAILABLE or ERROR: none actually answered. */
  | { kind: 'no-bank-answered' };

export type SmokeVerdict = { ok: true } | { ok: false; problem: SmokeProblem };

/**
 * Decides whether the simulation the smoke test read last passes. `view` already passed the
 * shared schema (a response outside it fails earlier, in smoke.ts) and is the simulation as the
 * polling left it: finished, or still PROCESSING when the deadline ran out.
 *
 * A failure of the system fails the smoke test; a bank failing does not, because the mock banks
 * draw failures on purpose. The checks run in this order and the first problem found is returned:
 *
 * 1. `banks-differ-from-catalog`: the bankIds of `view.results` are not exactly
 *    `catalogBankIds`. Order does not matter; a missing, extra or repeated bank does.
 *    `expected` is `catalogBankIds` and `received` the results' bankIds, both as given.
 * 2. `still-processing`: `view.status` is PROCESSING. `pendingBankIds` lists the PENDING banks
 *    in the order of `view.results`.
 * 3. `pending-after-completion`: the status is not PROCESSING, but some bank is PENDING (listed
 *    the same way).
 * 4. `no-bank-answered`: no bank is APPROVED or DENIED. A denial is an answer; all banks
 *    UNAVAILABLE or ERROR may mean the mock banks are not even running.
 *
 * Otherwise `{ ok: true }`, even with banks DENIED, UNAVAILABLE or ERROR.
 */

export function judgeFinalSimulation(
  view: SimulationView,
  catalogBankIds: readonly string[],
): SmokeVerdict {
  const received = view.results.map((result) => result.bankId);
  const sortedReceived = [...received].sort();
  const sortedExpected = [...catalogBankIds].sort();
  const sameBanks =
    sortedReceived.length === sortedExpected.length &&
    sortedReceived.every((bankId, index) => bankId === sortedExpected[index]);
  if (!sameBanks) {
    return {
      ok: false,
      problem: { kind: 'banks-differ-from-catalog', expected: catalogBankIds, received },
    };
  }

  const pendingBankIds = view.results
    .filter((result) => result.status === 'PENDING')
    .map((result) => result.bankId);

  if (view.status === 'PROCESSING') {
    return { ok: false, problem: { kind: 'still-processing', pendingBankIds } };
  }
  if (view.results.some((result) => result.status === 'PENDING')) {
    return { ok: false, problem: { kind: 'pending-after-completion', pendingBankIds } };
  }

  const someBankAnswered = view.results.some(
    (result) => result.status === 'APPROVED' || result.status === 'DENIED',
  );

  if (!someBankAnswered) {
    return { ok: false, problem: { kind: 'no-bank-answered' } };
  }

  return { ok: true };
}
