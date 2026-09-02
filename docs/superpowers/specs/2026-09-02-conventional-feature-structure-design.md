# Organização convencional das features da API

## Status

Aprovado para planejamento em 2 de setembro de 2026.

## Problema

A estrutura atual separa a API por features, mas usa `adapters`, arquivos `public.ts` e vários arquivos soltos que misturam contratos, DTOs e implementações. `sendJson`, validação de bearer token e `currentTimestamp` aparecem em mais de uma feature. Classes de persistência também acumulam responsabilidades: `DrizzleReviewStore` reúne escrita de runs, publicação de reports e consultas do dashboard, enquanto `DrizzleGitHubStore` reúne instalações, repositórios e entregas de webhook.

A nova organização deve preservar os limites entre Review, GitHub, Repository Policy e Dashboard Auth, mas usar categorias convencionais: controllers, services, repositories, types, constants, utils e errors.

## Decisões

- Manter organização feature-first.
- Remover o termo e as pastas `adapters`.
- Manter `core/workflows` para coordenação entre duas ou mais features.
- Não deixar arquivos de implementação soltos na raiz de uma feature.
- Permitir somente `index.ts` na raiz de cada módulo público.
- Manter interfaces apenas em bordas com substituição real.
- Usar repositories concretos para persistência Drizzle.
- Extrair código repetido para módulos `shared` nomeados por responsabilidade.
- Usar aliases nativos com prefixo `#` para acessar módulos públicos.
- Preservar comportamento, dados persistidos, endpoints e integrações atuais.

## Estrutura alvo

```text
apps/api/src/
  bootstrap/
  core/
    workflows/
  features/
    auth/
      controllers/
      services/
      repositories/
      types/
      constants/
      index.ts
    github/
      controllers/
      services/
      repositories/
      types/
      constants/
      utils/
      index.ts
    repository-policy/
      services/
      types/
      constants/
      index.ts
    review/
      controllers/
      services/
      repositories/
      types/
      constants/
      utils/
      errors/
      index.ts
  integrations/
    gemini/
      services/
      constants/
      index.ts
    takeat-mcp/
      services/
      types/
      constants/
      index.ts
  shared/
    http/
      utils/
      constants/
      index.ts
    database/
      utils/
      index.ts
```

Uma categoria existe somente quando contém código real. Dentro de uma feature, toda implementação pertence a uma categoria. `index.ts` expõe a API do módulo e não contém lógica.

## Responsabilidades

### Controllers

Controllers recebem entradas HTTP ou webhooks, validam o formato externo, chamam services e traduzem outcomes para respostas. Eles não consultam Drizzle nem implementam regras de Review.

- Dashboard Auth controller: criação, validação e remoção de sessão.
- Review controller: leitura da lista e dos detalhes de Review Runs.
- GitHub webhook controller: registro e tradução de eventos do Probot.
- GitHub installation controller: eventos de instalação e repositórios.

### Services

Services implementam casos de uso ou operações com SDKs externos. Um service pode coordenar repositories da própria feature e contratos públicos de outras features. Workflows continuam sendo o único lugar para coordenação multifeature de nível superior.

- Review: solicitar review, processar run, publicar report e operar a fila local.
- GitHub: carregar pull request, resolver policy pelo Octokit e publicar comentário.
- Auth: autenticar dashboard, provisionar administrador e operar Argon2.
- Repository Policy: validar YAML e aplicar o fallback padrão.

### Repositories

Repositories encapsulam Drizzle e recebem `DatabaseConnection`. Como existe uma única implementação de persistência, services usam classes concretas; não haverá uma interface paralela para cada repository.

A divisão será:

- `ReviewRunRepository`: criação, claim, conclusão, falha, ignore e requeue de Review Runs. A conclusão continuará criando o Review Report na mesma transação.
- `ReviewReportRepository`: claim e resultado da publicação de reports.
- `ReviewQueryRepository`: consultas do dashboard.
- `GitHubAccessRepository`: instalações e repositórios conectados.
- `WebhookDeliveryRepository`: deduplicação e estado de entregas.
- `DashboardAuthRepository`: usuários e sessões do dashboard.

### Types

Arquivos `*.types.ts` contêm somente DTOs, unions, tipos de domínio e contratos que realmente variam. Tipos serão agrupados por assunto, não em um único arquivo genérico.

Contratos preservados incluem:

- `ReviewModel`, implementado pela integração Gemini e substituído em testes.
- Carregamento de Review Input, usado pelo processador e pela integração GitHub.
- Publicação de Review Report, usada pelo service de Review e pela integração GitHub.
- Contratos de tarefas da fila, necessários para separar processamento e agendamento.

