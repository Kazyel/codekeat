# Codekeat Dashboard Design

## Objetivo

Criar em `apps/web` um dashboard TanStack Start que autentique usuários e consuma as APIs existentes de `apps/api`. A tela inicial deve equilibrar operação e análise: mostrar o estado recente das reviews, uso, qualidade e falhas sem favorecer apenas uma dessas dimensões.

O dashboard não acessa SQLite, GitHub, Gemini ou MCP. A API continua dona dos dados, das sessões e das regras de autorização.

## Escopo

O dashboard inclui:

- login e logout com e-mail e senha;
- visão geral com métricas, tendências e reviews recentes;
- histórico das 50 reviews mais recentes;
- detalhe de uma review e seus findings;
- analytics de uso e qualidade;
- instalações e repositórios conectados ao GitHub;
- catálogo de modelos;
- criação, edição e seleção de modelos para administradores.

A implementação não altera `apps/api`, cria endpoints, adiciona gestão de usuários ou permite iniciar e repetir reviews. A API atual não oferece essas operações.

## Rotas e navegação

| Rota                    | Conteúdo                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `/login`                | Formulário de acesso e erro de credenciais sem revelar qual campo falhou |
| `/`                     | Visão geral equilibrada                                                  |
| `/reviews`              | Tabela com as 50 reviews retornadas pela API                             |
| `/reviews/$reviewRunId` | Identidade do PR, execução, custos, relatório e findings                 |
| `/analytics`            | Uso e qualidade agrupados por dia, semana ou mês                         |
| `/connections`          | Instalações GitHub e seus repositórios                                   |
| `/models`               | Catálogo e ações administrativas                                         |

No desktop, uma sidebar compacta mantém os cinco destinos visíveis. No mobile, um cabeçalho abre a mesma navegação em um sheet. A página atual, o título e a principal ação disponível permanecem identificáveis sem depender de cor.

## Arquitetura

```text
Browser
  -> TanStack Start routes, loaders and server functions
    -> Codekeat API
      -> domain services and repositories
        -> SQLite
```

TanStack Start funciona como BFF. O browser chama apenas server functions same-origin. O BFF envia `DASHBOARD_API_TOKEN` à API por rede servidor-servidor e nunca serializa essa credencial para HTML, JavaScript, logs ou respostas.

Arquivos client-safe contêm componentes, tipos de apresentação e schemas que podem chegar ao browser. Helpers que leem ambiente, cookies ou chamam a API usam módulos `.server.ts`. Server functions ficam em módulos `.functions.ts` e validam seus parâmetros com Zod.

O dashboard usa `fetch`; não adiciona Axios, GraphQL ou tRPC. Cada resposta externa passa por um schema Zod antes de entrar nos componentes. Erros HTTP viram resultados discriminados com estados conhecidos, sem expor corpo inesperado ou detalhes internos.

## Autenticação e autorização

O login chama `POST /api/v1/dashboard/sessions` no servidor com o token interno. Após sucesso, o BFF grava o token opaco da sessão em cookie `HttpOnly`, `Secure` em produção, `SameSite=Lax` e `Path=/`.

Uma função central lê e valida a sessão em `POST /api/v1/dashboard/sessions/validate`. Rotas protegidas redirecionam usuários sem sessão para `/login`. Logout chama `DELETE /api/v1/dashboard/sessions`, remove o cookie mesmo quando a revogação remota falha e retorna para `/login`.

O BFF aplica o limite existente na arquitetura: cinco logins malsucedidos por e-mail em quinze minutos na réplica local. A mensagem de erro não distingue e-mail, senha, usuário ausente ou limite atingido.

A API continua sendo a fronteira de autorização. O dashboard usa o papel recebido para remover ações de modelos que membros não podem executar, mas envia a sessão no header `x-dashboard-session` em todas as chamadas do catálogo. Respostas 401 encerram a sessão local. Respostas 403 mantêm a sessão e explicam a falta de permissão.

