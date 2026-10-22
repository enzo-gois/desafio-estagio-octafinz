import { describe, expect, it, vi } from 'vitest';
import { type CallVerdict, CircuitBreaker } from './circuit-breaker';

function setup(failureThreshold = 3) {
  let now = 0;
  const onStateChange = vi.fn();
  const breaker = new CircuitBreaker(
    { failureThreshold, openMs: 30_000 },
    () => now,
    onStateChange,
  );
  const call = (verdict: CallVerdict) => {
    const permit = breaker.tryAcquire();
    if (!permit) throw new Error('expected a permit');
    permit.release(verdict);
  };
  const advance = (ms: number) => {
    now += ms;
  };
  const open = () => {
    for (let i = 0; i < failureThreshold; i += 1) call('FAILURE');
  };
  return { breaker, call, advance, open, onStateChange };
}

describe('CircuitBreaker', () => {
  describe('CLOSED', () => {
    it('stays closed below the failure threshold', () => {
      const { breaker, call } = setup();
      call('FAILURE');
      call('FAILURE');

      expect(breaker.state).toBe('CLOSED');
    });

    it('opens after consecutive failures reach the threshold', () => {
      const { breaker, open, onStateChange } = setup();
      open();

      expect(breaker.state).toBe('OPEN');
      expect(breaker.tryAcquire()).toBeUndefined();
      expect(onStateChange).toHaveBeenCalledWith('CLOSED', 'OPEN');
    });

    it('resets the count on success: failures must be consecutive', () => {
      const { breaker, call } = setup();
      call('FAILURE');
      call('FAILURE');
      call('SUCCESS');
      call('FAILURE');
      call('FAILURE');

      expect(breaker.state).toBe('CLOSED');
    });

    it('ignores aborted calls: they neither count nor reset', () => {
      const { breaker, call } = setup();
      call('FAILURE');
      call('FAILURE');
      call('NEUTRAL');

      expect(breaker.state).toBe('CLOSED');
      call('FAILURE');
      expect(breaker.state).toBe('OPEN');
    });
  });

  describe('OPEN', () => {
    it('fails fast until openMs has elapsed', () => {
      const { breaker, open, advance } = setup();
      open();
      advance(29_999);

      expect(breaker.tryAcquire()).toBeUndefined();
      expect(breaker.state).toBe('OPEN');
    });

    it('lets exactly one trial call through after openMs', () => {
      const { breaker, open, advance } = setup();
      open();
      advance(30_000);

      expect(breaker.tryAcquire()).toBeDefined();
      expect(breaker.state).toBe('HALF_OPEN');
      expect(breaker.tryAcquire()).toBeUndefined();
    });
  });

  describe('HALF_OPEN trial', () => {
    function trial(verdict: CallVerdict) {
      const ctx = setup();
      ctx.open();
      ctx.advance(30_000);
      ctx.call(verdict);
      return ctx;
    }

    it('closes on success', () => {
      const { breaker, onStateChange } = trial('SUCCESS');

      expect(breaker.state).toBe('CLOSED');
      expect(onStateChange).toHaveBeenLastCalledWith('HALF_OPEN', 'CLOSED');
    });

    it('reopens on failure and restarts the cool-down', () => {
      const { breaker, advance } = trial('FAILURE');

      expect(breaker.state).toBe('OPEN');
      advance(29_999);
      expect(breaker.tryAcquire()).toBeUndefined();
      advance(1);
      expect(breaker.tryAcquire()).toBeDefined();
    });

    it('on abort, frees the slot and returns to OPEN without restarting the cool-down', () => {
      const { breaker } = trial('NEUTRAL');

      expect(breaker.state).toBe('OPEN');
      // No time has passed, yet the next call is allowed as the new trial.
      expect(breaker.tryAcquire()).toBeDefined();
      expect(breaker.state).toBe('HALF_OPEN');
    });

    it('never gets stuck in HALF_OPEN, whatever the sequence of trial outcomes', () => {
      // `call` throws when no permit is available, so every step proves a trial was allowed.
      const { breaker, call, open, advance } = setup();
      open();
      advance(30_000);

      call('NEUTRAL');
      expect(breaker.state).toBe('OPEN');
      call('NEUTRAL'); // no time passed: an aborted trial does not restart the cool-down
      expect(breaker.state).toBe('OPEN');
      call('FAILURE');
      expect(breaker.state).toBe('OPEN');
      advance(30_000); // a failed trial does restart it
      call('NEUTRAL');
      call('SUCCESS');
      expect(breaker.state).toBe('CLOSED');
    });
  });

  describe('late results', () => {
    it('a call started while CLOSED cannot close an open circuit', () => {
      const { breaker, open } = setup();
      const late = breaker.tryAcquire();
      open();
      late?.release('SUCCESS');

      expect(breaker.state).toBe('OPEN');
    });

    it('a call from a previous CLOSED period does not count in the next one', () => {
      const { breaker, call, open, advance } = setup();
      const stale = breaker.tryAcquire();
      open();
      advance(30_000);
      call('SUCCESS'); // trial closes the circuit: a new CLOSED period starts
      call('FAILURE');
      call('FAILURE');
      stale?.release('FAILURE');

      expect(breaker.state).toBe('CLOSED');
    });

    it('only the first release of a permit counts', () => {
      const { breaker } = setup(2);
      const permit = breaker.tryAcquire();
      permit?.release('FAILURE');
      permit?.release('FAILURE');

      expect(breaker.state).toBe('CLOSED');
    });
  });
});
