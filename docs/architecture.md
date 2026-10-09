# Arquitetura base

## Objetivo

O Codekeat inicia como um **monólito modular**: uma API única, uma interface web independente e um
banco SQLite local. A API recebe eventos do GitHub, coordena Reviews e publica Findings no modo
consultivo. Não há serviços distribuídos, broker de filas ou quality gate bloqueante nesta fase.

## Visão geral

```text
GitHub webhook -> github/controllers -> core/workflows -> review/services -> ReviewModel
                                         |                    |
                                         v                    v
                             repository-policy/services   Findings + Review Report

review contracts <- github/services
review contracts <- integrations/gemini -> integrations/takeat-mcp

Web application -> APIs públicas de auth e review
```

O [mapa de contextos](../CONTEXT-MAP.md) define Review, Repository Policy, GitHub Integration e
Dashboard Identity. A API implementa esses contextos nas features `review`, `repository-policy`,
`github` e `auth`.

## Limites

| Área                | Responsabilidade                                                    | Não deve conhecer                          |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `review`            | Review Run, Review Input, Review Model, Finding e Review Report     | Probot, Gemini, MCP ou detalhes do GitHub  |
| `repository-policy` | Validar e resolver Repository Policy                                | Orquestração de Review ou Octokit          |
| `github`            | Webhooks, installations, repository access e serviços GitHub        | Implementações internas de outras features |
| `auth`              | Dashboard User, Dashboard Session e métodos de identidade isolados  | Installation ou credenciais do GitHub App  |
| `core/workflows`    | Coordenar APIs públicas de múltiplas features                       | Implementações internas das features       |
| `integrations`      | Implementar contratos para Gemini, Takeat MCP e serviços externos   | Controllers ou repositories concretos      |
| `shared`            | Código técnico puro, nomeado por responsabilidade e realmente comum | Features, integrations ou workflows        |
| `database`          | Migrations e schemas agrupados por feature                          | Casos de uso ou lógica de orquestração     |
| `bootstrap`         | Compor controllers, services, repositories, integrations e workflow | Regras de decisão                          |
| `web`               | Autenticar pessoas e exibir histórico e detalhes de Reviews         | Webhooks, SDKs de IA ou SQLite             |

Cada feature usa somente as categorias convencionais necessárias: `controllers`, `services`,
`repositories`, `types`, `constants`, `utils` e `errors`. O `index.ts` na raiz é sua API pública;
arquivos de implementação não ficam soltos na raiz da feature.

Imports dentro do mesmo módulo são relativos. Imports entre módulos usam `#features/*`,
`#integrations/*`, `#shared/*` ou `#core/workflows/*` e nunca apontam para arquivos internos.
Features não importam workflows. `core/workflows` coordena as APIs públicas; `bootstrap` faz a
composição manual sem container de injeção.

`shared` não é um diretório genérico de conveniência. Um módulo compartilhado precisa ter
responsabilidade específica, ser neutro ao domínio e atender mais de um consumidor real. Os módulos
atuais são `#shared/http` e `#shared/database`; não existem `utils`, `services` ou `controllers`
globais.

Gemini e Takeat MCP ficam em `integrations` porque implementam bordas externas. Integrações podem
depender de contratos públicos das features, mas não de controllers ou repositories concretos.

Constantes de módulo e valores mágicos extraídos usam `UPPER_SNAKE_CASE`. Variáveis locais imutáveis
continuam em `camelCase`; `const` por si só não transforma uma variável local em constante nomeada.

## Fluxo de um Review

1. Um evento elegível de pull request chega pelo controller GitHub.
2. O serviço de webhook deduplica pela entrega e pelo SHA do commit antes de iniciar outro Review Run.
3. O serviço GitHub lê a Repository Policy da branch padrão e o workflow persiste o Review Run como `queued`.
4. A fila local agenda até `REVIEW_CONCURRENCY` runs ao mesmo tempo, sem atrasar a resposta HTTP.
   O padrão é cinco runs concorrentes dentro de uma única réplica da API.