## Carregamento de dados

A visão geral busca em paralelo:

- `GET /api/v1/review-runs`;
- `GET /api/v1/review-usage?groupBy=day`;
- `GET /api/v1/review-quality?groupBy=day`.

Os cards derivam apenas métricas disponíveis nesses contratos. O dashboard não inventa progresso percentual, disponibilidade da API ou comparações que os dados não sustentam.

TanStack Query integra cache, hidratação SSR e atualização dos runs. Enquanto houver review `queued` ou `running`, a lista atualiza em intervalo moderado. Sem runs ativos, a atualização periódica para. Loaders preparam dados críticos e painéis independentes não formam waterfalls.

Filtros de período e repositório ficam nos search params da rota `/analytics`. A API filtra os endpoints de uso e qualidade. A lista de reviews continua limitada aos 50 registros atuais; filtros nessa tela operam sobre esse conjunto e a interface não os apresenta como busca histórica completa.

## Páginas

### Visão geral

A página mostra três grupos, na ordem:

1. resumo de reviews concluídas, findings aceitos e custo;
2. gráfico combinado de volume, qualidade e custo;
3. reviews recentes com ênfase em execuções ativas e falhas.

A interface exibe a origem e o período de cada número. Métricas sem base de cálculo aparecem como indisponíveis, não como zero.

### Reviews

TanStack Table controla ordenação, filtro local, visibilidade de colunas e paginação do conjunto recebido. Status, repositório e PR permanecem visíveis em densidade compacta. A linha abre o detalhe; ações secundárias ficam em menu.

O detalhe mostra status, trigger, SHA abreviado, modelo, policy, duração, tokens, custo, estado do relatório e link do comentário GitHub quando disponível. Findings agrupam severidade, arquivo, linha, título, justificativa e veredito do judge. Códigos de erro e ignore reason recebem textos curtos e específicos.

### Analytics

Recharts renderiza séries de uso, custo, aprovação e findings aceitos por mil linhas alteradas. Tooltips usam valores formatados, rótulos textuais e o mesmo período dos filtros. Tabelas resumidas acompanham gráficos para leitura precisa e acessibilidade.

### Conexões

A tela agrupa repositórios por instalação. Estados `suspended`, `deleted` e `removed` recebem tratamento visual e explicação. A tela não oferece conexão ou reconexão porque a API atual só permite leitura.

### Modelos

Todos os usuários autenticados consultam o catálogo. Administradores podem abrir dialogs para criar ou editar um modelo e selecionar um modelo habilitado. Zod aplica os limites da API na submissão. Conflitos de nome, modelo desabilitado e tentativa de desabilitar o selecionado recebem mensagens específicas.

## Direção visual: Review Track

A interface deriva o sistema gráfico do coelho Codekeat e do gutter de um diff: canvas concreto claro, superfícies brancas, navegação em tinta quase preta, regras duras e trilhos vermelho-laranja. O design evita glassmorphism, glow difuso, texto pequeno com tracking alto e kits de cards neutros.

Tokens principais:

- fundo: concreto frio `#ECEEF0`;
- superfície: branco sólido;
- navegação e texto principal: `#171719`;
- acento principal: vermelho Codekeat `#E60216`;
- acento secundário: laranja Codekeat `#FC6701`;
- estados: cores semânticas distintas com rótulo textual.

Panchang e Synonym, ambas do Fontshare, formam o sistema tipográfico. Panchang identifica títulos e métricas; Synonym preserva leitura em navegação, controles e tabelas. JetBrains Mono aparece somente em SHA, identificadores e metadados técnicos. Números usam algarismos tabulares.

## Shader e microinterações

`@paper-design/shaders-react` preenche uma máscara com o coelho Codekeat no cabeçalho. A animação termina antes de cinco segundos e a marca permanece estática.

Magic UI entra em dois pontos:

- Border Beam no item de review em execução;
- Number Ticker quando KPIs carregam pela primeira vez.

Transições duram entre 140 e 220 ms e animam `transform` e `opacity`. Hover desloca elementos no máximo dois pixels. Foco nunca depende da animação. `prefers-reduced-motion` desliga ticker, beam e velocidade do shader. A página não coreografa entrada, não anima tabelas inteiras e não mantém efeitos decorativos competindo com dados.

## Estados

Cada rota cobre:

- skeleton com a geometria final durante o primeiro carregamento;
- conteúdo preenchido;
- vazio com orientação ligada ao produto;
- erro recuperável no painel que falhou;
- sessão expirada;
- permissão insuficiente;
- ação em progresso, sucesso e falha;
- controle disabled durante submissão;
- seleção, expansão e foco por teclado.

Falhas parciais preservam painéis carregados. O botão de nova tentativa refaz apenas a query afetada. A tela de reviews apresenta `queued`, `running`, `completed`, `failed` e `ignored` sem indicar progresso que a API não fornece.

## Responsividade e acessibilidade

A interface atende desktop, tablet e mobile. Grupos refluem; não apenas encolhem. Tabelas preservam repositório, PR e status, movem dados secundários para detalhes e mantêm ações acessíveis.

Todo controle possui nome acessível, foco visível e alvo de toque adequado. Ícones decorativos ficam ocultos da árvore de acessibilidade. Gráficos usam `accessibilityLayer` e uma representação tabular. Cor nunca comunica status sozinha. Overlays escapam de containers com `overflow` e mantêm foco preso enquanto abertos.

## Dependências

Base inicial:

- TanStack Start e Router;
- TanStack Query com integração SSR;
- TanStack Form;
- TanStack Table;
- Tailwind CSS;
- shadcn/ui;
- componentes pontuais do Magic UI;
- Zod;
- Recharts;
- Lucide React;
- Sonner;
- `@paper-design/shaders-react` com versão exata.

Vitest cobre funções de transformação e estados de autenticação. Testing Library cobre formulários e interações que tenham lógica própria. Playwright cobre login, logout, navegação protegida, detalhe de review, filtros de analytics e ações administrativas. `@axe-core/playwright` verifica as páginas e estados interativos principais.

Sentry fica fora da primeira implementação. Ele entra após existir ambiente de deploy, DSN e decisão sobre retenção de dados.

## Desempenho

O servidor inicia buscas independentes em paralelo. Componentes importam módulos por caminho direto. Recharts, dialogs administrativos e o shader não entram no bundle de rotas que não os usam. O shader usa uma única instância visível, pausa fora da viewport e não bloqueia conteúdo.

A aplicação evita estado global. Search params guardam filtros compartilháveis, TanStack Query guarda dados remotos e estado React local controla interação efêmera. TanStack Virtual fica fora até medições mostrarem necessidade.

## Verificação

A implementação deve passar por:

1. typecheck do workspace web;
2. lint e formatação dos arquivos alterados;
3. testes unitários focados nos contratos alterados;
4. smoke test real com API e dashboard;
5. fluxos Playwright críticos;
6. varredura axe nas páginas principais;
7. inspeção visual em desktop e mobile;
8. revisão pelas Web Interface Guidelines e pelas práticas de desempenho React.

## Critérios de aceite

- O usuário entra e sai sem expor tokens ao JavaScript do browser.
- Rotas protegidas rejeitam acesso sem sessão válida.
- O dashboard renderiza dados reais dos endpoints existentes.
- A visão geral equilibra reviews, uso e qualidade.
- Membros não veem ações administrativas de modelos; a API também bloqueia essas ações.
- Todos os estados definidos possuem tratamento visível e recuperável quando aplicável.
- Review Track permanece legível sem WebGL, animação ou hover.
- Navegação, tabelas, forms e dialogs funcionam por teclado.
- Nenhuma tela afirma capacidade que a API não oferece.
