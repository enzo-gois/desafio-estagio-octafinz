# Simulador de Empréstimo Consignado

MVP em que um cliente solicita uma simulação de empréstimo consignado e vê o resultado
da avaliação de vários bancos. O ponto central é **consumir e interpretar respostas de
serviços de terceiros (bancos) que não controlamos**, com resiliência a falhas.

## Stack
- TypeScript em tudo (strict mode).
- Monorepo com npm workspaces.
- Backend: Fastify (`apps/api`).
- Frontend: React + Vite (`apps/web`).
- Bancos simulados: servidores Fastify separados (`apps/mock-banks`), um por porta.
- Schemas compartilhados: Zod (`packages/shared`).
- Persistência: SQLite com Prisma, atrás da interface `SimulationRepository`.
- Testes: Vitest.
- Logs: pino (nativo do Fastify), com redação de dados pessoais.
- docker-compose para subir tudo com um comando.

## Arquitetura (apps/api/src)
- `domain/` – entidades e regras puras (cálculo Tabela Price, margem consignável). Sem import de framework.
- `application/` – casos de uso (`CreateSimulation`, `GetSimulation`), orquestrador dos bancos.
- `infra/banks/` – um adapter por banco implementando `BankProvider` + registry.
- `infra/http/` – cliente HTTP com timeout (AbortController), retry com backoff + jitter e circuit breaker.
- `infra/persistence/` – implementação do repositório.
- `http/` – rotas e controllers Fastify (finos: validam e chamam caso de uso).

Dependências apontam para dentro: `http` e `infra` dependem de `application`/`domain`, nunca o contrário.

## Contratos centrais
Fonte da verdade: schemas Zod em `packages/shared` e portas em `apps/api/src/application/ports`.
```ts
type BankResultStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'UNAVAILABLE' | 'ERROR';
type Offer = { amountCents: number; installments: number; monthlyRate: number; installmentCents: number };

// União discriminada por status (strictObject): só APPROVED tem offer, e nela é obrigatória.
type BankResult = {
  bankId: string;
  reason?: string;     // motivo legível ao cliente
  latencyMs?: number;
  attempts?: number;   // tentativas HTTP; 0 = circuito aberto, nenhuma chamada feita
} & ({ status: 'APPROVED'; offer: Offer } | { status: Exclude<BankResultStatus, 'APPROVED'> });

interface BankProvider {
  readonly id: string;
  // Nunca rejeita: falha vira UNAVAILABLE (não respondeu) ou ERROR (respondeu errado).
  // context.simulationId compõe o Idempotency-Key (simulationId:bankId) e o correlation id dos logs.
  simulate(
    input: SimulationInput,
    signal: AbortSignal,
    context: { simulationId: string },
  ): Promise<BankResult>;
}

// GET /simulations/:id. Sem autenticação (o UUID é a chave): nada pessoal além do CPF mascarado.
interface SimulationView {
  id: string;
  createdAt: string;
  status: 'PROCESSING' | 'COMPLETED_WITH_OFFERS' | 'COMPLETED_WITHOUT_OFFERS';
  retryable: boolean;                    // concluída com algum banco UNAVAILABLE/ERROR
  request: { requestedAmountCents: number; installments: number; cpfMasked: string };
  margin: { fitsMargin: boolean };       // só isso: o resto permitiria recalcular o salário
  bestOffer: { bankId: string } | null;  // menor taxa mensal (contrapropostas incluídas)
  results: BankResultView[];             // BankResult; se APPROVED, + isCounterOffer e totalPayableCents
}
```

## Fluxo
1. `POST /simulations` valida com Zod, salva com todos os bancos `PENDING`, responde `202 { id }`.
2. Em background, o orquestrador chama todos os bancos em paralelo (`Promise.allSettled`),
   gravando cada resultado assim que chega.
3. `GET /simulations/:id` devolve o estado atual; o front faz polling até nenhum banco estar `PENDING`.

## Bancos simulados (contratos propositalmente diferentes)
- Banco Alfa: rápido, JSON camelCase, `status: "APPROVED" | "REJECTED"`.
- Banco Beta: snake_case, `result_code` numérico, valores monetários como string.
- Banco Gama: lento (2–6s), falha com 503 e às vezes devolve JSON malformado.
- Latência e taxa de falha configuráveis por variável de ambiente.
- Cada banco tem regra de aprovação fictícia própria, para que os resultados divirjam.

## Regras e convenções
- Dinheiro sempre em **centavos (inteiros)**. Nunca float para valores monetários.
- CPF e CNPJ validados por **dígito verificador**. O CNPJ deve aceitar o **formato alfanumérico**
  (emitido pela Receita desde jul/2026): 12 primeiras posições alfanuméricas, DV numérico,
  módulo 11 com valor de cada caractere = código ASCII − 48.
- Respostas dos bancos validadas com Zod no adapter; resposta inválida vira `ERROR`, nunca exceção solta.
- Retry apenas em erros transitórios (timeout, 502, 503, 504); nunca em 4xx ou reprovação.
- Nunca logar CPF, nome ou salário em claro (usar `redact` do pino / máscara).
- Margem consignável e taxas são **fictícias e configuráveis** (documentadas no README).
- Mensagens ao usuário em português; código e nomes em inglês.
- Todo adapter novo precisa de testes para: resposta de aprovação, de reprovação e malformada.
