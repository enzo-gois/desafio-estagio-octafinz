import type { SimulationView } from '@simulador/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../api/context';
import { nextPollDelay, type PollOutcome } from './next-poll-delay';

export type SimulationPollingState =
  /** `retrying`: the last GET failed and another one is scheduled. */
  | { status: 'loading'; retrying: boolean }
  | {
      status: 'loaded';
      /** The last view that arrived. A failed GET keeps it on screen instead of erasing it. */
      view: SimulationView;
      /** serverTime − the client's clock when the view arrived; see elapsedSeconds. */
      clockOffsetMs: number;
      retrying: boolean;
    }
  /** A 404: unknown id or a simulation that no longer exists. Polling stops. */
  | { status: 'not-found'; message: string };

const INITIAL: SimulationPollingState = { status: 'loading', retrying: false };

function markRetrying(current: SimulationPollingState): SimulationPollingState {
  return current.status === 'not-found' ? current : { ...current, retrying: true };
}

/**
 * Polls GET /simulations/:id until no bank is PENDING (status ≠ PROCESSING) or the API answers
 * 404. The state belongs to one id: render the caller with key={id} to start over for another.
 */
export function useSimulationPolling(id: string): SimulationPollingState {
  const api = useApi();
  const [state, setState] = useState<SimulationPollingState>(INITIAL);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Per effect run, like the timer: StrictMode's discarded first mount starts its own count.
    let consecutiveFailures = 0;

    // Chained setTimeout instead of setInterval: the next GET is scheduled only once this one
    // has ended, so two never overlap, and a slow answer pushes the next one back instead of
    // piling requests up behind it.
    async function poll() {
      const result = await api.getSimulation(id, controller.signal);
      // Unmounted (or StrictMode's first mount): no state to update and nothing to schedule.
      if (result.kind === 'aborted' || controller.signal.aborted) return;

      let outcome: PollOutcome;
      switch (result.kind) {
        case 'ok': {
          const view = result.data;
          // Read right after the answer arrives. Off by the time the answer took to travel,
          // milliseconds against an elapsed time shown in seconds.
          const clockOffsetMs = Date.parse(view.serverTime) - Date.now();
          setState({ status: 'loaded', view, clockOffsetMs, retrying: false });
          if (view.status !== 'PROCESSING') return;
          consecutiveFailures = 0;
          outcome = { kind: 'ok' };
          break;
        }
        case 'not-found':
          setState({ status: 'not-found', message: result.message });
          return;
        default: {
          // network, rate-limited (429), unavailable (502/503/504) or unexpected (another
          // status, or a body outside the schema). Whatever the status, a Retry-After the
          // server sent is passed on.
          consecutiveFailures += 1;
          setState(markRetrying);
          const retryAfterMs = 'retryAfterMs' in result ? result.retryAfterMs : undefined;
          outcome = { kind: 'failed', consecutiveFailures, retryAfterMs };
        }
      }
      timer = setTimeout(() => void poll(), nextPollDelay(outcome));
    }

    void poll();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, id]);

  return state;
}