5. O processador reivindica somente runs `queued`, muda-os para `running` e obtém o PR atual como a Installation.
6. Se o SHA mudou, o run fica `ignored`; caso contrário, o serviço captura o diff completo e cria um
   catálogo de fontes no head e no merge-base congelados. Arquivos inteiros selecionados conforme a
   capacidade do modelo acompanham o contexto inicial; as demais fontes continuam consultáveis.
7. O planejador agrupa diffs relacionados e cria unidades persistidas. Gerador e juiz executam com
   paralelismo limitado e ferramentas nativas de investigação. A integração Takeat MCP complementa
   essas fontes nas instalações autorizadas.
8. O preflight conta o request real. Uma unidade que exceda a capacidade é subdividida, preservando
   sua cobertura. Resultados validados e recibos de uso são gravados antes de avançar.
9. A API valida cobertura, deduplica candidatos e julga lotes completos. Só depois de todas as unidades
   concluírem persiste Findings e um Review Report pendente na transição atômica para `completed`.
10. Uma fila separada publica relatórios consultivos, um por vez. O marcador do relatório permite
    reconhecer uma publicação já aceita pelo GitHub antes de uma interrupção local.
11. Falhas controladas conservam checkpoints e consumo. Uma fatia de trinta minutos devolve o run à
    fila. A inicialização recupera runs e publicações interrompidos.

O handler do webhook não executa análise longa no caminho da resposta HTTP. `p-queue` controla a
concorrência local; o armazenamento de planos e unidades em SQLite fornece a retomada. Enquanto SQLite
for usado, uma única réplica da API processa Reviews e recupera claims. Limites de chamadas e tokens
por minuto pertencem ao guard Google compartilhado, com retries de geração sob responsabilidade do
AI SDK. Consulte [Contexto de revisão](review-context.md) para os contratos e limites operacionais.

## Extensibilidade necessária agora

### Modelos de IA

Definir um único contrato interno de modelo, `ReviewModel`, com entrada e saída concretas.
`GeminiReviewService`, em `integrations/gemini`, é a primeira implementação. Um novo modelo entra por
outra integração, sem alterar o módulo `review` nem os dados persistidos.

O adaptador Gemini usa o AI SDK da Vercel e `@ai-sdk/google`. `Output.object` usa os mesmos schemas
Zod para orientar e validar findings e julgamentos. O bootstrap configura o provider com `GOOGLE_API_KEY`.
Os contratos de aplicação continuam assíncronos com `Promise`, sem tipos dos SDKs no domínio.

O Effect é o padrão da API para falhas compostas, recursos, prazos, cache e concorrência.
O processor usa falhas tipadas e execução sequencial para interromper a análise sem resultados parciais.
O registro de ferramentas usa `Semaphore` para serializar consultas distintas e reutilizar respostas. Nos adaptadores
OAuth e MCP, `Cache` controla o TTL e compartilha a obtenção de tokens.
`acquireUseRelease` fecha as conexões mesmo em falhas parciais, com prazo limitado. Cada operação MCP
abre uma sessão curta, o que acrescenta handshakes e evita estado de conexão compartilhado entre reviews.
Uma rejeição de autenticação renova a credencial uma vez. A composição e os critérios de uso estão
em [Padrões de Effect na API](effect.md).

### Política por repositório

Cada repositório terá uma `Repository Policy` validada por schema. A fonte inicial será
`.codekeat.yml` na branch padrão, nunca no commit do pull request analisado. A policy pode definir
escopo de paths, instruções de revisão, severidades aceitas, tamanho máximo do diff e modelo escolhido.
Defaults do servidor são a base; a policy só pode sobrescrever opções explicitamente permitidas.

Na primeira fatia, o schema aceita somente `version: 1` e `enabled`. Arquivo ausente usa o default;
arquivo inválido também usa o default, mas registra o aviso `invalid_repository_policy` no Review Run.

### Conhecimento do repositório

O diretório `.codekeat/` fornece conhecimento sobre o projeto e permanece separado da Repository Policy.
O carregamento inicial prioriza `README.md`, `domain.md` e `integrations.md`, seguido dos arquivos com
alterações no diff. Todos são consultados no SHA e no repositório de origem do head, inclusive
quando o PR vem de um fork. O carregamento não troca uma revisão ausente pela branch padrão.

