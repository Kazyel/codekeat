# Comparar estratégias de review com fontes congeladas

Use o avaliador para comparar versões do Codekeat sem publicar comentários no GitHub. Cada execução
cria novos IDs, registra a revisão do código e mantém o corpus separado dos labels humanos.

## Preparar o corpus

1. Copie `apps/api/src/features/review/evaluation/fixtures/usage-contract.manifest.json` para um
   diretório privado. O exemplo contém dois snapshots pequenos de uma alteração de cálculo de uso.
2. Substitua o modelo e os preços por um snapshot do catálogo usado no experimento. Os preços do
   exemplo são dados demonstrativos; o avaliador não consulta preços atuais.
3. Para cada caso, registre o título, a descrição, o diff, as linhas adicionadas e as fontes completas
   antes/depois. Use `headSha` nas fontes `head` e `mergeBaseSha` nas fontes `before`.
   `baseSha` identifica a ponta da branch alvo; `mergeBaseSha` identifica o ancestral usado no diff.
4. Calcule `contentHash` como `sha256:` seguido do SHA-256 dos bytes UTF-8 de `content`. Preserve o
   conteúdo completo. O loader rejeita hashes alterados, revisões divergentes e identidades repetidas.
   Ele também verifica os caminhos e as linhas adicionadas de cada diff, os tamanhos dos hunks e seu
   conteúdo contra as fontes completas em `head`/`before`. Renames usam os caminhos antigo e novo;
   arquivos criados/removidos usam `/dev/null` no lado ausente. Chunks divididos preservam posições
   absolutas nos snapshots. Preserve `\r` das fontes CRLF nos conteúdos das linhas do diff.
5. Mantenha os defeitos esperados e as classificações humanas em outro arquivo. Nunca inclua esses
   labels no título, na descrição ou nos arquivos fornecidos ao agente.

O exemplo inclui um defeito que zera cobranças quando todo o input está em cache e um controle
negativo que retorna zero para uso vazio. Os nomes dos casos e a descrição enviada ao agente são
neutros. O arquivo `usage-contract.labels.template.json` contém o gabarito separado.

## Executar inferências

Este comando faz chamadas pagas ao provider. Execute em um checkout limpo da versão que pretende
avaliar. A chave `GOOGLE_API_KEY` deve estar no ambiente ou em `apps/api/.env`.

```sh
pnpm --filter @codekeat/api exec tsx --env-file=.env \
  src/features/review/evaluation/review-evaluation.cli.ts \
  run /diretorio/privado/corpus.json /diretorio/privado/resultados-a.json
```

O comando usa o Gemini reviewer e o juiz reais, com o controle de capacidade e admissão existente.
`REVIEW_MODEL_CONCURRENCY`, `GOOGLE_REQUESTS_PER_MINUTE` e `GOOGLE_INPUT_TOKENS_PER_MINUTE` controlam
as chamadas locais. `concurrency` no manifest limita os casos simultâneos; `caseDeadlineMs` limita
cada investigação e cancela seu I/O.

O corpus usa um único nome de repositório por caso. Para preservar contexto de forks ou fontes de
outros repositórios, registre a origem nos documentos; este formato não representa árvores de
vários repositórios com identidades independentes.

O avaliador desativa o MCP remoto e usa a conta `evaluation`, para manter as fontes congeladas.
Inclua contratos de outros repositórios no corpus quando forem necessários. Experimentos que dependem
de ferramentas MCP ao vivo precisam de outro corpus e não são equivalentes a essa avaliação.

Os arquivos de resultado têm permissão `0600`. O comando recusa sobrescrever um resultado existente,
arquiva o manifest em `<output>.manifest.json` e preserva capturas em `<output>.artifacts`.
O resultado é atualizado atomicamente conforme os casos terminam. SIGINT/SIGTERM cancela as chamadas
em andamento e registra os recibos já recebidos no checkpoint. Casos ainda pendentes continuam
explícitos no arquivo. Uma interrupção brusca do processo pode deixar o último checkpoint em estado
`running`; esse estado é incompleto.

O resultado conserva as conclusões, os cenários examinados, as trocas das ferramentas, os tokens, o
custo conhecido e as métricas por caso. Sem metadata válida, o uso permanece desconhecido.
Uma resposta antiga sem conclusão verificável recebe estado `incomplete`.

## Classificar findings e calcular métricas offline

1. Copie o template de labels. Para um corpus próprio, crie uma entrada por caso com os defeitos
   conhecidos, seus IDs, caminhos e intervalos de linhas.
