---
status: accepted
---

# Organizar o monólito por features e contextos delimitados

A API é organizada pelas features `review`, `repository-policy`, `github` e `auth`, correspondentes aos
contextos Review, Repository Policy, GitHub Integration e Dashboard Identity. Cada feature usa somente
as categorias convencionais necessárias: `controllers`, `services`, `repositories`, `types`,
`constants`, `utils` e `errors`. Seu `index.ts` é a única API pública para outros módulos.

Imports internos ao módulo são relativos. Imports entre módulos usam `#features/*`, `#integrations/*`,
`#shared/*` ou `#core/workflows/*`; imports internos entre features são proibidos. `core/workflows`
coordena APIs públicas das features, e nenhuma feature importa workflows. `bootstrap` mantém a
composição manual.

Gemini e Takeat MCP ficam em `integrations`, separados das regras de negócio. Integrações podem
implementar contratos públicos das features, mas não dependem de controllers ou repositories concretos.
Código técnico realmente compartilhado fica em módulos nomeados por responsabilidade sob `shared`;
`shared` não conhece features, integrations ou workflows.

`packages/database` mantém conexão, migrations e schemas. As features usam repositories concretos
quando não existe substituição real; interfaces permanecem apenas nas bordas substituíveis, como
`ReviewModel`, fontes de Review Input, publicação de Review Report e fila. Outcomes esperados usam
unions discriminadas, e exceções ficam restritas a falhas inesperadas nas bordas.

A migração ocorre como um cutover único, sem aliases de compatibilidade ou arquitetura paralela. Checks
automatizados rejeitam complexidade ciclomática acima de cinco, imports que atravessem fronteiras e
dependências cíclicas. Testes cobrem outcomes e contratos observáveis, sem exigir um teste por arquivo.