Interfaces de store, `RepositoryPolicyResolver` e `PasswordHasher` serão removidas porque possuem uma única implementação interna.

### Constants, utils e errors

- Constants usam `UPPER_SNAKE_CASE` e ficam em arquivos `*.constants.ts`.
- Utils são funções puras sem acesso a rede, banco ou estado global.
- Errors contêm erros tipados que atravessam services.
- Não haverá `src/utils`, `shared/utils.ts` ou outra pasta genérica sem responsabilidade definida.

## Código compartilhado

`shared/http` centraliza:

- escrita de respostas JSON;
- validação timing-safe do bearer token interno;
- status HTTP nomeados.

`shared/database` centraliza a criação do timestamp ISO usado pelos repositories.

Nenhum helper entra em `shared` antes de ter pelo menos dois consumidores reais.

## Integrações

Gemini e Takeat MCP deixam `features/review/adapters` e `infra`. Ambos passam para `integrations` porque encapsulam serviços externos consumidos pelo Review.

- `integrations/gemini` implementa `ReviewModel`, monta o prompt e valida a resposta do modelo.
- `integrations/takeat-mcp` gerencia OAuth, conexão MCP, allowlist de ferramentas e renovação de token.

A feature GitHub continua como feature porque também possui estado, eventos e regras de acesso próprias; ela não é apenas um cliente externo.

## Workflows

`core/workflows/request-review-from-github.ts` permanece. Ele coordena deduplicação da entrega, acesso ao repositório, Repository Policy e criação do Review Run. O workflow importa somente os `index.ts` públicos das features.

Features não importam workflows. Controllers recebem workflows pelo bootstrap quando necessário.

## Aliases e imports

Imports entre módulos públicos usam:

```text
#features/auth
#features/github
#features/repository-policy
#features/review
#core/workflows/*
#integrations/gemini
#integrations/takeat-mcp
#shared/http
#shared/database
```

Imports dentro do mesmo módulo continuam relativos. Um consumidor não importa `controllers`, `repositories` ou outro arquivo interno de uma feature.

`apps/api/package.json#imports` aponta os aliases para arquivos compilados em `dist`. `apps/api/tsconfig.json` aponta os mesmos aliases para `src` durante desenvolvimento e typecheck. O Vitest espelha os aliases em `resolve.alias`. O build não adiciona reescritor ou nova dependência.

O Oxlint continuará rejeitando ciclos e complexidade acima de cinco no backend. As regras de fronteira serão atualizadas para rejeitar imports internos entre features e imports de workflows por features.

## Fluxo preservado

```text
GitHub webhook controller
  -> core/workflows/request-review-from-github
  -> GitHub repositories + Repository Policy service
  -> Review request service
  -> Review queue service
  -> Review processing service
  -> GitHub pull-request service
  -> Gemini integration
  -> Review report repository
  -> GitHub publication service
```

O refactor não altera endpoints, schemas Zod, migrations, payloads, outcomes, transições de Review Run ou o modo consultivo do produto.

## Erros e validação

- HTTP, ambiente, GitHub, Gemini, MCP e policy continuam validados na borda.
- Outcomes esperados continuam como unions discriminadas.
- Controllers e workers capturam falhas inesperadas e mantêm os códigos atuais.
- Credenciais, diffs, prompts e respostas externas não entram em logs.
- A separação de repositories preserva as transações atuais.

## Migração

1. Configurar aliases e criar os módulos compartilhados.
2. Mover constants, types, errors e utils para suas categorias.
3. Renomear handlers para controllers e casos de uso para services.
4. Dividir repositories e atualizar o bootstrap.
5. Mover Gemini e Takeat MCP para `integrations`.
6. Migrar imports públicos para aliases e imports internos para caminhos relativos.
7. Remover `adapters`, arquivos `public.ts`, stores antigos e exports temporários.
8. Atualizar mapa de contextos, arquitetura e ADR.
9. Executar verificações focadas durante o cutover e a verificação completa ao final.

A migração não manterá wrappers, aliases antigos ou as duas estruturas em paralelo.

## Verificação

Os testes atuais devem preservar:

- autenticação e sessões do dashboard;
- deduplicação e retry de webhooks;
- estados de instalação e repositório;
- resolução e fallback da Repository Policy;
- criação, requeue e processamento de Review Runs;
- validação do Gemini e do MCP;
- publicação consultiva do Review Report;
- APIs de leitura.

Novos testes serão adicionados somente para contratos observáveis sem cobertura. A conclusão exige:

```text
pnpm check && pnpm typecheck && pnpm test && pnpm build
```