2. Copie `corpusHash` do resultado para o arquivo de labels.
3. Classifique cada finding pelo `runId` e pelo índice no array `findings`.
4. Use `true_positive`, `false_positive` ou `unknown`. Para um finding que corresponde a um defeito
   conhecido, informe também `defectId`; os demais usam `null`.

Exemplo de classificação humana:

```json
{
	"runId": "00000000-0000-4000-8000-000000000001",
	"findingIndex": 0,
	"verdict": "true_positive",
	"defectId": "cached-and-output"
}
```

Execute o score sem carregar a configuração do provider:

```sh
pnpm --filter @codekeat/api exec tsx \
  src/features/review/evaluation/review-evaluation.cli.ts \
  score /diretorio/privado/resultados-a.json /diretorio/privado/labels-a.json \
  /diretorio/privado/score-a.json
```

Esse comando não faz inferências. Casos sem requisição ao modelo não contam como uso desconhecido.
Uma requisição de geração/julgamento com metadata ausente mantém esse custo desconhecido. O score considera a precisão somente entre findings classificados
como verdadeiros ou falsos positivos. Findings sem classificação, inclusive `unknown`, permanecem
fora desse denominador. A aprovação do juiz não produz um label humano.

O recall usa os defeitos conhecidos de todos os casos, incluindo os incompletos. Um defeito só conta
como encontrado depois de uma correspondência humana válida com caminho e intervalo de linhas.
Sem defeitos conhecidos, recall é `null`; sem findings classificados, precisão é `null`.
Um corpus divergente, um label duplicado ou uma correspondência fora do intervalo produz erro.

## Repetir a comparação

1. Execute o mesmo manifest em cada revisão limpa do código, com nomes de output diferentes.
2. Verifique `corpusHash`, modelo, preços, `concurrency` e `caseDeadlineMs` antes de comparar.
3. Classifique os findings de cada execução separadamente. Os IDs de run sempre mudam.
4. Compare precisão, recall, casos incompletos, duração p50/p95, chamadas, tokens, cache e custo
   conhecido. Examine também `unknownUsageCases`, porque o custo parcial não representa o total.
   `requestCount` conta requisições efetivas de geração/julgamento, incluindo falhas e respostas sem
   metadata de uso. `knownUsageSteps` conta apenas etapas com recibo válido de tokens; ele pode ser
   menor que `requestCount`. Contagem de tokens e preflight não entram em `requestCount`.
   `measuredCases` é a população de p50/p95; casos `pending` ou `running` não entram nas durações.
   `reasoningTokens` soma o raciocínio conhecido nas requisições de geração e julgamento.
   `knownReasoningSteps` informa quantas requisições forneceram essa medida. Sem medidas conhecidas,
   `reasoningTokens` é `null`; registros antigos não se convertem em zero. Quando houver medidas
   parciais, a soma representa apenas as requisições conhecidas. Esses tokens já integram
   `outputTokens` e o custo de saída, portanto não os some novamente ao calcular o total.
5. Repita as rodadas mantendo a mesma política. Introduza uma melhoria por comparação.

O código e a estratégia registrados vêm da execução real; o manifest não escolhe um nome de
estratégia. Para estabelecer uma baseline de outra implementação, execute o harness nessa revisão
com os mesmos snapshots. Preserve exemplos de módulos diferentes e uma parcela de casos que não
orientou os ajustes do prompt. O par demonstrativo sozinho não comprova uma melhoria geral.

Para comparar a estratégia `evidence-investigation-v9` com a baseline, mantenha também as mesmas
configurações de admissão e o mesmo provider. Use outputs separados em cada rodada e os labels
externos correspondentes aos findings daquela execução. Examine os pacotes iniciais por hunk,
as lacunas de comparação anterior, o escopo das buscas e os candidatos escalados pelo juiz.
Esses registros ajudam a explicar diferenças de custo e duração sem tratar menos chamadas como
prova de qualidade. Precisão, recall e investigações incompletas continuam sendo medidas distintas.
O resultado de uma rodada não estabelece ganho de latência ou qualidade para outros repositórios.

Os [contratos de contexto da v9](effect.md#contratos-de-contexto-e-otimização-da-estratégia-v9)
descrevem a coleta inicial, o julgamento focal, a preservação dos artefatos completos e a política
de raciocínio. O corpus precisa incluir controles negativos e defeitos em contratos distintos
para avaliar essas mudanças. Os labels humanos permanecem fora de todo contexto enviado ao agente.
