# Simulador de Empréstimo Consignado

> README em construção: instruções de execução, arquitetura e variáveis de ambiente serão
> consolidadas na etapa 7. Esta seção registra as decisões de projeto tomadas até aqui.

## Decisões de projeto

### Margem consignável: a API informa, não bloqueia (decisão A1)

A API estima a margem consignável (percentual **fictício e configurável** do salário líquido) e a
parcela do valor pedido a uma **taxa de referência fictícia**. Essa estimativa serve apenas para
**informar** o cliente: a simulação é sempre enviada aos bancos.

Motivos:

- A estimativa não conhece os descontos que o cliente já tem em folha, o percentual real por tipo
  de vínculo nem a taxa de cada banco. Bloquear com base nela geraria falsos negativos definitivos.
- Bloquear eliminaria contrapropostas: um banco pode aprovar um valor menor que cabe na margem.
- Os bancos são a autoridade sobre a aprovação; o objetivo do sistema é interpretar as respostas
  deles.

O aviso exibido ao cliente deve deixar explícito que se trata de uma **estimativa** e que **os
bancos fazem a avaliação final**. O `GET` devolve só `fitsMargin` (veja "Dados pessoais"), então o
aviso não mostra valores. Texto previsto quando a parcela estimada não cabe:

> Pela nossa estimativa, a parcela deste pedido pode não caber na sua margem consignável. É apenas
> uma referência: cada banco faz a própria avaliação e dá a resposta final.

### Proposta planejada: bloqueio só de casos impossíveis (A3)

Evolução considerada: continuar informando sempre, mas bloquear antes de consultar os bancos
quando o pedido for **impossível** (por exemplo, parcela estimada maior que o salário líquido
inteiro). Reduziria consultas inúteis — que no mundo real podem ter custo e ficar registradas em
bureaus de crédito — sem eliminar contrapropostas. Exige definir e justificar o limite.

### Melhor oferta: menor taxa mensal (decisão B1)

A melhor oferta é a de **menor taxa mensal** entre as aprovadas, incluindo contrapropostas. A
parcela não é critério: uma contraproposta tem parcela menor só porque empresta menos dinheiro.
Desempates, em ordem: valor integral antes de contraproposta, maior valor aprovado e, por fim,
`bankId` em ordem alfabética (resultado independente da ordem de chegada das respostas).

### Retry: lista de permissão e Retry-After exato

Só se tenta de novo o que está numa **lista de permissão** de falhas transitórias: timeout da
tentativa, erro de rede e os status 502, 503 e 504. Qualquer outro resultado — inclusive um tipo
de falha criado no futuro — não é repetido até alguém decidir que deve ser.

Sem `Retry-After`, a espera é um backoff exponencial com _full jitter_. Com `Retry-After`, a
espera é **exatamente** o valor pedido pelo banco, desde que caiba no tempo restante da consulta.

### Dados pessoais gravados (minimização)

O `SimulationInput` completo existe **só em memória**, durante a consulta aos bancos. No banco de
dados ficam apenas:

| Dado                                                  | Gravado?            | Por quê                                                                        |
| ----------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| CPF                                                   | Só mascarado        | `***.982.247-**` permite ao cliente reconhecer a simulação, não identificá-lo  |
| Nome, e-mail, nascimento, vínculo, CNPJ do empregador | Não                 | Só os bancos usam                                                              |
| Salário líquido                                       | Não                 | —                                                                              |
| Margem e parcela estimadas                            | Sim, nunca expostas | Junto com o percentual revelam o salário exato: não saem no `GET` nem nos logs |
| Valor pedido e parcelas                               | Sim                 | Identificar contraproposta e mostrar o resultado                               |
| Momento e versão do consentimento                     | Sim                 | Comprovar a base legal da consulta e a qual texto o cliente concordou          |
| Resultados dos bancos                                 | Sim                 | É o produto                                                                    |

O `GET /simulations/:id` não tem autenticação: o UUID aleatório é a única chave. Por isso ele
devolve, da avaliação de margem, **só** `fitsMargin`. Margem, parcela estimada ou percentual de
comprometimento permitiriam recalcular o salário a partir do valor pedido e da configuração
pública; um teste garante que salários diferentes produzem respostas idênticas.

Logs: sem corpo de requisição, sem IP do cliente, com `redact` do pino para CPF, nome, e-mail,
nascimento, salário, CNPJ e margem. O `simulationId` liga os logs da requisição aos dos bancos.

### PENDING nunca fica para sempre (decisão E3)

Um banco que ainda está `PENDING` depois do maior orçamento de tempo entre os bancos mais uma folga
(`SIMULATION_PENDING_TTL_MS`, padrão 22 s) vira `UNAVAILABLE`. Isso é feito em dois momentos: no
`GET` (o cliente nunca vê um PENDING eterno) e ao iniciar a API (limpa o que um processo anterior
deixou). A gravação é condicional, então um resultado real que chegue ao mesmo tempo prevalece.

### Desligamento em duas fases

Ao receber `SIGTERM`: (1) a API deixa de aceitar novas simulações (`POST` responde 503) e espera
as consultas em andamento por até `SHUTDOWN_DRAIN_MS`; o `GET` continua respondendo; (2) cancela o
que restou, gravando "O banco não respondeu a tempo. Tente novamente.", e espera até
`SHUTDOWN_ABORT_GRACE_MS` por essas gravações. A soma é validada no boot para caber nos 10 s do
`docker stop`.

### Proposta planejada: tentar de novo só um banco (R3)

Primeira evolução planejada: `POST /simulations/:id/banks/:bankId/retry` para um banco que ficou
`UNAVAILABLE` ou `ERROR`, **sem guardar dados pessoais**. O front reenvia os dados que ainda tem no
formulário; a API guarda na criação só um HMAC desses dados (irreversível) e confere que o reenvio
é da mesma simulação. Exige: a linha do banco voltar de final para `PENDING` (coluna de versão e
proteção contra retry duplo), expiração por linha (`pendingSince`) em vez da data da simulação, e
decidir quando reaproveitar o `Idempotency-Key` (após timeout, reaproveitar devolve o resultado que
o banco talvez já tenha processado). Hoje, "Simular novamente" reenvia o formulário inteiro.

### Melhoria planejada: jitter sobre o Retry-After

Se muitos clientes recebem o mesmo `Retry-After: 2` ao mesmo tempo, todos voltam juntos dois
segundos depois e podem derrubar o banco de novo. A melhoria é somar um pequeno jitter ao valor
pedido (por exemplo, até 10% a mais), **nunca menos** que o `Retry-After`, para respeitar o banco
e ainda assim espalhar as tentativas.
