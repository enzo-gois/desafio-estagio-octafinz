/**
 * Smoke test of the running system: GET /banks, POST /simulations, polling until the simulation
 * finishes, every response checked against the shared schemas. Exits 0 when it passes and 1
 * when it fails, saying (in Portuguese) which step failed and why.
 *
 * Runs against the compose by default, through nginx, so the /api proxy and its rewrite are
 * tested too. SMOKE_BASE_URL points it elsewhere.
 *
 *   npm run smoke
 *   docker compose --profile smoke run --rm smoke
 */
import {
  bankCatalogViewSchema,
  createSimulationResponseSchema,
  type SimulationView,
  simulationViewSchema,
} from '@simulador/shared';
// The API tests' fictitious customer: valid check digits (alphanumeric CNPJ), no real person.
import { CUSTOMER } from '../apps/api/src/testing/bank-fixtures';
import { judgeFinalSimulation, type SmokeProblem } from './smoke-verdict';

const BASE_URL = (process.env['SMOKE_BASE_URL'] ?? 'http://localhost:8080/api').replace(/\/+$/, '');
// Same as the front's client: a slow API is a failure, not an endless wait.
const REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;
// The API expires a bank still PENDING after 22 s (SIMULATION_PENDING_TTL_MS): 30 s is enough.
const POLL_DEADLINE_MS = 30_000;

/** A failed step: what the smoke test was doing and why it failed, in Portuguese. */
class SmokeFailure extends Error {
  readonly step: string;

  constructor(step: string, message: string) {
    super(message);
    this.name = 'SmokeFailure';
    this.step = step;
  }
}

interface JsonResponse {
  status: number;
  body: unknown;
}

const seconds = (ms: number) => `${ms / 1000} s`;

function describeFetchError(error: unknown, url: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `${url} não respondeu em ${seconds(REQUEST_TIMEOUT_MS)}.`;
  }
  const code = (error as { cause?: { code?: string } }).cause?.code;
  const { origin, hostname } = new URL(url);
  if (code === 'ECONNREFUSED') {
    return `nada respondeu em ${origin} (conexão recusada). O compose está no ar? Suba com "docker compose up -d --build --wait".`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `o endereço ${hostname} não foi encontrado (DNS). Confira o SMOKE_BASE_URL.`;
  }
  return `não foi possível falar com ${url}: ${code ?? (error as Error).message}.`;
}

// What an unexpected status usually means here, to point at the broken piece.
const STATUS_HINTS: Readonly<Record<number, string>> = {
  429: 'A API limitou as requisições (rate limit): espere um minuto e rode de novo.',
  502: 'O nginx não alcançou a API: ela está no ar?',
  503: 'A API está indisponível ou reiniciando.',
  504: 'O nginx desistiu de esperar a API.',
};