O carregador descobre documentos adicionais de `.codekeat/`, seleciona arquivos completos conforme
a capacidade inicial e confirma imports locais diretos e testes relacionados. As fontes restantes
ficam acessíveis no catálogo. Ausência e indisponibilidade são estados explícitos. Não há truncamento por
caracteres, e regras do agente ficam separadas dos dados externos.

O request serializado do AI SDK passa por contagem de tokens e comparação com a capacidade real do
modelo, incluindo ferramentas e histórico. O judge divide lotes grandes em candidatos completos;
contexto indivisível que não cabe falha explicitamente. Cada chamada HTTP admitida do modelo tem prazo
de cinco minutos. O run usa fatias retomáveis de trinta minutos. Consumo conhecido sobrevive a falhas,
fallbacks e retries. As regras
de seleção e proveniência estão em [Contexto de revisão](review-context.md).

## Estado persistido mínimo

SQLite guarda somente o estado pertencente ao Codekeat: instalação, repositório conectado, Review Run,
Finding, snapshot da Repository Policy, unidades, recibos de uso e métricas operacionais. GitHub continua sendo a fonte de verdade para
pull requests, commits e usuários.

Um Review Run registra o repositório, número do PR, SHA analisado, status, timestamps, modelo, policy
aplicada e erro estruturado quando houver falha. Finding registra a severidade, caminho, linha adicionada,
título e justificativa. Planos e unidades conservam payloads e resultados privados para retomada.
Artefatos completos de fontes e investigação ficam ao lado do banco no volume persistente. A
telemetria armazena metadados sem conteúdo privado. Review Report mantém o
comentário consultivo de cada execução, preservando o histórico entre SHAs do PR.

Um Webhook Delivery registra cada evento recebido e impede processamento simultâneo ou repetição de
entregas concluídas. A chave única de repositório, PR e SHA impede Reviews duplicados quando eventos
distintos se referem ao mesmo commit. Review Report é único por Review Run. Seu marcador permite
reencontrar o comentário após uma resposta perdida.

Dashboard User e Dashboard Session pertencem à API. O painel envia as credenciais somente ao endpoint
interno autenticado pela comunicação entre containers; a API valida a senha com Argon2id e persiste apenas
seu hash. A sessão exposta ao navegador é um token opaco, armazenado em cookie `httpOnly`, e a API armazena
somente o hash desse token. Logout revoga a sessão persistida. O usuário administrador inicial é provisionado
uma única vez pelo bootstrap via ambiente; mudanças posteriores no ambiente não alteram sua senha.
O BFF limita cada e-mail a cinco tentativas de login malsucedidas por quinze minutos na réplica local do
painel, sem informar se o e-mail ou a senha foi o dado incorreto.

## Restrições de produto

- O produto opera em Advisory Mode: não cria conclusões de falha, não solicita alterações e não bloqueia merge.
- Nesta fase, publica apenas um comentário consultivo atualizado por PR; não publica Check, status ou
  qualquer sinalização bloqueante.
- `queued` significa que o run foi aceito e agendado, `running` que foi reivindicado pela fila e os estados
  finais são `completed`, `failed` e `ignored`.
- Todo dado externo é validado na borda antes de entrar na aplicação.
- Credenciais, conteúdo do PR, diff, prompt e resposta do modelo não podem aparecer em logs ou mensagens de erro.
- Resultados do MCP são dados externos não confiáveis; o token, as consultas e o conteúdo retornado não
  podem aparecer em logs ou mensagens de erro.

## Evolução orientada por sinais

| Sinal                                                   | Próxima decisão                                       |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Reinícios ou volume tornam runs locais não confiáveis   | Migrar para Postgres e uma fila durável               |
| Necessidade de mais de uma réplica                      | Migrar do SQLite antes de escalar a API               |
| A política precisa de gestão sem commits                | Adicionar interface web e API de administração        |
| Relatórios precisam de filtros ou ações administrativas | Ampliar o painel sem expor SQLite ao frontend         |
| Equipe decidir bloquear PRs                             | Criar ADR específica para checks, critérios e rollout |
