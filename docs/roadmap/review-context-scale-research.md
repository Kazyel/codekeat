# Escala do contexto de reviews

Pesquisa iniciada em 8 de outubro de 2026, com implementação de catálogo e unidades em 9 de outubro.
As seções de decisão registram a evolução entre as rodadas e os limites ainda presentes.
A referência local usa Effect 4.0.2, AI SDK 7.0.135 e `@ai-sdk/google` 4.0.93.

## Fontes completas e chamadas com capacidade finita

O objetivo viável é conservar as fontes completas, recuperar evidências verificáveis e distribuir a
análise entre chamadas que cabem no modelo. A quantidade de fontes pode crescer com armazenamento,
indexação e trabalho adicional. Cada chamada continua limitada por tokens, saída, prazo e quota do
provider. Os limites de entrada e saída pertencem ao modelo e devem vir da sua metadata, como já
faz o preflight do Codekeat. [Gemini Models API](https://ai.google.dev/api/models).

Remover cortes por caracteres protege os dados de origem. Isso não garante que todas as fontes caibam
simultaneamente em um prompt. Também não prova qualidade constante para qualquer tamanho. A proposta
é preservar os originais fora do prompt, selecionar unidades completas de código e controlar a
cobertura da mudança. A qualidade precisa ser medida em PRs com rótulos humanos.

Uma investigação maior demanda mais leituras, tokens ou chamadas. Concorrência pode reduzir espera
entre operações independentes. Cache pode evitar trabalho repetido. Nenhum dos dois elimina o custo
de examinar informação nova. Não há evidência neste checkout que permita prometer latência constante
para qualquer volume de contexto.

## O que já foi observado

Estas evidências vieram da verificação local das correções de contexto, SDK e orquestração. Elas não
incluem um experimento de produção sobre falsos positivos.

| Evidência                                                                            | Resultado observado                                                                          | O que o resultado permite concluir                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Verificação integrada com `pnpm check`, `pnpm typecheck`, `pnpm test` e `pnpm build` | 230 testes aprovados e builds concluídos, conforme a execução integrada registrada na tarefa | Os comportamentos cobertos passam naquela revisão. A contagem não mede precisão ou recall das reviews. |
| Benchmark do chunker real, com 24.000 linhas adicionadas e 72.083 bytes              | 19.203 ms antes e 21 ms depois de acumular linhas em um `Set` sem copiá-lo a cada adição     | O reparo removeu o custo excessivo desse caso. É uma medição local, sem distribuição de amostras.      |
| Comparação humana entre estratégias de review                                        | Ainda não medida                                                                             | Não há taxa observada de falsos positivos nem ganho comprovado de recall.                              |
| Tempo total com GitHub, MCP e Gemini em PRs grandes                                  | Ainda não medido                                                                             | O benchmark do parser não representa a latência do run completo.                                       |

O baseline desta pesquisa conserva descrição, blocos do diff, fontes carregadas e respostas MCP completas. Conta
tokens do request serializado e falha explicitamente quando uma evidência indivisível ultrapassa o
modelo. Chunks e juiz continuam sequenciais dentro de cada run. A documentação do
[contexto atual](../review-context.md) e dos [padrões Effect](../effect.md) descreve essas garantias.
O [plano de qualidade](review-efficiency-intelligence.md) já distingue concordância do juiz de precisão
humana.

## Limites externos que a ingestão precisa reconhecer

| Origem             | Limite documentado                                                                                                                                                                                      | Consequência para o Codekeat                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Contents    | Até 1.000 entradas por diretório. Arquivos até 1 MB têm suporte completo. Entre 1 e 100 MB, usar mídia raw ou object; object pode retornar `encoding: none`. Acima de 100 MB, o endpoint não atende.    | Raw resolve parte dos arquivos grandes. Não resolve listagens incompletas nem elimina o limite de transporte. [Contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content).                                                                                             |
| GitHub Git Trees   | Consulta recursiva limitada a 100.000 entradas ou 7 MB. `truncated: true` exige consultar subárvores sem recursão.                                                                                      | Um manifesto só pode afirmar completude depois de resolver esse estado. [Git Trees API](https://docs.github.com/en/rest/git/trees#get-a-tree).                                                                                                                                                   |
| GitHub PR files    | A resposta paginada retorna no máximo 3.000 arquivos.                                                                                                                                                   | Paginação sozinha não permite enumerar PRs maiores. [PR files API](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files).                                                                                                                                                        |
| GitHub diffs       | A documentação de limites descreve até 300 arquivos por diff, 20.000 linhas ou 1 MB no total, e limites individuais de 20.000 linhas ou 500 KB.                                                         | `listFiles` e mídia diff têm contratos diferentes. Conferir o material recebido contra a mudança esperada; não interpretar HTTP 200 como prova de cobertura. [Repository diff limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#diff-limits). |
| GitHub rate limits | Uma instalação normalmente começa com 5.000 requests por hora. Há quotas diferentes para Enterprise e limites secundários, incluindo até 100 requests concorrentes compartilhados entre REST e GraphQL. | A concorrência do processo precisa respeitar quota, instalação e respostas de rate limit. O teto externo não é um valor recomendado para nossos workers. [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).                                  |

A página de limites do GitHub diz que a maioria afeta também a API. Ela não especifica todos os modos
de falha de cada endpoint. Portanto, esta pesquisa não assume que todo diff grande recebe exatamente
o mesmo corte. A proposta de engenharia é detectar falta de cobertura e possuir outro caminho de
ingestão, em vez de depender de um comportamento não documentado do transporte.

Para ultrapassar esses limites, o caminho estrutural é recuperar objetos Git autorizados e produzir
o diff local entre o merge-base e o head fixados. Isso exige suporte a forks, identificação do
merge-base, histórico suficiente, cancelamento, cache de objetos e limpeza dos recursos. Trocar o
endpoint por `compare` não resolve: sua lista de arquivos também tem teto de 300 na comparação.
[Compare commits API](https://docs.github.com/en/rest/commits/commits#compare-two-commits).

## Gemini e AI SDK na mesma contabilidade

Como referência, `gemini-3.1-pro-preview` documenta 1.048.576 tokens de entrada e 65.536 de saída.
São limites distintos daquele modelo, não uma regra fixa para todo catálogo. A configuração da review
precisa validar entrada e saída separadamente, considerando ferramentas e histórico. [Gemini 3.1 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview).
O Google também registra maior tempo até o primeiro token em contextos grandes e limitações ao
recuperar múltiplas informações. Uma janela grande não comprova recall constante.
[Limitações de contexto longo](https://ai.google.dev/gemini-api/docs/long-context#long-context-limitations).

`countTokens` aceita o `generateContentRequest`, incluindo instruções e declarações de ferramentas.
Esse caminho é diferente de contar só `contents`. A contagem representa a entrada conhecida, sem
prever a saída do modelo ou os futuros resultados de tools. Recontar o request efetivo antes de cada
chamada, inclusive após ferramentas, permanece necessário.
[Gemini countTokens](https://ai.google.dev/api/tokens#method:-models.counttokens).

Na metadata Google, `promptTokenCount` inclui `cachedContentTokenCount`. Cache é uma parte do input.
Tokens de raciocínio e da resposta também têm campos próprios. Preservar os totais do provider e seus
detalhes evita somar subconjuntos novamente. [UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata).
No AI SDK 7, `result.usage` agrega etapas e `finalStep.usage` representa a última etapa. O callback
`onLanguageModelCallEnd` fornece uso por chamada antes das tools do cliente. Uma execução separada
de fallback precisa entrar no ledger. Exceções lançadas pelo callback são capturadas pelo SDK, então
esse callback sozinho não impõe um orçamento rígido. [AI SDK generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).

O provider Google aceita `providerOptions.google.cachedContent` com o nome do recurso remoto.
Expõe `thinkingLevel` para Gemini 3 e posteriores, e `thinkingBudget` para a série 2.5. Verificar
suporte do modelo antes de enviar essas opções. [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google).
`thinkingLevel: high` pode aumentar a latência. O limite de saída inclui o raciocínio; se ele consumir
o orçamento, a resposta pode ser vazia ou incompleta. Medir precisão e recall antes de mudar o nível.
[Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

O cache implícito não garante hit nem economia. Prefixos comuns estáveis favorecem o reaproveitamento.
O cache explícito de `generateContent` permite TTL e cobra leitura e armazenamento. Tokens em cache
continuam dentro da janela e dos limites normais da geração. Verificar a elegibilidade e o mínimo de
tokens do modelo antes de criar um recurso.
[Gemini context caching](https://ai.google.dev/gemini-api/docs/generate-content/caching).
O recurso explícito mantém modelo, conteúdo, instruções e configuração de tools imutáveis. Mudar
qualquer um deles exige outra identidade de cache. Um novo SHA pode reusar bytes idênticos, mas a
proveniência da revisão atual precisa permanecer explícita. Para manter a escolha do AI SDK, criar
esse recurso por um adaptador HTTP validado, sem reintroduzir o SDK Google.
[CachedContent API](https://ai.google.dev/api/caching#CachedContent).

A economia depende do modelo, dos tokens reutilizados e do tempo de armazenamento. O piloto deve
comparar custo sem cache com criação, armazenamento, leituras em cache e tokens variáveis. Não usar
um percentual universal de desconto. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
Quotas RPM, TPM de entrada e RPD pertencem ao projeto, não à API key. Aumentar workers ou criar
outra chave não aumenta a quota do projeto. Consultar os limites ativos e incluir as tentativas
falhas na admissão de trabalho. [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Effect 4 como padrão de execução

Estas aplicações são propostas para o Codekeat, baseadas nos contratos da biblioteca. Não justificam
substituir funções puras por Effects nem migrar construtores que já resolvem a injeção de dependências.

| Problema concreto                                          | Aplicação proposta                                                                                              | Contrato e limite                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Leituras simultâneas da mesma fonte imutável               | `Cache` compartilhado para o lookup, com chave que inclua instalação, repositório, SHA, path e versão do parser | Lookups concorrentes da mesma chave compartilham o trabalho. O cache tem capacidade e TTL; também conserva falhas. Definir TTL de falha ou invalidação, sem conservar indisponibilidade transitória como ausência permanente. A capacidade por entradas não limita bytes. [Effect Cache](https://effect.website/docs/v4/caching/cache).                                              |
| Arquivos independentes aguardando HTTP                     | `Effect.forEach` com concorrência pequena e explícita; orçamento compartilhado por instalação                   | Concorrência numérica limita operações em voo. A política padrão encerra o grupo na primeira falha. Estados esperados `missing` e `unavailable` precisam continuar resultados explícitos quando o contrato permite prosseguir. [Basic concurrency](https://effect.website/docs/v4/concurrency/basic-concurrency), [Semaphore](https://effect.website/docs/v4/concurrency/semaphore). |
| Ingestão maior que a memória do processo                   | `Stream` para buscar, validar e gravar artefatos incrementalmente, com `mapEffect` e buffers limitados          | Streams permitem consumo sob demanda. Coletar tudo com `runCollect`, ou reter todo conteúdo em um `Map`, volta a crescer com o volume total. Buffer limitado e controle de todos os estágios são necessários para limitar memória. [Stream operations](https://effect.website/docs/v4/stream/operations).                                                                            |
| Clientes, caches e workers com ciclo de vida compartilhado | `Context.Service` e `Layer` no bootstrap quando esses recursos precisarem de escopo e shutdown                  | Layers constroem o grafo de dependências. Na API v4, `Effect.provide` compartilha layers por padrão e `{ local: true }` força reconstrução. Reusar a instância de Layer evita aquisição duplicada. [Managing layers](https://effect.website/docs/v4/requirements-management/layers), [Effect.provide](https://effect.website/docs/v4/api/effect/Effect#provide).                     |
| Erros transitórios e rate limits                           | `Schedule` limitado, com backoff, espera de `Retry-After` e prazo total do Effect                               | Um schedule decide se outra tentativa começa. Ele não interrompe uma tentativa que já está pendente. Retry precisa de um dono único e só cabe em operações seguras para repetir. [Schedule cookbook](https://effect.website/docs/v4/scheduling/cookbook).                                                                                                                            |

A página introdutória de memoização de Layers ainda contém uma descrição diferente de `provide`
local. Para Effect 4.0.2, a API v4 acima coincide com a fonte instalada e com a
[migração oficial de memoização](https://github.com/Effect-TS/effect/blob/main/migration/layer-memoization.md).
Não transportar essa regra da versão 3 para a versão 4.

`Schedule` e fibers organizam trabalho enquanto o runtime existe. Eles não tornam a fila persistente
nem recuperam jobs interrompidos por reinício. Essa garantia requer armazenamento de checkpoints e
reclamação do trabalho pendente. [Using schedules](https://effect.website/docs/v4/scheduling/using-schedules).

## Pacote mínimo recomendado para a próxima implementação

Começar por operações que preservam conteúdo e alteram apenas trabalho repetido ou tempo de espera.
Cada item precisa de medição antes e depois com o mesmo PR, modelo e configuração.

1. Preparar uma vez por input o índice de paths, relações e manifesto. Reusar esse índice em todos
   os prompts e lotes do juiz. Evitar refazer o grafo ou serializar fontes idênticas em cada decisão.
   Confirmar que o conjunto de evidências e os bytes das fontes permanecem iguais.
2. Buscar arquivos independentes com concorrência limitada. Começar com quatro leituras como
   hipótese de configuração, não como número ótimo. Compartilhar o limite entre runs da instalação,
   preservar ordem determinística e propagar cancelamento. Medir espera, requests, rate limits e RSS.
3. Reusar leituras imutáveis e contagens de requests idênticos. A chave da contagem deve representar
   modelo, request completo, ferramentas, parâmetros e versão de serialização. Cache não concede
   acesso: verificar a autorização atual antes de entregar um artefato, mesmo em um hit. Começar
   com deduplicação por run; ampliar para cache entre runs quando os hits medidos justificarem.
4. Registrar duração de carregamento, preparação, contagem, geração, ferramentas e juiz. Registrar
   bytes, tokens, cache read, chamadas, retries e consumo conhecido em falhas. Não registrar corpos
   do código nem respostas privadas em logs. As métricas atuais de custo e uso são a base, mas não
   isolam todos esses estágios.

Caches de metadata e deduplicação de consultas MCP já existem. A implementação seguinte deve
aproveitar esses donos, em vez de criar caches sobrepostos. Cache explícito do Gemini deve entrar
como um piloto separado depois de medir prefixos repetidos e seu ponto de equilíbrio financeiro.

## Arquitetura para fontes maiores que a janela

A ingestão e a análise precisam ter ciclos de vida distintos. Um armazenamento de artefatos conserva
os originais completos. Os prompts recebem unidades pertinentes, com referências para recuperar
mais evidência. A arquitetura proposta segue esta ordem:

1. Ingerir e validar fontes no SHA exato. Cada artefato conserva origem autorizada, revisão, path,
   hash, tamanho, estado e versão de extração. Conteúdo repetido pode compartilhar armazenamento,
   mas conserva todas as referências de origem e suas permissões.
2. Indexar declarações, imports, chamadores, testes e contratos entre repositórios. Combinar relações
   estruturais com pesquisa textual. Um ranking semântico ajuda a localizar fontes, mas não prova
   ausência de validações, chamadas indiretas ou bugs fora do resultado recuperado.
3. Particionar a mudança por unidades de código e invariantes afetados. Conservar hunks e
   declarações completos quando couberem, incluindo os chamadores necessários. Um arquivo ou
   componente muito grande pode precisar de várias janelas e uma análise posterior das relações.
   Não cortar caracteres para fazer uma unidade caber.
4. Manter um registro de cobertura das linhas e contratos alterados. Cada unidade fica pendente,
   analisada ou bloqueada por evidência indisponível. Uma etapa posterior verifica relações entre
   unidades e deduplica candidatos pelo mecanismo do bug, sem apagar a proveniência.
5. Reabrir as fontes originais para julgar cada candidato. Resumos e conclusões de outros agentes
   localizam evidências, mas não substituem o código que demonstra a falha. Uma publicação concluída
   exige cobertura e julgamento completos dentro do contrato escolhido.

Workers paralelos podem atender unidades independentes. Um worker por arquivo, sem análise dos
contratos que os conectam, pode perder regressões entre produtor e consumidor. A proposta exige
orçamento de tokens por projeto, justiça entre instalações e evidências compartilhadas por referência,
em vez de duplicar todos os originais em cada worker.

Adotar artefatos em disco e `Stream` quando RSS, tamanho de fonte ou duplicação de prompts mostrar
que manter todo o run em memória custa demais. Adotar checkpoints e uma fila durável quando houver
runs que precisem sobreviver a reinícios ou ultrapassar o prazo atual. Enquanto SQLite for o banco,
manter a restrição de uma réplica da API. Workers distribuídos exigem outro contrato de persistência,
claims e idempotência, além da troca da biblioteca de fila.

## Critérios de qualidade e adoção

O conjunto de avaliação precisa conter bugs confirmados, mudanças intencionais e falsos positivos
conhecidos da Takeat. Incluir validadores em outros arquivos, consumidores em outro repositório,
forks, renames, acessos revogados e diffs que excedam o transporte ou a janela. Fixar revisões, modelos,
prompts e parâmetros para comparar estratégias nas mesmas mudanças.

Medir precisão dos findings publicados, recall dos bugs rotulados, severidade correta e evidências
que realmente sustentam o cenário. Medir também cobertura, tokens por estágio, custo conhecido de
tentativas falhas, RSS, tempo de fila e duração p50 e p95 por faixa de tamanho. Registrar cache frio e
quente separadamente. A aprovação do juiz permanece um sinal operacional, sem substituir o rótulo
humano.

As otimizações de cache, índices e HTTP precisam preservar o contexto recuperado. Janelas semânticas,
mais paralelismo de modelos e ajustes de thinking exigem uma comparação de qualidade própria. Uma
amostra finita pode revelar regressões e sustentar rollout controlado; não prova ausência absoluta de
perda de qualidade em todo PR futuro. Nenhuma meta numérica de latência, economia ou redução de
falsos positivos nesta proposta foi medida em produção.

## Decisão da rodada anterior

Foram comparados dois desenhos. O primeiro distribui todo o diff entre unidades de trabalho com
cobertura e checkpoints, amortizando chamadas e permitindo retomada. O segundo cria um catálogo de
fontes no SHA exato e recupera evidências sob demanda, para que fontes maiores que a janela continuem
acessíveis ao gerador e ao juiz. Eles podem compartilhar ingestão, caches e unidades de cobertura.

A rodada adota primeiro as otimizações que preservam conteúdo: concorrência HTTP limitada,
deduplicação por carregamento, índice e manifesto reutilizados por snapshot, e cache da contagem do
request real. O processor também registra duração e resultado de carregamento, geração e juiz.
Nenhuma dessas mudanças substitui código por resumo ou faz um pacote incompleto parecer completo.

A hipótese de que fontes recuperáveis garantem a mesma qualidade foi rejeitada. Disponibilidade não
prova que o agente buscará a evidência necessária. Alterar pinning, agrupar diffs ou adicionar agentes
exige comparar bugs confirmados e falsos positivos nas mesmas revisões. A mesma cautela vale para
reduzir thinking ou substituir o código por resumos. Esses desenhos permanecem como evolução
estrutural, com cobertura e retomada antes de prometer suporte a volumes acima do prazo atual.

A verificação de quantidade de paths recebidos contra `changed_files` agora rejeita diffs vazios ou
com blocos ausentes antes da coleta de contexto. Ela não valida todas as linhas de cada bloco nem
remove os limites externos. O caminho com objetos Git continua sendo uma proposta que exige
armazenamento, suporte a forks e orçamento de recursos.

| Medição local                                                 | Antes                  | Depois               | Escopo da conclusão                                                             |
| ------------------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------------------- |
| Preparação de 50 prompts com 1.000 fontes conectadas          | 768 ms                 | 69 ms                | Índice reutilizado; hashes de todos os prompts iguais. Sem rede ou inferência.  |
| 100 arquivos, código compilado aquecido, RTT simulado de 5 ms | 545,32 ms              | 161,20 ms            | Mesmas 104 requisições; concorrência de 1 para 4 e todas as fontes conservadas. |
| 20 requests serializados idênticos                            | 20 contagens de tokens | 1 contagem de tokens | Gerações continuam independentes; não representa desconto de tokens faturados.  |

Os benchmarks usam fixtures sintéticas e não são metas de produção. Avaliar p50/p95 de rede e
inferência, custo confirmado e qualidade humana continua necessário antes de escolher o próximo
contrato de seleção e distribuição de trabalho.

A verificação integrada desta rodada passou em `pnpm check && pnpm typecheck && pnpm test && pnpm build`: 235 testes da API e 11 da web. Oito suites focadas passaram com 123 testes. Nove regressões falharam no baseline anterior pelas condições esperadas e passaram após restaurar a implementação. Esses checks não usaram inferência paga nem rótulos de qualidade de produção.

## Implementação de catálogo, unidades e limites compartilhados

A evolução seguinte implementa os pontos 2 a 6. O catálogo usa objetos Git no head e no merge-base
exatos, com persistência privada dos originais e ferramentas paginadas para gerador e juiz. Unidades
persistidas agrupam diffs relacionados, subdividem trabalho quando a capacidade exige e validam a
cobertura antes da conclusão. Checkpoints e recibos de uso permitem retomar após interrupções.

A API compartilha a admissão de chamadas reais do modelo entre gerador e juiz. Os padrões são duas
unidades por review e cinco chamadas do modelo simultâneas no processo. Limites locais opcionais de
requisições e tokens de entrada por minuto restringem cada modelo. Esses valores não inferem a quota
contratada do Google. A espera por admissão permanece cancelável pela fatia de execução de trinta
minutos, que devolve trabalho pendente à fila. Cada chamada HTTP admitida, incluindo seu corpo de
resposta, tem prazo de cinco minutos.

A telemetria privada registra fases e operações, requisições, tokens conhecidos, cache, capacidade,
volumes e RSS do processo. As consultas agregam no SQLite e expõem p50/p95 por período e faixa de
tamanho do diff. RSS compartilhado não representa memória exclusiva de um PR. Durações de fase e
de operações se sobrepõem e não devem ser somadas.

Um ensaio local do código compilado usou vinte operações com latência simulada de 20 ms, 500 tokens
por operação e orçamento de vinte chamadas e 10.000 tokens. Todas as configurações completaram as
mesmas operações e respeitaram o limite de concorrência.

| Concorrência configurada | Pico observado | Tempo total |
| ------------------------ | -------------- | ----------- |
| 1                        | 1              | 409,35 ms   |
| 2                        | 2              | 204,03 ms   |
| 4                        | 4              | 101,81 ms   |
| 5                        | 5              | 81,15 ms    |

Esse ensaio mede o controle de admissão com latência sintética. Ele não mede inferência, economia de
tokens ou qualidade de findings. A avaliação humana nas mesmas revisões e o acompanhamento de
latência e custo em produção continuam necessários para escolher novos padrões. Fontes integrais
ficam disponíveis, mas sua disponibilidade não comprova que toda evidência relevante foi consultada.
Limites das APIs, da janela do modelo e de rodadas de ferramentas continuam explícitos.

A verificação integrada dessa implementação passou em lint, formatação, typechecks, testes e builds:
272 testes da API e quinze da web. A validação dos ambientes e do Docker Compose também passou.
A revisão final encontrou ausência de uso/preparação na telemetria e um timeout que incluía a espera
por quota. Quatro casos falharam pelas condições esperadas antes dos reparos; a execução integrada
posterior confirmou os comportamentos corrigidos. O teste de fatia expirada também confirma retorno
à fila, cancelamento de I/O e reutilização das unidades concluídas.