async function request(
  step: string,
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
): Promise<JsonResponse> {
  const url = `${BASE_URL}${path}`;
  let status: number;
  let contentType: string;
  let text: string;
  try {
    // One signal per request; it also covers reading the body.
    const response = await fetch(url, {
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    contentType = response.headers.get('content-type') ?? 'sem content-type';
    text = await response.text();
  } catch (error) {
    throw new SmokeFailure(step, describeFetchError(error, url));
  }

  try {
    return { status, body: JSON.parse(text) };
  } catch {
    const hint = STATUS_HINTS[status];
    throw new SmokeFailure(
      step,
      `${method} ${url} respondeu ${status} sem JSON (${contentType}).${hint ? ` ${hint}` : ''}`,
    );
  }
}

function expectStatus(step: string, response: JsonResponse, expected: number): void {
  if (response.status === expected) return;
  const message = (response.body as { message?: unknown } | null)?.message;
  const hint = STATUS_HINTS[response.status];
  throw new SmokeFailure(
    step,
    `esperava HTTP ${expected} e recebeu ${response.status}` +
      (typeof message === 'string' ? ` ("${message}")` : '') +
      `.${hint ? ` ${hint}` : ''}`,
  );
}

/** Zod issues as "path: message", e.g. "results.0.status: Invalid option". */
function describeIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}) {
  const shown = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || '(raiz)'}: ${issue.message}`);
  const more = error.issues.length > 3 ? ` (e mais ${error.issues.length - 3})` : '';
  return `resposta fora do schema do shared: ${shown.join('; ')}${more}.`;
}

function describeProblem(problem: SmokeProblem, view: SimulationView): string {
  switch (problem.kind) {
    case 'banks-differ-from-catalog':
      return `os bancos do resultado (${problem.received.join(', ') || 'nenhum'}) não são exatamente os do catálogo (${problem.expected.join(', ')}).`;
    case 'still-processing':
      return `a simulação não terminou em ${seconds(POLL_DEADLINE_MS)}; ainda PENDING: ${problem.pendingBankIds.join(', ')}.`;
    case 'pending-after-completion':
      return `a simulação diz ${view.status}, mas ${problem.pendingBankIds.join(', ')} ainda está PENDING.`;
    case 'no-bank-answered':
      return 'nenhum banco deu uma resposta de fato (APPROVED ou DENIED): todos terminaram UNAVAILABLE ou ERROR. Isso pode significar que os bancos simulados nem subiram (confira com "docker compose ps mock-banks").';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (message: string) => console.log(`[ok] ${message}`);

async function main(): Promise<void> {
  console.log(`Smoke test contra ${BASE_URL}\n`);

  let step = '1. GET /banks';
  const catalogResponse = await request(step, 'GET', '/banks');
  expectStatus(step, catalogResponse, 200);
  const catalog = bankCatalogViewSchema.safeParse(catalogResponse.body);
  if (!catalog.success) throw new SmokeFailure(step, describeIssues(catalog.error));
  if (catalog.data.banks.length === 0) throw new SmokeFailure(step, 'o catálogo não tem bancos.');
  const catalogBankIds = catalog.data.banks.map((bank) => bank.id);
  ok(`${step}: ${catalogBankIds.join(', ')}; consentimento ${catalog.data.consentVersion}`);

  step = '2. POST /simulations';
  const createResponse = await request(step, 'POST', '/simulations', {
    ...CUSTOMER,
    consentVersion: catalog.data.consentVersion,
  });
  expectStatus(step, createResponse, 202);
  const created = createSimulationResponseSchema.safeParse(createResponse.body);
  if (!created.success) throw new SmokeFailure(step, describeIssues(created.error));
  const { id } = created.data;
  ok(`${step}: simulação ${id}`);

  step = '3. Polling de GET /simulations/:id';
  const startedAt = Date.now();
  let view: SimulationView;
  let polls = 0;
  for (;;) {
    polls += 1;
    const response = await request(step, 'GET', `/simulations/${id}`);
    expectStatus(step, response, 200);
    const parsed = simulationViewSchema.safeParse(response.body);
    if (!parsed.success) throw new SmokeFailure(step, describeIssues(parsed.error));
    view = parsed.data;
    if (view.status !== 'PROCESSING') break;
    if (Date.now() - startedAt + POLL_INTERVAL_MS > POLL_DEADLINE_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  ok(`${step}: ${view.status} após ${polls} consulta(s) em ${elapsed} s`);
  for (const result of view.results) {
    const attempts = result.attempts === undefined ? '' : `, ${result.attempts} tentativa(s)`;
    const reason = result.reason ? ` "${result.reason}"` : '';
    console.log(`       ${result.bankId}: ${result.status}${attempts}${reason}`);
  }

  step = '4. Resultado final';
  const verdict = judgeFinalSimulation(view, catalogBankIds);
  if (!verdict.ok) throw new SmokeFailure(step, describeProblem(verdict.problem, view));
  ok(`${step}: bancos iguais aos do catálogo, ao menos um respondeu de fato`);
}

main().then(
  () => {
    console.log('\nSmoke test passou.');
  },
  (error: unknown) => {
    if (error instanceof SmokeFailure) {
      console.error(`[falhou] ${error.step}: ${error.message}`);
      console.error('\nSmoke test falhou.');
    } else {
      console.error('Erro inesperado no smoke test:', error);
    }
    process.exitCode = 1;
  },
);
