# Eficiência e inteligência dos reviews

## Objetivo

Medir a qualidade dos findings antes de otimizar custo ou volume. Cada finding candidato passa por uma segunda chamada ao modelo. O juiz recebe evidências do diff, título, descrição, contexto do repositório e consultas MCP realizadas na geração. Ele não executa ferramentas próprias e decide entre aprovação, rejeição ou correção de severidade.

Os sinais abaixo medem concordância do juiz. Eles não representam precisão ou recall porque o produto não coleta rótulos humanos.

## Estratégias

| Estratégia              | Estado no código                      | Mudança                                                                                          |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `judge-gate-v1`         | Implementada no histórico de evolução | Juiz online, fail-closed, com persistência de todos os candidatos                                |
| `adjacent-context-v2`   | Implementada no histórico de evolução | Até 4.000 caracteres de contexto do chunk anterior e posterior                                   |
| `compact-judge-v3`      | Implementada no histórico de evolução | Evidência por hunk e lotes de até 80.000 caracteres ou 50 findings                               |
| `repository-context-v4` | Implementada no histórico de evolução | Documentos e código no SHA do PR, intenção da mudança e evidências MCP compartilhadas com o juiz |

| `repository-context-v5` | Estratégia ativa | Fontes sem cortes, capacidade real, juiz adaptativo e uso conhecido conservado em falhas e retries |

A aplicação grava a estratégia em cada `review_run`. Runs históricos mantêm a estratégia nula, `judgeVerdict = not_evaluated` e seus findings publicados.

## Contrato do juiz

O processor valida e deduplica os findings antes do julgamento. Cada candidato referencia uma evidência extraída do hunk que contém sua linha. A resposta precisa cobrir todos os índices uma vez, sem índices repetidos ou fora do lote.

Na estratégia ativa `repository-context-v5`, o juiz também recebe o contexto carregado pelo GitHub e as
consultas MCP associadas ao chunk. Esses dados ajudam a avaliar alcance e impacto, mas não autorizam
findings fora das linhas adicionadas. Os lotes aceitam até 50 candidatos, sem corte de caracteres. Se a contagem real de tokens exceder
a janela, o processor divide o conjunto entre candidatos inteiros; uma evidência indivisível falha
explicitamente. Consulte [Contexto de revisão](../review-context.md) para limites e proveniência.

- `approved`: mantém a severidade e publica o finding.
- `severity_changed`: exige uma severidade diferente e publica o finding corrigido.
- `rejected`: persiste o finding para auditoria e o exclui do comentário.

Falhas de transporte encerram o run com `gemini_judge_request_failed`. Respostas inválidas encerram com `gemini_judge_invalid_response`. O processor não publica resultados parciais.

## Métricas

`GET /api/v1/review-quality` agrupa por dia, semana ou mês, repositório e estratégia.

| Campo                                     | Definição                                            |
| ----------------------------------------- | ---------------------------------------------------- |
| `judgeApprovalRateBasisPoints`            | `(approved + severity_changed) / evaluated * 10.000` |
| `acceptedFindingsPerThousandChangedLines` | Findings publicados por 1.000 linhas adicionadas     |
| `review*Tokens` e `reviewCostUsdMicros`   | Uso da geração inicial                               |
| `judge*Tokens` e `judgeCostUsdMicros`     | Uso exclusivo do juiz                                |
| `judgeCallCount`                          | Chamadas do juiz concluídas no run                   |
| `averageProcessingDurationMs`             | Média da duração total dos runs no grupo             |

A consulta agrega os findings por run antes de somar uso e custo. Um run com vários findings não multiplica seus tokens.

## Critérios de rollout

A equipe deve comparar ao menos 30 runs concluídos da mesma seleção de repositórios por estratégia.

### `adjacent-context-v2` contra `judge-gate-v1`

- queda máxima de 3 pontos percentuais na taxa de aprovação;
- nenhuma queda em findings aceitos por 1.000 linhas;
- aumento máximo de 15% no custo total por 1.000 linhas.

### `compact-judge-v3` contra `adjacent-context-v2`

- redução mínima de 25% em tokens de entrada do juiz por finding avaliado;
- redução mínima de 30% em chamadas do juiz por run;
- taxa de aprovação e taxa de correção dentro de 3 pontos percentuais;
- nenhum aumento no custo total por finding aceito.

Uma regressão reprova a estratégia. O código não mantém flag ou fallback silencioso.

### `repository-context-v4` contra `compact-judge-v3`

O ganho esperado é reduzir alegações que ignoram validadores, chamadores, consumidores ou regras do
domínio. Concordância do juiz não comprova esse ganho. A avaliação precisa de PRs com bugs confirmados
e falsos positivos classificados pela equipe.

Compare a proporção de findings confirmados, os bugs conhecidos encontrados, o custo total e a duração
nas mesmas revisões. Registre os motivos das rejeições humanas e a versão do contexto usado. Ainda não
há resultados dessa comparação neste checkout.

## Evidências

Este checkout não contém runs de produção para uma comparação de 30 runs. Portanto, ainda não há valores de rollout observados. A tabela registra apenas evidência executada neste checkout; resultados de produção devem entrar como novas linhas, com período e seleção de repositórios explícitos.

| Data       | Estratégia            | Evidência                                                 | Resultado                                                            |
| ---------- | --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-09-03 | `compact-judge-v3`    | Migração Drizzle gerada a partir do schema                | `0008_nice_avengers.sql`                                             |
| 2026-09-03 | `judge-gate-v1`       | Processor, Gemini, relatório e API de qualidade           | 30 testes focados aprovados                                          |
| 2026-09-03 | `adjacent-context-v2` | Chunker acima de 100.000 caracteres e prompts separados   | 21 testes focados aprovados                                          |
| 2026-09-03 | `adjacent-context-v2` | `pnpm check && pnpm typecheck && pnpm test && pnpm build` | 72 testes aprovados; builds da API e web concluídos                  |
| 2026-09-03 | `compact-judge-v3`    | Extração, packing e processor multi-chunk                 | 31 testes focados aprovados                                          |
| 2026-09-03 | `compact-judge-v3`    | Dashboard com run aprovado, rejeitado e corrigido         | Resumo de qualidade, custos e três estados renderizados no navegador |
| 2026-09-03 | `compact-judge-v3`    | `pnpm check && pnpm typecheck && pnpm test && pnpm build` | 79 testes aprovados; builds da API e web concluídos                  |
