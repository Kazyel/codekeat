# Plano de implementação do dashboard Codekeat

## Referência

Implementa `docs/superpowers/specs/2026-09-03-codekeat-dashboard-design.md` em `apps/web`, consumindo os endpoints existentes de `apps/api` sem alterar seus contratos.

## Restrições

- Usar pnpm 10 e Node.js 24.
- Manter TanStack Start como BFF; nenhum segredo entra no bundle do browser.
- Validar ambiente, parâmetros e respostas HTTP com Zod.
- Manter autenticação e autorização na API como fronteira final.
- Não importar `@codekeat/database` no frontend.
- Não criar endpoints, métricas ou ações que a API não oferece.
- Usar componentes shadcn como código local e Magic UI apenas nos pontos aprovados.
- Limitar funções a complexidade ciclomática cinco.
- Não criar commit.

## Fase 1: workspace e fundação

### Arquivos

- Criar o workspace TanStack Start em `apps/web`.
- Criar `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, configuração do router e entradas do Start.
- Criar `apps/web/.env.example`, validação de ambiente e script `env:check`.
- Criar `apps/web/Dockerfile`.
- Atualizar `pnpm-workspace.yaml`, `turbo.json`, `compose.yaml` e `README.md` para remover resíduos de Next.js e registrar TanStack Start.

### Passos

1. Inicializar React 19, TanStack Start, Router, Query e integração SSR.
2. Configurar Tailwind CSS e aliases `@/*`.
3. Instalar Zod, TanStack Form, TanStack Table, Recharts, Lucide, Sonner e Paper Shaders com versão exata.
4. Inicializar shadcn/ui e adicionar somente componentes usados pelas telas.
5. Adicionar os componentes Magic UI Number Ticker e Border Beam como código local.
6. Configurar scripts `dev`, `build`, `start`, `typecheck`, `test`, `env:check` e verificações focadas.

### Verificação

```text
pnpm --filter @codekeat/web typecheck
pnpm --filter @codekeat/web build
pnpm env:check
pnpm docker:config
```

## Fase 2: contratos HTTP e sessão

### Arquivos

- Criar schemas dos contratos em `apps/web/src/features/*/schemas`.
- Criar `apps/web/src/lib/api.server.ts` para chamadas servidor-servidor.
- Criar `apps/web/src/features/auth/auth.server.ts` e `auth.functions.ts`.
- Criar tipos discriminados de erro HTTP e helpers de sessão.
- Criar testes de autenticação e parsing de respostas.

### Passos

1. Modelar auth, review runs, review detail, usage, quality, conexões e modelos com Zod.
2. Enviar `DASHBOARD_API_TOKEN` somente no helper server-side.
3. Gravar a sessão em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e `Path=/`.
4. Validar sessão antes de cada server function protegida.
5. Implementar logout que revoga a sessão e sempre remove o cookie local.
6. Implementar limite local de cinco falhas de login por e-mail em quinze minutos.
7. Mapear 400, 401, 403, 404, 409 e falhas de rede para resultados explícitos.

### Verificação

```text
pnpm --filter @codekeat/web exec vitest run src/features/auth
pnpm --filter @codekeat/web typecheck
```

## Fase 3: design system e shell

### Arquivos

- Criar tokens e estilos globais Review Track.
- Criar componentes shadcn locais usados pelo produto.
- Criar shell protegido, sidebar, cabeçalho mobile, breadcrumb e menu de usuário.
- Criar shader do cabeçalho, fallback CSS e preferências de movimento.
- Criar componentes compartilhados de status, métricas, skeleton, erro e vazio.

### Passos

1. Definir canvas concreto, tinta e as cores originais do ícone — vermelho `#E60216` e laranja `#FC6701` — mais cores semânticas de estado.
2. Configurar Panchang e Synonym do Fontshare, com JetBrains Mono apenas para metadados técnicos.
3. Implementar sidebar compacta no desktop e sheet no mobile.
4. Carregar uma única instância do shader mascarada pelo coelho e encerrá-la antes de cinco segundos.
5. Aplicar Border Beam somente em reviews `running`.
6. Aplicar Number Ticker somente na primeira revelação de KPIs.
7. Desligar movimento em `prefers-reduced-motion` e manter fallback sem WebGL.

