# Mapa de contextos do Codekeat

## Contextos

- [Review](./docs/contexts/review/CONTEXT.md) — executa análises consultivas e produz Findings e Review Reports.
- [Repository Policy](./docs/contexts/repository-policy/CONTEXT.md) — define as regras aplicadas a cada Review.
- [GitHub Integration](./docs/contexts/github-integration/CONTEXT.md) — controla acesso a repositórios e traduz eventos do GitHub.
- [Dashboard Identity](./docs/contexts/dashboard-identity/CONTEXT.md) — autentica pessoas autorizadas a consultar o painel.

## Relacionamentos

- **GitHub Integration → Review**: eventos elegíveis originam solicitações de Review.
- **Review → Repository Policy**: Review resolve uma Repository Policy antes de criar um Review Run.
- **GitHub Integration → Repository Policy**: o conteúdo da policy vem da branch padrão do repositório no GitHub.
- **Dashboard Identity → Review**: o painel combina uma Dashboard Session válida com as consultas públicas de Review.

Os contextos não compartilham um modelo de domínio. `shared/http` e `shared/database` contêm apenas
funções técnicas puras usadas por mais de um módulo; não formam um shared kernel de domínio. Cada
contexto é exposto pelo `index.ts` de sua feature e relações entre contextos usam aliases `#features/*`.
