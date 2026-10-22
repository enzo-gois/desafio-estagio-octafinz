import type { Clock } from '../infra/http/clock';

export type FakeStep =
  | { status: number; body?: string; headers?: Record<string, string>; delayMs?: number }
  | { networkError: true }
  /** Never answers; rejects only when the request's signal aborts (like a hung connection). */
  | { hang: true };

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  redirect: RequestInit['redirect'];
}

/** A fetch that plays `steps` in order (the last one repeats) and records every request. */
export function createFakeFetch(steps: readonly FakeStep[], clock: Clock) {
  const requests: RecordedRequest[] = [];

  const fakeFetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const signal = init.signal ?? new AbortController().signal;
    requests.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : '',
      redirect: init.redirect,
    });

    const step = steps[Math.min(requests.length - 1, steps.length - 1)];
    if (!step) throw new Error('createFakeFetch: no steps given');
    if ('networkError' in step) throw new TypeError('fetch failed');
    if ('hang' in step) {
      return new Promise<Response>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }

    if (step.delayMs !== undefined) await clock.sleep(step.delayMs, signal);
    return new Response(step.body ?? null, { status: step.status, headers: step.headers });
  };

  return { fetch: fakeFetch as unknown as typeof fetch, requests };
}