### Verificação

```text
pnpm exec oxlint apps/web/src
pnpm exec oxfmt --check apps/web/src
pnpm --filter @codekeat/web typecheck
```

## Fase 4: login, visão geral e reviews

### Arquivos

- Criar rota `/login` e formulário TanStack Form.
- Criar rota protegida `/` com KPIs, gráfico e runs recentes.
- Criar `/reviews` com TanStack Table.
- Criar `/reviews/$reviewRunId` com detalhes e findings.
- Criar opções TanStack Query e server functions de review.

### Passos

1. Implementar login acessível com mensagem genérica e estado de limite.
2. Buscar runs, usage e quality em paralelo na visão geral.
3. Derivar KPIs somente de dados retornados e preservar valores indisponíveis como `null`.
4. Atualizar runs enquanto houver estado `queued` ou `running`.
5. Implementar filtros locais sobre os 50 runs retornados, informando esse limite.
6. Renderizar detalhe, códigos de erro, policy, relatório e findings sem expor payload bruto.
7. Linkar o comentário GitHub quando `githubCommentUrl` existir.

### Verificação

```text
pnpm --filter @codekeat/web exec vitest run src/features/reviews src/features/auth
pnpm --filter @codekeat/web typecheck
```

## Fase 5: analytics, conexões e modelos

### Arquivos

- Criar rota `/analytics` e gráficos Recharts.
- Criar rota `/connections`.
- Criar rota `/models`, dialogs e formulários administrativos.
- Criar server functions e query options de cada feature.

### Passos

1. Sincronizar `groupBy` e `repository` de analytics com search params validados.
2. Mostrar gráficos e tabelas equivalentes para uso, custo, aprovação e densidade de findings.
3. Agrupar repositórios por instalação e explicar estados suspensos, removidos e deletados.
4. Permitir consulta de modelos a membros e administradores.
5. Limitar criação, edição e seleção a administradores na UI e server function.
6. Invalidar catálogo após mutações bem-sucedidas e mostrar conflitos específicos.

### Verificação

```text
pnpm --filter @codekeat/web exec vitest run src/features/analytics src/features/models
pnpm --filter @codekeat/web typecheck
```

## Fase 6: testes de fluxo e acabamento

### Arquivos

- Criar configuração Playwright.
- Criar fluxos de login, navegação protegida, reviews, analytics e modelos.
- Integrar `@axe-core/playwright` nos estados principais.
- Atualizar documentação operacional e Compose.

### Passos

1. Testar sessão válida, inválida, expirada e logout.
2. Testar membro sem ações administrativas e admin com mutações.
3. Testar estados loading, vazio, erro parcial, sucesso e disabled.
4. Testar navegação e dialogs por teclado.
5. Verificar contraste, labels, foco, headings e representação textual dos gráficos.
6. Renderizar em desktop e mobile; corrigir clipping, overflow, alvos e reflow.
7. Buscar as Web Interface Guidelines atuais e revisar os arquivos finais.
8. Revisar waterfalls, imports pesados, renderizações e payload cliente pelas práticas React da Vercel.

### Verificação final

```text
pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm docker:config
```

Executar também o dashboard com a API real, autenticar, navegar pelas cinco áreas e observar os dados retornados. Repetir a verificação completa após qualquer correção.

## Critérios de conclusão

- O workspace web inicia, compila e executa no monorepo e no Compose.
- O token interno permanece no servidor.
- Login, logout e proteção de rotas funcionam com a API real.
- As cinco áreas consomem contratos validados da API.
- Review Track funciona com marca preenchida por shader, fallback estático e movimento reduzido.
- Estados vazios, falhas parciais, permissões e responsividade estão cobertos.
- Testes focados, verificação completa e inspeção visual passam.
