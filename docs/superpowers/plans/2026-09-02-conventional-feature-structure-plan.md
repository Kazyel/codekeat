# Plano de implementação da organização convencional das features

## Referência

Implementa `docs/superpowers/specs/2026-09-02-conventional-feature-structure-design.md` sem alterar comportamento, endpoints, schemas persistidos ou integrações.

## Restrições

- Manter as alterações existentes do usuário.
- Não criar aliases temporários, wrappers ou duas estruturas paralelas.
- Usar `index.ts` como entrada pública dos módulos.
- Manter imports relativos dentro do mesmo módulo.
- Usar aliases `#` somente entre módulos.
- Remover interfaces com uma única implementação interna.
- Preservar interfaces em bordas substituídas por integrações ou testes.
- Não alterar migrations nem schemas Drizzle.
- Não criar commit.

## Fase 1: aliases e código compartilhado

### Arquivos

- Alterar `apps/api/package.json`.
- Alterar `apps/api/tsconfig.json`.
- Alterar `apps/api/vitest.config.ts`.
- Criar `apps/api/src/shared/http/constants/http-status.constants.ts`.
- Criar `apps/api/src/shared/http/utils/authorization.util.ts`.
- Criar `apps/api/src/shared/http/utils/json-response.util.ts`.
- Criar `apps/api/src/shared/http/index.ts`.
- Criar `apps/api/src/shared/database/utils/current-timestamp.util.ts`.
- Criar `apps/api/src/shared/database/index.ts`.

### Passos

1. Adicionar em `package.json#imports` os destinos compilados:
    - `#features/auth`
    - `#features/github`
    - `#features/repository-policy`
    - `#features/review`
    - `#core/workflows/*`
    - `#integrations/gemini`
    - `#integrations/takeat-mcp`
    - `#shared/http`
    - `#shared/database`
2. Configurar os mesmos aliases em `tsconfig.json` para os arquivos em `src`.
3. Espelhar os aliases em `vitest.config.ts` com caminhos absolutos derivados de `import.meta.url`.
4. Extrair `sendJson` dos controllers de Auth e Review para `shared/http`.
5. Extrair a validação timing-safe do bearer token para `shared/http`.
6. Mover os status HTTP usados por mais de um controller para constants compartilhadas.
7. Extrair `currentTimestamp` dos repositories para `shared/database`.
8. Exportar somente essas funções e constants nos `index.ts` compartilhados.

### Verificação

```text
pnpm --filter @codekeat/api typecheck
pnpm --filter @codekeat/api exec vitest run tests/dashboard-auth-api.test.ts tests/read-api.test.ts
pnpm exec oxlint apps/api/src/shared apps/api/src/features
```

## Fase 2: repositories concretos

### Auth

- Criar `features/auth/repositories/dashboard-auth.repository.ts` a partir de `DrizzleDashboardAuthStore`.
- Criar `features/auth/types/dashboard-auth.types.ts` com usuários, credenciais, sessão e role.
- Remover `DashboardAuthStore`.
- Alterar o service de autenticação para receber `DashboardAuthRepository`.

### GitHub

- Criar `features/github/repositories/github-access.repository.ts` com instalações e repositórios.
- Criar `features/github/repositories/webhook-delivery.repository.ts` com claim, retry e estados da entrega.
- Distribuir DTOs e unions em:
    - `features/github/types/github-access.types.ts`
    - `features/github/types/webhook-delivery.types.ts`
    - `features/github/types/github-events.types.ts`
- Remover `RepositoryAccessStore`, `WebhookDeliveryStore` e `DrizzleGitHubStore`.

### Review

- Criar `features/review/repositories/review-run.repository.ts` com criação, lookup, claim, conclusão, falha, ignore e requeue.
- Manter a criação do Review Report dentro da transação de conclusão do Review Run.
- Criar `features/review/repositories/review-report.repository.ts` com preparação, claim e resultado da publicação.
- Criar `features/review/repositories/review-query.repository.ts` com lista e detalhe do dashboard.
- Distribuir entidades e DTOs em:
    - `features/review/types/review-run.types.ts`
    - `features/review/types/review-input.types.ts`
    - `features/review/types/review-report.types.ts`
    - `features/review/types/review-model.types.ts`
    - `features/review/types/review-queue.types.ts`
