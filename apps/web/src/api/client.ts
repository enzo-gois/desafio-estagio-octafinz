import {
  type BankCatalogView,
  bankCatalogViewSchema,
  type CreateSimulationResponse,
  createSimulationResponseSchema,
  type SimulationInput,
  type SimulationView,
  simulationViewSchema,
} from '@simulador/shared';
import { z } from 'zod';
import { type SplitErrors, splitFieldErrors } from '../lib/form-fields';
import { API_MESSAGES } from './messages';

type CommonFailure =
  | { kind: 'rate-limited'; message: string; retryAfterMs: number | undefined }
  | { kind: 'unavailable'; message: string; retryAfterMs: number | undefined }
  | { kind: 'network'; message: string }
  /** `detail` is for the console and the tests, never for the customer. */
  | { kind: 'unexpected'; message: string; detail: string }
  /** The caller cancelled: nothing to show. */
  | { kind: 'aborted' };

// Failures only some endpoints can have: a 400 means something only to the POST, a 404 only to
// the GET of a simulation. Anywhere else they are unexpected.
interface EndpointFailures {
  /** fieldErrors go next to their input; formErrors (no visible field) at the top of the form. */
  validation: { kind: 'validation'; message: string } & SplitErrors;
  'not-found': { kind: 'not-found'; message: string };
}

/** Every outcome of a call: the client never rejects. */
export type ApiResult<T, E extends keyof EndpointFailures = never> =
  { kind: 'ok'; data: T } | CommonFailure | EndpointFailures[E];

export interface ApiClient {
  createSimulation(
    input: SimulationInput,
    signal?: AbortSignal,
  ): Promise<ApiResult<CreateSimulationResponse, 'validation'>>;
  getSimulation(id: string, signal?: AbortSignal): Promise<ApiResult<SimulationView, 'not-found'>>;
  getBanks(signal?: AbortSignal): Promise<ApiResult<BankCatalogView>>;
}

export interface ApiClientOptions {
  /** Without a trailing slash, e.g. "/api". */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Covers the whole call, body included. With chained polling an answer that never comes would
// stop the polling for good, and a hung POST would keep the submit button disabled.
const DEFAULT_TIMEOUT_MS = 10_000;

// The statuses the backend also treats as transient. Behind a reverse proxy, the API being down
// shows up as a 502 or 504 HTML page: still "try again later", not an unexpected error.
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

const messageBodySchema = z.object({ message: z.string().trim().min(1) });
// What the API's validationErrorBody() sends with a 400.
const validationBodySchema = z.object({
  message: z.string().min(1),
  errors: z.record(z.string(), z.array(z.string())),
});

type Json = { ok: true; value: unknown } | { ok: false };

type RawOutcome =
  | { kind: 'response'; status: number; headers: Headers; json: Json }
  | Extract<CommonFailure, { kind: 'network' | 'aborted' }>;

function parseJson(text: string): Json {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// Delta-seconds only, which is what the API and its rate limiter send. An HTTP-date would be
// compared with the browser's clock, which may be minutes off (the reason for serverTime).
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after')?.trim();
  return value !== undefined && /^\d+$/.test(value) ? Number(value) * 1000 : undefined;
}

function bodyMessage(json: Json, fallback: string): string {
  const parsed = json.ok ? messageBodySchema.safeParse(json.value) : undefined;
  return parsed?.success ? parsed.data.message : fallback;
}

const unexpected = (detail: string): CommonFailure => ({
  kind: 'unexpected',
  message: API_MESSAGES.UNEXPECTED,
  detail,
});

function validationFailure(json: Json): EndpointFailures['validation'] | CommonFailure {
  const body = json.ok ? validationBodySchema.safeParse(json.value) : undefined;
  if (!body?.success) return unexpected('400 without the API validation body');

  // An outdated consentVersion, or a field the form does not know, has no input to show its
  // message next to: it goes to formErrors instead of disappearing.
  return { kind: 'validation', message: body.data.message, ...splitFieldErrors(body.data.errors) };
}

interface ResponseSpec<T, E extends keyof EndpointFailures> {
  schema: z.ZodType<T>;
  /** Statuses only this endpoint gives a meaning to; undefined for everything else. */
  endpointFailure?: (status: number, json: Json) => EndpointFailures[E] | CommonFailure | undefined;
}

function toResult<T, E extends keyof EndpointFailures>(
  raw: RawOutcome,
  spec: ResponseSpec<T, E>,
): ApiResult<T, E> {
  if (raw.kind !== 'response') return raw;
  const { status, headers, json } = raw;

  if (status >= 200 && status < 300) {
    // An HTML page with 200 is the classic misconfigured proxy serving the SPA for /api.
    if (!json.ok) return unexpected(`${status} with a body that is not JSON`);
    const parsed = spec.schema.safeParse(json.value);
    return parsed.success
      ? { kind: 'ok', data: parsed.data }
      : unexpected(`${status} with a body outside the shared schema`);
  }

  const specific = spec.endpointFailure?.(status, json);
  if (specific) return specific;

  if (status === 429) {
    const message = bodyMessage(json, API_MESSAGES.RATE_LIMITED);
    return { kind: 'rate-limited', message, retryAfterMs: retryAfterMs(headers) };
  }
  if (UNAVAILABLE_STATUSES.has(status)) {
    const message = bodyMessage(json, API_MESSAGES.UNAVAILABLE);
    return { kind: 'unavailable', message, retryAfterMs: retryAfterMs(headers) };
  }
  return unexpected(`HTTP ${status}`);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  // A plain function, so fetch is never called as a method of `options` ("Illegal invocation").
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<RawOutcome> {
    // One signal for the request, aborted by the caller or by the timeout, whichever comes first.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await send(`${baseUrl}${path}`, { ...init, signal: controller.signal });
      // Read inside the timeout: a body that never ends must not hang the caller either.
      const json = parseJson(await response.text());
      // Once the caller has cancelled it gets nothing back, not even an answer that made it.
      if (signal?.aborted) return { kind: 'aborted' };
      return { kind: 'response', status: response.status, headers: response.headers, json };
    } catch {
      // The caller's intent wins over the timeout when both happened.
      if (signal?.aborted) return { kind: 'aborted' };
      return { kind: 'network', message: timedOut ? API_MESSAGES.TIMEOUT : API_MESSAGES.NETWORK };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  // GETs are polled for changing state: never answered from the browser's HTTP cache.
  const get: RequestInit = {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  };

  return {
    async createSimulation(input, signal) {
      const raw = await call(
        '/simulations',
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        signal,
      );
      return toResult<CreateSimulationResponse, 'validation'>(raw, {
        schema: createSimulationResponseSchema,
        endpointFailure: (status, json) => (status === 400 ? validationFailure(json) : undefined),
      });
    },

    async getSimulation(id, signal) {
      // Encoded: an id from the URL can never point the request at another route.
      const raw = await call(`/simulations/${encodeURIComponent(id)}`, get, signal);
      return toResult<SimulationView, 'not-found'>(raw, {
        schema: simulationViewSchema,
        endpointFailure: (status) =>
          status === 404 ? { kind: 'not-found', message: API_MESSAGES.NOT_FOUND } : undefined,
      });
    },

    async getBanks(signal) {
      const raw = await call('/banks', get, signal);
      return toResult<BankCatalogView, never>(raw, { schema: bankCatalogViewSchema });
    },
  };
}
