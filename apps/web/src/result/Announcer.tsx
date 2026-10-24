import { useState } from 'react';
import { announcementFor } from './announcement';
import type { SimulationPollingState } from './use-simulation-polling';

/**
 * The page's live region (role="status", polite). It is rendered empty from the first render: a
 * region that appears together with its text is not announced. Visually hidden, since the cards
 * and the summary already show the same on screen.
 */
export function Announcer({ state }: { state: SimulationPollingState }) {
  const [previous, setPrevious] = useState(state);
  const [message, setMessage] = useState('');

  // Compared with the previous render's state while rendering (React's pattern for storing
  // information from previous renders): no effect, so no frame where the region lags behind.
  if (state !== previous) {
    setPrevious(state);
    const next = announcementFor(previous, state);
    if (next !== undefined) setMessage(next);
  }

  return (
    <div role="status" className="visually-hidden">
      {message}
    </div>
  );
}
