# Contexto do Codekeat

Codekeat é um monorepo pnpm com uma GitHub App, uma API de reviews e um painel web. O produto analisa
pull requests e publica feedback consultivo. A decisão de merge pertence à equipe do repositório.

## Organização

- `apps/api/src/features/github`: valida eventos, controla instalações e traduz dados do GitHub para Review.
- `apps/api/src/features/review`: coordena execução, julgamento, persistência e publicação dos reviews.
- `apps/api/src/features/repository-policy`: valida a configuração `.codekeat.yml`.
- `apps/api/src/features/auth`: autentica pessoas no dashboard.
- `apps/api/src/integrations`: implementa as bordas de Gemini e Takeat MCP.
- `apps/api/src/core/workflows`: coordena as APIs públicas das features.
- `apps/api/src/bootstrap`: compõe serviços e inicia a aplicação.
- `apps/web`: apresenta histórico, resultados e métricas de reviews.
- `packages/database`: define schemas e migrations Drizzle sobre SQLite.

Cada feature expõe seu contrato pelo `index.ts`. Imports entre módulos usam os aliases públicos.
Detalhes da estrutura estão em [docs/architecture.md](../docs/architecture.md).

## Fluxo principal

Um webhook elegível cria um Review Run para um SHA. A fila local processa um run de cada vez.
O serviço GitHub carrega o PR e seu contexto. Gemini gera candidatos por chunk e o juiz avalia os
candidatos. A API persiste os julgamentos e atualiza o comentário consultivo do PR.

O processo usa uma única réplica de API enquanto SQLite for o banco. A fila não é um broker durável.
Runs pendentes de antes de um reinício não são recuperados automaticamente no bootstrap.

## Referências para investigação

- [Vocabulário e invariantes](domain.md).
- [Integrações e contratos externos](integrations.md).
- [Mapa de contextos](../CONTEXT-MAP.md).
- [Contratos de Review](../apps/api/src/features/review/types/review-input.types.ts).
- [Processamento de Review Runs](../apps/api/src/features/review/services/review-run-processor.service.ts).
- [Contexto de revisão](../docs/review-context.md).
- [Padrões de Effect na API](../docs/effect.md).
- [Métricas e limites de avaliação](../docs/roadmap/review-efficiency-intelligence.md).

Estes documentos descrevem o sistema. As regras para contribuir no repositório estão em `AGENTS.md`.
