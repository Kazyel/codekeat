# Investigação orientada por evidências nos reviews

Pesquisa em 9 de outubro de 2026. Este documento conserva as evidências e propostas anteriores à
implementação. O comportamento implementado está descrito em [review-investigation.md](../review-investigation.md)
e [review-evaluation.md](../review-evaluation.md); o ganho de qualidade ainda exige avaliação com
inferência e classificação humana. A referência local usa AI SDK 7.0.135, `@ai-sdk/google` 4.0.93 e
TypeScript 7.0.2.

## O problema observado

No experimento do PR #28, o gerador terminou sem candidatos. O juiz não recebeu trabalho. A execução
levou 106,6 segundos, consumiu 138.592 tokens de entrada acumulados em 13 etapas de geração e fez
11 consultas a ferramentas. Sete consultas percorreram páginas de uma busca literal pelo mesmo
símbolo. Esses números vieram da investigação da execução, não de um benchmark publicado.

O defeito introduzido retorna custo zero quando toda a entrada está em cache. Esse cenário ainda
pode cobrar entrada em cache e saída. O controle negativo retorna zero quando não há consumo de
entrada nem saída. Ambos precisam permanecer no conjunto de avaliação, sem entregar o gabarito ao
agente.

Os registros mostram uma investigação cara que não encontrou o caso decisivo. Não revelam todo o
raciocínio do modelo, nem provam que mais rodadas ou outro modelo corrigiriam o problema. O processo
também iniciou antes dos últimos ajustes de telemetria. Uma comparação controlada precisa fixar a
versão efetivamente carregada pela API.

## O que as fontes primárias permitem fazer

