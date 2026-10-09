# Padrões de Effect na API

Effect 4 é o padrão para compor falhas esperadas, recursos, prazos, cache e concorrência na API.
Os contratos de domínio continuam concretos. Probot, PQueue e o AI SDK recebem `Promise` nos seus
limites de integração. Programas internos que já usam Effect compõem Effects diretamente.

## Escolha por problema

| Problema                                      | Padrão                                               | Implementação no Codekeat               |
| --------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| Etapas dependentes com falhas esperadas       | `Effect.gen`, `Data.TaggedError`, `Effect.result`    | `ReviewRunProcessorService`             |
| Chunks ou lotes que param na primeira falha   | `Effect.forEach` com concorrência explícita          | Geração e julgamento no processor       |
| Fontes GitHub independentes ou compartilhadas | `Effect.forEach`, `Cache` por execução e `Semaphore` | Carregador do contexto do repositório   |
| Busca e pacotes de investigação               | `Cache.makeWith`, concorrência limitada e prazo      | `ReviewEvidenceRetrievalService`        |
| Acesso exclusivo ao orçamento de evidências   | `Semaphore.withPermit`                               | `ReviewContextTool`                     |
| Token com TTL e consultas concorrentes        | `Cache.makeWith` e invalidação condicional           | `TakeatMcpAccessTokenService`           |
| Capacidade real de um modelo                  | `Cache.makeWith`, prazo e falha tipada               | Preflight Google sobre o request do SDK |
| Conexão ou requisição que precisa de cleanup  | `Effect.acquireUseRelease` e `Effect.ensuring`       | Sessões MCP e requisição OAuth          |
| Prazo de operação com cancelamento de I/O     | `Effect.timeoutOrElse` e `AbortSignal`               | OAuth, MCP e finalizadores              |
| Recuperação de uma falha específica           | `Effect.catchTag` ou `Effect.catchIf`                | Renovação de autenticação MCP           |
| Expiração ou timeout em testes                | `TestClock` e fibers em escopo                       | Testes do cache OAuth                   |

Funções puras continuam funções TypeScript. Schemas Zod permanecem a fonte de validação dos contratos
externos, inclusive para `Output.object` do AI SDK.

## Falhas e composição

Represente falhas esperadas no canal `E` de `Effect<A, E, R>`. Use `Data.TaggedError` quando a falha
precisa de identificação e campos concretos. Um resultado de negócio, como ignorar um PR desatualizado,
continua sendo um estado válido do contrato.

Normalize erros externos imediatamente em `Effect.tryPromise`. Preserve somente códigos e campos
necessários para a decisão. Respostas, credenciais e causas externas completas não entram em logs.
`Effect.sync` adia operações síncronas até a execução do programa. Defeitos de programação e falhas
de persistência não devem virar silenciosamente erros do modelo.

Componha programas internos antes de executá-los. Use `runPromise` nos limites que exigem Promise.
O processor converte o resultado da análise com `Effect.result` antes de persistir a conclusão.
Uma falha posterior no enfileiramento do relatório não altera uma review que já foi concluída.

O pipeline usa `Effect.forEach` com concorrência configurável para unidades persistidas. Uma falha
interrompe unidades pendentes e impede a publicação de findings parciais. Checkpoints concluídos
permanecem disponíveis para retomada. A deduplicação, as evidências e o arredondamento final
dos custos continuam sendo decisões do domínio.