- Remover `ReviewRequestStore`, `ReviewRunStore`, `ReviewReportStore`, `ReviewReadStore`, `DrizzleReviewStore` e `DrizzleReviewReadStore`.

### Bootstrap e testes

1. Instanciar os novos repositories com a mesma `DatabaseConnection`.
2. Injetar as classes concretas nos services.
3. Atualizar `apps/api/tests/test-database.ts` para expor os repositories novos.
4. Migrar os testes sem alterar expectativas ou fixtures persistidas.

### Verificação

```text
pnpm --filter @codekeat/api typecheck
pnpm --filter @codekeat/api exec vitest run tests/webhook-delivery.test.ts tests/installation-state.test.ts tests/request-review.test.ts tests/review-run-processor.test.ts tests/review-report.test.ts tests/read-api.test.ts tests/dashboard-auth-api.test.ts
```

## Fase 3: services, controllers, types e constants

### Auth

Mover e renomear:

- `dashboard-authenticator.ts` para `services/dashboard-auth.service.ts`.
- `argon2-password-hasher.ts` para `services/argon2-password.service.ts`.
- `register-dashboard-auth-api.ts` para `controllers/dashboard-auth.controller.ts`.
- `dashboard-auth-constants.ts` para `constants/dashboard-auth.constants.ts`.

`DashboardAuthService` usará `Argon2PasswordService` concreto. O contrato `PasswordHasher` será removido.

### GitHub

Mover e renomear:

- `register-webhooks.ts` para `controllers/github-webhook.controller.ts`.
- `installation-handler.ts` para `controllers/github-installation.controller.ts`.
- `load-pull-request-input.ts` para `services/github-review-input.service.ts`.
- `load-repository-policy.ts` para `services/github-repository-policy.service.ts`.
- `publish-review-report.ts` para `services/github-review-publication.service.ts`.
- `webhook-delivery.ts` para `services/webhook-delivery.service.ts`.
- `webhook-events.ts` para `utils/github-webhook.util.ts` e types correspondentes.
- `github-account.ts` para `utils/github-account.util.ts`.

Mover caminhos e limites para `constants/github.constants.ts`. Remover interfaces com uma única implementação; preservar os contratos de Review Input e publicação definidos pela feature Review.

### Repository Policy

Mover:

- `repository-policy.ts` para `services/repository-policy.service.ts`.
- DTOs e unions para `types/repository-policy.types.ts`.
- schema e policy padrão para `constants/repository-policy.constants.ts` quando forem compartilhados pelo módulo.

Remover `RepositoryPolicyResolver`. O workflow receberá o service concreto de GitHub que carrega e resolve a policy.

### Review

Mover e renomear:

- `request-review.ts` para `services/request-review.service.ts`.
- `process-review-run.ts` para `services/review-run-processor.service.ts`.
- `publish-review-report.ts` para `services/review-report-publisher.service.ts`.
- `review-run-queue.ts` para `services/review-queue.service.ts`.
- `register-read-api.ts` para `controllers/review-read.controller.ts`.
- `review-report.ts` para `utils/review-report.util.ts`.
- `review-model.ts` para `errors/review-model.error.ts`.

Mover limites de chunk, severidades e outros valores estáticos para arquivos `*.constants.ts`. Preservar os contratos `ReviewModel`, Review Input, publicação e tarefas da fila em `types/`.

### Regras de nome

- Classes: `PascalCase`, com sufixo de responsabilidade quando necessário.
- Arquivos: `kebab-case` com `.controller.ts`, `.service.ts`, `.repository.ts`, `.types.ts`, `.constants.ts`, `.util.ts` ou `.error.ts`.
- Constants de módulo: `UPPER_SNAKE_CASE`.
- Variáveis locais: `camelCase`.

### Verificação

```text
pnpm --filter @codekeat/api typecheck
pnpm --filter @codekeat/api test
pnpm exec oxlint apps/api/src apps/api/tests
```

## Fase 4: integrações

### Gemini

- Mover `features/review/adapters/ai/gemini-review-model.ts` para `integrations/gemini/services/gemini-review.service.ts`.
- Mover schemas e limites estáticos para `integrations/gemini/constants/gemini.constants.ts` quando não precisarem permanecer privados ao service.
- Criar `integrations/gemini/index.ts`.
- Manter `GeminiReviewService` como implementação de `ReviewModel`.

