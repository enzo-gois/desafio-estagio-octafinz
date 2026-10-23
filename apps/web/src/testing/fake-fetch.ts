export type FakeReply =
  | {
      status: number;
      body?: string;
      headers?: Record<string, string>;
      /** Runs while the client reads the body: the response has arrived, the body not yet. */
      whileReading?: () => void;
    }
  | { networkError: true }
  /** Never answers; rejects only when the request's signal aborts (like a hung connection). */
  | { hang: true }
  /** Sends status and headers, then a body that never ends until the signal aborts. */
  | { hangBody: true; status: number };

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
  cache: RequestCache | undefined;
  signal: AbortSignal | undefined;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/** A fetch that plays `replies` in order (the last one repeats) and records every request. */
export function createFakeFetch(replies: readonly FakeReply[]) {
  const requests: RecordedRequest[] = [];

  const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const { signal } = init;
    requests.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
      cache: init.cache,
      signal: signal ?? undefined,
    });

    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    if (!reply) throw new Error('createFakeFetch: no replies given');

    if (signal?.aborted) throw abortReason(signal);
    if ('networkError' in reply) throw new TypeError('Failed to fetch');
    if ('hang' in reply) {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
      });
    }
    if ('hangBody' in reply) {
      const body = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(abortReason(signal)), {
            once: true,
          });
        },
      });
      return new Response(body, { status: reply.status });
    }
    const response = new Response(reply.body ?? null, {
      status: reply.status,
      headers: reply.headers,
    });
    const { whileReading } = reply;
    if (whileReading) {
      const read = response.text.bind(response);
      response.text = () => {
        whileReading();
        return read();
      };
    }
    return response;
  };

  return { fetch: fakeFetch as typeof fetch, requests };
}