Referência: [falhas esperadas e composição](https://effect.website/docs/v4/error-management/expected-errors).

## Recursos, prazos e recuperação

Adquira recursos com `acquireUseRelease` ou com um escopo cujo dono esteja definido. O finalizador
precisa executar em sucesso, falha e interrupção. Para sessões MCP, o encerramento remoto precede o
fechamento local. `ensuring` garante o fechamento mesmo quando o encerramento remoto falha.

Um timeout precisa limitar a espera e cancelar o I/O. Mantenha o mesmo `AbortSignal` durante toda
a requisição, incluindo a leitura do corpo. Finalizadores são protegidos contra interrupção por
padrão. Operações de cleanup que podem travar usam `Effect.interruptible` com prazo próprio.
OAuth e cada operação MCP têm prazo de 10 segundos. Encerramento remoto e fechamento local também
têm prazos individuais de 10 segundos. Uma falha de cleanup é registrada sem substituir o resultado
original nem provocar renovação de credenciais.

Cada chamada HTTP admitida do modelo tem prazo de cinco minutos, incluindo a leitura da resposta.
A espera por concorrência, quota ou Retry-After não consome esse prazo. O processor usa fatias de
trinta minutos, incluindo o carregamento de contexto, e devolve
o run à fila com checkpoints para retomar as unidades pendentes. Os sinais propagam interrupção para
GitHub, Google e ferramentas MCP. Consultas de metadata e contagem de tokens têm prazo de dez segundos;
metadata válida fica no cache por uma hora. Contagens idênticas usam um cache de 256 entradas
com TTL de dez minutos e falhas com TTL zero. Um serviço privado fornece o body apenas ao lookup;
as entradas prontas conservam hash e contagem, sem reter o contexto da requisição. A espera por sincronização da Installation tem prazo próprio
de dez segundos e não cancela um inventário compartilhado com outros eventos.

O registro de consumo recebe cada resposta do provider antes de executar ferramentas ou validar a
saída estruturada. Recibos deduplicados e agregados são persistidos atomicamente antes das ferramentas ou validações.
Um ledger por run conserva esse uso quando etapas posteriores falham, inclui tentativas
de fallback e acumula retries autorizados. Custos são arredondados ao persistir; no retry, os tokens e
o snapshot de preços recuperam a precisão anterior. Ausência de metadata permanece desconhecida,
sem conversão silenciosa para custo zero.

A correção de conclusões inválidas usa uma recuperação Effect limitada a uma continuação do histórico
efetivo do SDK. Ela conserva o estado de evidências e os recibos, com duas rodadas de consulta e uma
finalização. Não aplica `Effect.retry` à investigação inteira. O host revalida integralmente a saída
e mantém falhas de transporte, uso, capacidade e cancelamento fora dessa política.

Para retries de falhas transitórias, use `Effect.retry` com uma política `Schedule` limitada e prazo
total explícito. Defina quais erros permitem repetição e quais operações são seguras para repetir.
O SDK ou adaptador que já possui uma política de retry permanece seu único dono. A renovação OAuth
após 401 repete a operação MCP uma vez e invalida somente o token rejeitado.

Referências: [recursos](https://effect.website/docs/v4/resource-management/introduction),
[retries](https://effect.website/docs/v4/error-management/retrying) e
[políticas de repetição](https://effect.website/docs/v4/scheduling/cookbook).

## Estado, testes e runtime

Use `Cache` para dados com TTL e lookup compartilhado. Use `Semaphore` para acesso limitado a um
recurso. O contexto GitHub usa quatro permits por carregamento e dezesseis compartilhados no processo.
Os caches de arquivos e diretórios pertencem somente à execução. Sucessos permanecem durante ela;
falhas têm TTL zero para permitir uma nova tentativa após indisponibilidade transitória. Isso
deduplica leituras em andamento sem conservar permissões ou conteúdo entre runs. O registro de ferramentas possui um permit por tentativa, garantindo execução e contabilização
sequenciais mesmo quando o AI SDK solicita chamadas concorrentes.

Teste comportamentos de tempo com `TestClock.layer()`. Inicie a operação em uma fiber filha, avance
o relógio e observe seu resultado. Verifique também o efeito externo esperado, como o sinal abortado
e a obtenção de outro token após timeout.

`Context.Service` e `Layer` organizam dependências e recursos compartilhados quando um programa
precisa deles no canal `R`. O bootstrap é o ponto de composição. A injeção atual por construtores
já fornece as dependências usadas pelo processor e pelos adaptadores.

Uma futura troca de PQueue por `Queue` precisa incluir um worker em escopo, shutdown da aplicação
e recuperação dos runs em andamento. PQueue limita os runs simultâneos por `REVIEW_CONCURRENCY`,
com padrão de cinco. `REVIEW_UNIT_CONCURRENCY`, com padrão dois, controla `Effect.forEach`
sobre unidades persistidas. Filhos de uma subdivisão executam sequencialmente dentro do slot do pai.
O guard Google compartilha um `Semaphore` entre requisições reais do gerador e do juiz e admite
chamadas e tokens conforme os limites locais configurados. Esperas por quota e Retry-After são
canceláveis. Publicações usam outra fila serial. A inicialização recupera claims interrompidos e
relatórios pendentes. Essa recuperação depende da única réplica API.
Uma porta Promise que recebe cancelamento precisa propagá-lo até a requisição e a leitura do corpo.
Logs Pino mantêm códigos, IDs e duração. A tabela privada de telemetria conserva metadados
operacionais para consultas autenticadas e não contém o conteúdo das fontes. `Effect.onExit` registra duração e resultado de cada
etapa do processor também em falha ou interrupção, sem registrar as fontes. Spans de tracing precisam de um exporter configurado para
produzir observabilidade fora do processo.

A recuperação de evidências avança cursores sequencialmente no host e lê documentos independentes
com concorrência quatro. Buscas completas usam um cache por catálogo autorizado; falhas e páginas
parciais têm TTL zero, e buscas sobre artefatos mutáveis de investigação ignoram o cache. O prazo de
dez segundos devolve progresso parcial com continuação e interrompe o I/O. Pacotes de evidências
compõem leituras independentes com `Effect.all` e conservam referências das fontes ainda pendentes.
O avaliador isolado usa finalizadores e snapshots de resultados para registrar o uso já recebido
também em cancelamento, sem publicar relatórios no GitHub.

Referências: [Semaphore](https://effect.website/docs/v4/concurrency/semaphore),
[TestClock](https://effect.website/docs/v4/testing/testclock),
[serviços](https://effect.website/docs/v4/requirements-management/services),
[layers](https://effect.website/docs/v4/requirements-management/layers) e
[Queue](https://effect.website/docs/v4/concurrency/queue).