O AI SDK permite controlar a próxima etapa com `prepareStep`. A aplicação pode mudar mensagens,
ferramentas ativas e seleção obrigatória de ferramenta conforme o histórico. `stopWhen` recebe
informações das etapas e pode compor condições. Uma resposta normal também pode encerrar o loop;
um teto de etapas sozinho não obriga o agente a investigar antes de finalizar. Há suporte a loop
manual, caso os controles existentes sejam insuficientes. [AI SDK, controle de loop](https://ai-sdk.dev/docs/agents/loop-control).

A referência de `generateText` expõe informações por etapa, resultados de ferramentas, motivo de
conclusão, uso e tempos do modelo e das ferramentas. Esses sinais permitem separar espera,
recuperação de fontes e geração. A aplicação deve conferir os contratos da versão instalada antes
de usar campos novos da documentação. [AI SDK, generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).

O TypeScript descreve um serviço de linguagem com processamento sob demanda, um host responsável
por arquivos e resolução e registros compartilháveis de documentos. Isso fornece uma base para
navegação sem analisar semanticamente todos os arquivos em toda consulta. A documentação histórica
da API JavaScript não é diretamente utilizável com o pacote TypeScript 7 instalado aqui: a consulta
local a `ts.version` retornou `7.0.2`, e `typeof ts.createLanguageService` retornou `undefined`.
Uma integração por servidor de linguagem ou adapter compatível precisa de uma prova de viabilidade
separada. [TypeScript, serviço de linguagem](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API).

O LSP define referências de símbolos a partir de documento e posição. O contrato devolve locais,
com suporte a resultados parciais. A hierarquia de chamadas separa a identificação do símbolo da
consulta a chamadas recebidas e realizadas. Suporte depende das capacidades do servidor usado.
[LSP, referências](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/references.md),
[LSP, hierarquia de chamadas](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/callHierarchy.md).

O trabalho SWE-agent avalia como ferramentas e interfaces influenciam agentes de engenharia de
software. Ele justifica experimentar interfaces melhores. Seus resultados em resolução de tarefas
não demonstram precisão de um reviewer do Codekeat. [SWE-agent, artigo dos autores](https://arxiv.org/abs/2405.15793).

## Propostas para o Codekeat

### Primeiro, entregar uma unidade útil de investigação

Adicionar uma operação que recupere, para a posição alterada, a função completa no head e no before,
com tipos usados, guardas e testes próximos. Retornar as referências exatas e intervalos já
disponíveis, além das lacunas ainda abertas. Chamadores e consumidores entram por relevância, com
continuação explícita quando não couberem na resposta.

Começar com os arquivos já carregados e imports confirmados. Para símbolos exportados, preparar uma
busca reversa por referências. Uma primeira versão pode usar um índice lexical reutilizável por
snapshot. Ela precisa chamar os resultados de ocorrências, pois texto igual não prova identidade de
símbolo. O serviço de linguagem ou LSP entra depois, se a comparação mostrar ganho suficiente para
pagar preparação, dependências e memória.

Isso desloca trabalho mecânico de descoberta para o host. O modelo usa menos etapas procurando
nomes e pode gastar mais análise comparando o comportamento. O ganho permanece uma hipótese até
medirmos as mesmas revisões.

### Executar buscas em lote sem perder originais

A busca global atual expõe `scanLimit` de até 20 fontes por consulta. O prompt exige seguir o cursor
inclusive quando uma página não tem matches. Essa combinação incentivou sete chamadas do modelo
para percorrer 129 arquivos no experimento.

Preservar o cursor público, mas avançar as páginas internamente no host. Os cursores são sequenciais;
leituras independentes podem usar concorrência limitada, cancelamento e prazo. A resposta reúne
matches relevantes, fontes examinadas, custo de recuperação e um
estado explícito de completo ou parcial. Uma busca vazia parcial não significa ausência de
consumidores. Reutilizar resultados por instalação, repositório, snapshot, consulta e escopo. Detectar
loops sem avanço de cobertura, permitindo consultar novamente um resultado já disponível sem pagar
uma nova varredura.

A reprodução local da busca sobre os artefatos exatos do PR percorreu 129 arquivos de `apps/api`,
somando 645.480 bytes. As sete páginas produziram seis ocorrências em quatro arquivos, com posições
iguais às registradas no checkpoint. A leitura quente levou 34,26 ms. Isso demonstra que a travessia
local pode ocorrer no host sem sete decisões do modelo. Não mede rede, I/O frio, inferência nem
qualidade da análise.

Ordenar primeiro arquivo alterado, package próximo, importadores confirmados e testes relacionados.
Essa ordem melhora o primeiro resultado; ela não autoriza descartar outros arquivos. Fontes,
resultados completos e continuações continuam preservados no catálogo privado.

Compor a recuperação com Effect: `Cache` para compartilhar consultas em andamento e resultados,
concorrência limitada para leituras independentes e o limite compartilhado já existente para acesso
ao backend. Modelar resultados completos, parciais e indisponíveis com causas explícitas. Executar
os Effects na fronteira da ferramenta, preservando o cancelamento da review.
[Effect 4, Cache](https://effect.website/docs/v4/caching/cache).

Consolidar operações mecânicas em ferramentas úteis e avaliar suas respostas segue a orientação
de engenharia de ferramentas da Anthropic. Aplicar isso aqui é uma proposta nossa; a fonte não
mede o ganho no Codekeat. [Anthropic, ferramentas para agentes](https://www.anthropic.com/engineering/writing-tools-for-agents).

### Separar descoberta, verificação e conclusão

Manter uma lista curta de hipóteses verificáveis por unidade. Cada hipótese registra cenário,
resultado esperado, código responsável, fontes lidas e informação ausente. Ela não precisa incluir
raciocínio interno livre do modelo nem conteúdo sensível nos logs.

Para guardas e retornos antecipados alterados, pedir uma tabela pequena de entradas concretas com
predicado verdadeiro e falso, zeros, limites e combinações permitidas pelos validadores. No PR #28,
isso inclui entrada totalmente em cache com saída positiva, entrada totalmente em cache sem saída,
entrada não cacheada e consumo total zero. Essa tabela é instrumento de investigação; não transforma
cada early return em um finding.

Usar `prepareStep` para oferecer ferramentas adequadas às lacunas atuais. Uma hipótese que depende
de um chamador exige recuperar esse chamador antes da conclusão. Quando fontes disponíveis já
respondem à dúvida, concluir sem obrigar chamadas extras. Se a investigação ficar incompleta,
persistir o motivo e evitar apresentar a falta de informação como prova de ausência de defeitos.

Uma revisão sem candidatos deve registrar o que examinou e quais hipóteses refutou. Ler um intervalo
completo prova cobertura de leitura, não compreensão nem correção. O host pode validar referências
e estados, mas não deve afirmar que um checklist comprova recall.

### Criar uma auditoria adicional somente quando houver motivo

O juiz atual avalia candidatos e não descobre defeitos quando o gerador retorna vazio. Se o primeiro
piloto justificar, adicionar uma etapa distinta de descoberta para alterações com risco explícito
ou investigação incompleta. Ela recebe o diff e as fontes relevantes com tarefas específicas, sem
receber a conclusão do primeiro agente como verdade.

Exemplos de disparadores são nova guarda em cálculo financeiro, alteração de autorização ou nova
ordem de gravações. Esses sinais priorizam investigação; não justificam publicar uma suspeita.
Os novos candidatos continuam sujeitos ao juiz e ao mesmo requisito de cenário alcançável. Executar
duas análises em todos os PRs aumentaria custo antes de comprovar benefício.

## Cache e contexto entre etapas

O Google documenta cache implícito para Gemini 2.5 e posteriores e lista 4.096 tokens mínimos para
Gemini 3.8 Flash. Prefixos grandes e estáveis e chamadas próximas aumentam a chance de acerto. Não
há garantia de economia por request. [Google, cache implícito](https://ai.google.dev/gemini-api/docs/caching).

No caminho `generateContent`, cache explícito tem cobrança por tokens armazenados e duração, além
de outras cobranças, incluindo saída. Tokens cacheados também contam nos limites de entrada. O
serviço permite criar, consultar e excluir caches via REST e alterar sua expiração.
[Google, cache no generateContent](https://ai.google.dev/gemini-api/docs/generate-content/caching?hl=en).

O provider Google do AI SDK aceita `providerOptions.google.cachedContent` com o nome do recurso.
A aplicação pode manter o AI SDK para inferência e usar um adapter REST para a gestão do cache.
[AI SDK, provider Google](https://ai-sdk.dev/providers/ai-sdk-providers/google).

A proposta inicial é estabilizar instruções e contexto compartilhado no começo das mensagens e medir
cache real. Evitar remontar o prefixo com IDs ou tempos variáveis. Conservar artefatos originais fora
do prompt e usar referências para resultados de busca antigos já consolidados. A compactação deve
preservar pares válidos de chamadas e respostas, referências, conclusões verificadas e lacunas.

Cache explícito fica para uma rodada posterior, quando houver repetição suficiente. Sua chave deve
considerar instalação, repositório, revisão, modelo e versão do prompt. Validar compatibilidade entre
conteúdo cacheado, ferramentas e contagem real antes de ativar. Cache pode reduzir custo de repetir
entrada; não faz o agente encontrar o defeito.

## Experimento e ordem de entrega

1. Fixar versão da API, modelo, prompt, SHA e política de contexto. Repetir o PR #28 como baseline,
   incluindo o controle negativo, sem instruir o agente sobre o bug.
2. Introduzir recuperação em lote e trechos completos relevantes. Comparar ferramentas, tokens,
   tempo e bugs encontrados mantendo o mesmo modelo.
3. Introduzir verificação de cenários e conclusão explícita. Comparar novamente antes de combinar
   com outra mudança.
4. Avaliar descoberta adicional seletiva e cache explícito separadamente, se os resultados anteriores
   mostrarem necessidade.

Executar em modo de avaliação sem publicar comentários extras por padrão. Reutilizar fontes do
snapshot, mas manter checkpoints e resultados separados por estratégia para não reaproveitar a
resposta antiga como resultado de um novo experimento.
O fingerprint das unidades concluídas precisa mudar com a estratégia de investigação. Reenfileirar
um run elegível mantendo o fingerprint atual pode reutilizar os resultados antigos. O método atual
de reenfileiramento aceita somente runs falhos ou ignorados, não runs concluídos como o do PR #28.
O experimento precisa criar uma execução de avaliação separada; reabrir o PR não garante uma nova
análise do mesmo SHA.

O conjunto precisa incluir bugs confirmados e mudanças corretas semelhantes, de diferentes módulos.
Pessoas devem classificar findings e defeitos conhecidos encontrados. Registrar recall desses
defeitos, precisão dos findings, investigações incompletas, p50/p95 de duração, custo conhecido,
tokens cacheados, chamadas e avanços reais de cobertura por ferramenta. Aprovação do juiz continua
sendo concordância entre modelos, não precisão humana.

O PR #28 serve como regressão inicial. Uma vitória nele não comprova melhoria geral nem autoriza
prometer velocidade constante para qualquer volume de contexto.
