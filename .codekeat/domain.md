# Domínio do Codekeat

O Codekeat mantém o estado das reviews. GitHub permanece a fonte de verdade dos pull requests e commits.
O [mapa de contextos](../CONTEXT-MAP.md) separa Review, Repository Policy, GitHub Integration e Dashboard Identity.

## Vocabulário

- Review Run: execução para um repositório, número de PR e SHA específico.
- Review Input: título, descrição, revisões, contexto do repositório e chunks usados na análise.
- Review Chunk: trecho reportável do diff com suas linhas adicionadas e contexto adjacente.
- Finding: candidato acionável com severidade, caminho, linha adicionada, título e justificativa.
- Review Report: comentário consultivo mais recente do Codekeat para um PR.
- Repository Policy: configuração validada do repositório, independente dos documentos de contexto.

## Invariantes de execução

Runs passam de `queued` para `running` e terminam como `completed`, `failed` ou `ignored`.
A reivindicação de um run evita processá-lo novamente. Repositório, número do PR e SHA identificam
uma execução e impedem duplicatas para o mesmo commit.

Se o PR estiver fechado, em draft ou com outro SHA, a execução é ignorada. A base também precisa
permanecer estável durante a busca do diff. Instalações e repositórios
precisam permanecer ativos. Veja [GitHubReviewInputService](../apps/api/src/features/github/services/github-review-input.service.ts)
e [ReviewRunProcessorService](../apps/api/src/features/review/services/review-run-processor.service.ts).

## Invariantes dos resultados

Findings só podem apontar para linhas adicionadas do chunk analisado. Contexto adjacente, documentos
e consultas MCP ajudam a julgar um candidato, mas não criam localizações reportáveis.

O juiz avalia cada candidato uma vez. `approved` mantém a severidade, `severity_changed` publica a
severidade corrigida e `rejected` conserva o candidato para auditoria sem publicá-lo no comentário.
Respostas inválidas do modelo e falhas de julgamento encerram o run sem publicar findings parciais.

O Review Report é único por repositório e PR. A publicação atualiza o comentário existente em vez de
criar um comentário a cada execução. O produto nunca bloqueia merge nem emite aprovação do PR.

As [métricas de qualidade](../docs/roadmap/review-efficiency-intelligence.md) medem concordância do juiz,
volume, tokens, custo e duração. Elas não medem precisão ou recall sem classificação humana.

## Política e contexto

`.codekeat.yml` vem da branch padrão e aceita `version: 1` e `enabled`. Arquivo ausente usa o default.
Arquivo inválido usa o default e registra `invalid_repository_policy`. Veja o
[contrato de Repository Policy](../apps/api/src/features/repository-policy/types/repository-policy.types.ts).

Os documentos `.codekeat/` e o código do contexto vêm do SHA do head. Ausência, indisponibilidade e
truncamento são estados explícitos. Uma referência sem revisão confirmada não comprova o código do PR.