### Takeat MCP

- Mover `infra/takeat-mcp/takeat-mcp-tool.ts` para services, types e constants em `integrations/takeat-mcp`.
- Separar somente as responsabilidades já existentes: token OAuth, conexão MCP e filtro de ferramentas.
- Não criar interfaces extras para cada classe.
- Criar `integrations/takeat-mcp/index.ts`.

### Bootstrap e testes

- Atualizar o bootstrap para importar `#integrations/gemini` e `#integrations/takeat-mcp`.
- Atualizar os testes Gemini e MCP para os aliases públicos.
- Preservar allowlist, renovação antecipada, retry de autenticação, validação Zod e mensagens de erro atuais.

### Verificação

```text
pnpm --filter @codekeat/api exec vitest run tests/gemini-review-model.test.ts tests/takeat-mcp-tool.test.ts tests/takeat-mcp-authentication.test.ts
pnpm --filter @codekeat/api typecheck
```

## Fase 5: APIs públicas, workflow e bootstrap

### Entradas públicas

- Substituir cada `public.ts` por `index.ts`.
- Exportar somente services, repository types e contratos consumidos por outro módulo.
- Não exportar controllers, repositories concretos ou utils internos, exceto quando o bootstrap precisar compô-los; nesses casos o bootstrap usa um alias público de composição ou um caminho interno explícito documentado.

### Workflow

- Manter `core/workflows/request-review-from-github.ts`.
- Migrar imports para `#features/github`, `#features/repository-policy` e `#features/review`.
- Preservar deduplicação, filtros de draft e conta, verificação da instalação e warning de policy.
- Manter features sem imports de `#core/workflows`.

### Bootstrap

- Atualizar `bootstrap/application.ts` para compor controllers, services, repositories, integrations e workflow.
- Não adicionar container de injeção, decorators, factories ou framework de DI.

### Verificação

```text
pnpm --filter @codekeat/api typecheck
pnpm --filter @codekeat/api test
```

## Fase 6: remoção e regras arquiteturais

### Remover

- Todas as pastas `adapters`.
- `infra/takeat-mcp` após a migração.
- Arquivos `public.ts`.
- Arquivos `*-store.ts` e exports correspondentes.
- Interfaces sem substituição real.
- Imports relativos que atravessem features.
- Exports temporários e arquivos vazios.

### Oxlint

Atualizar `.oxlintrc.json` para:

- manter complexidade máxima de cinco no backend;
- manter `import/no-cycle`;
- proibir imports internos entre features;
- proibir features importarem `#core/workflows/*`;
- proibir `shared` importar features, integrations ou workflows;
- proibir `integrations` importar controllers ou repositories concretos;
- aceitar somente aliases públicos entre módulos.

Exercitar a regra com um import inválido temporário e removê-lo após confirmar a falha esperada.

### Documentação

Atualizar:

- `docs/architecture.md`.
- `CONTEXT-MAP.md`.
- `docs/contexts/*/CONTEXT.md`.
- `docs/adr/0002-feature-based-contexts.md` ou criar uma ADR substituta caso a decisão anterior deixe de representar a estrutura.
- `README.md` e referências históricas com caminhos executáveis.

A documentação deve explicar categorias convencionais, aliases, `shared`, `integrations` e a permanência de `core/workflows`.

## Fase 7: revisão e verificação final

1. Procurar caminhos antigos, `adapters`, `public.ts`, stores removidos e imports internos entre features.
2. Confirmar que não existem constants de módulo em `camelCase` no código alterado.
3. Revisar correctness, simplicidade, arquitetura, segurança, performance e código morto.
4. Executar a verificação completa:

```text
pnpm check && pnpm typecheck && pnpm test && pnpm build
```

5. Corrigir qualquer falha e repetir o comando completo desde o início.

## Critérios de conclusão

- Nenhuma pasta `adapters` permanece na API.
- Nenhum arquivo de implementação fica solto na raiz de uma feature.
- Cross-feature imports usam aliases públicos `#`.
- Repositories concretos substituem stores de implementação única.
- Interfaces permanecem somente nas bordas aprovadas.
- Helpers repetidos de HTTP e banco têm um único módulo compartilhado.
- Todos os comportamentos existentes continuam cobertos e passando.
- A verificação completa do monorepo passa.
