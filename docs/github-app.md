# GitHub App

## Registro

Crie a App como pública, com a opção **Any account**, sem publicá-la no Marketplace. A allowlist do
servidor controla quais organizações e perfis pessoais recebem processamento.

| Configuração            | Valor                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Webhook URL             | `https://<dominio>/api/github/webhooks`                            |
| Webhook secret          | O mesmo valor de `WEBHOOK_SECRET`                                  |
| Conteúdo de repositório | Read-only                                                          |
| Pull requests           | Read-only                                                          |
| Issues                  | Read and write                                                     |
| Eventos                 | Pull request, Installation, Installation repositories e Repository |

O GitHub expõe comentários gerais de PR pela API de Issues. Por isso, `Issues: Read and write` permite
criar e atualizar o comentário consultivo, enquanto `Pull requests: Read-only` basta para ler o PR e o
diff. Não conceda permissões de Checks ou qualquer outro acesso de escrita nesta fase.

## Ambiente

```dotenv
APP_ID=
PRIVATE_KEY=
PRIVATE_KEY_PATH=
WEBHOOK_SECRET=
DATABASE_PATH=/app/data/codekeat.db
REVIEW_MODE=advisory
REVIEW_CONCURRENCY=5
ALLOWED_GITHUB_ACCOUNTS=takeat,organizacao-parceira,perfil-pessoal
GOOGLE_API_KEY=
TAKEAT_MCP_URL=https://mcp.takeat.app/mcp
TAKEAT_MCP_TOKEN_URL=https://mcp.takeat.app/oauth/token
TAKEAT_MCP_CLIENT_ID=
TAKEAT_MCP_CLIENT_SECRET=
DASHBOARD_API_TOKEN=
INITIAL_ADMIN_EMAIL=admin@empresa.com
INITIAL_ADMIN_PASSWORD=
```

`ALLOWED_GITHUB_ACCOUNTS` é obrigatória. Os logins são normalizados para minúsculas e somente contas
— organizações ou perfis pessoais — presentes nessa lista criam Reviews.

`REVIEW_CONCURRENCY` é opcional e limita quantos PRs a API analisa ao mesmo tempo. O padrão é `5`;
o valor deve ser um inteiro positivo. Configure em `apps/api/.env`, também usado pelo Compose.

Configure `PRIVATE_KEY` com o PEM ou Base64 do PEM, ou `PRIVATE_KEY_PATH` com o caminho para o arquivo
PEM. Para desenvolvimento local, prefira `PRIVATE_KEY_PATH` e não versione o arquivo.

`GOOGLE_API_KEY` e as quatro variáveis `TAKEAT_MCP_*` são obrigatórias para a API iniciar. O modelo
Gemini e as tarifas são definidos no catálogo global do dashboard; a migration inicial seleciona o Gemini
3.8 Flash. O Codekeat usa `client_credentials`, guarda o access token somente em memória e o renova
antes do vencimento. O Gemini recebe o diff e os metadados dos PRs elegíveis, além dos resultados das
ferramentas permitidas de código e histórico técnico da Takeat. Credenciais e tokens não chegam ao Gemini.

`DASHBOARD_API_TOKEN` protege a API interna usada pelo painel. Use o mesmo valor em `apps/web/.env`,
mas nunca o exponha como variável `NEXT_PUBLIC_`.

## Painel

O painel usa autenticação local por e-mail e senha. A GitHub App não precisa de Callback URL, Client ID,
Client Secret nem fluxo OAuth para o painel. Configure:

```dotenv
CODEKEAT_API_URL=http://api:3001
DASHBOARD_API_TOKEN=
```

Configure `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD` na API antes da primeira inicialização. A senha
deve ter ao menos 8 caracteres e é armazenada como hash Argon2id. O bootstrap não substitui uma conta
existente, portanto a rotação de senha e a gestão de novos usuários serão uma capacidade administrativa futura.
As sessões expiram após oito horas, ficam em cookie `httpOnly` e podem ser revogadas por logout.

## Eventos tratados

| Evento                                                                                                                            | Efeito                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `installation.created` / `unsuspend` / `new_permissions_accepted`                                                                 | Reconcilia a Installation permitida e seu inventário completo                  |
| `installation.suspend` / `installation.deleted`                                                                                   | Impede novos Reviews e invalida sincronizações em andamento                    |
| `installation_repositories.added` / `removed`                                                                                     | Reconcilia o inventário completo de Repository Access                          |
| `repository.created` / `deleted` / `renamed` / `archived` / `unarchived` / `edited` / `transferred` / `privatized` / `publicized` | Reconcilia acesso e metadados da Installation permitida                        |
| `pull_request.opened` / `reopened` / `ready_for_review` / `synchronize`                                                           | Cria um Review Run para PR não-draft elegível, com acesso já conhecido e ativo |

## Inventário e recuperação

O catálogo de repositórios vem exclusivamente de `GET /installation/repositories`, autenticado com
token da própria Installation. Os modos **All repositories** e **Only select repositories** usam o mesmo
fluxo paginado; a seleção é aplicada pelo GitHub, sem consultar a organização nem inferir acesso pelo
payload de um PR. O evento `repository.created` também atualiza instalações em modo **All repositories**.

Cada sincronização consulta a Installation pela API da App e valida as respostas com Zod. Somente
depois de todas as páginas serem recebidas e validadas, uma transação SQLite atualiza a Installation,
o owner, o nome e a branch padrão reais dos repositórios. Repositórios sem acesso e sem Review Runs
são excluídos somente naquela Installation. Os que possuem histórico permanecem como `removed`,
sem acesso ativo, preservando seus Reviews. A exclusão da Installation aplica a mesma regra;
suspensão temporária preserva o inventário. Uma nova concessão cadastra ou reativa o repositório.
Falha, duplicação ou inconsistência entre páginas não grava um catálogo parcial nem reativa uma
Installation suspensa.
Arquivar um repositório dispara a consulta, mas não equivale a revogar seu acesso pela App.

Na inicialização, a API descobre instalações pela API autenticada da App (`GET /app/installations`),
respeita `ALLOWED_GITHUB_ACCOUNTS` e reconcilia também instalações já persistidas. Isso recupera eventos
perdidos enquanto a API estava offline, inclusive revogações confirmadas por `404`/`410` na consulta da
Installation. Falhas são registradas explicitamente; a última informação local é preservada e uma
Installation com falha não impede a sincronização das outras nem, por si só, derruba a inicialização.

Sincronizações são serializadas por Installation em memória, com invalidação de snapshots antigos
quando chega outro evento ou uma suspensão/exclusão. Isso depende da restrição de **uma réplica da API**.
Não há fila externa, replay durável ou varredura periódica: após falha, a recuperação depende de nova
entrega do webhook, outro evento pertinente ou reinicialização. Um PR desconhecido/removido falha
fechado e nunca concede ou restaura Repository Access pelo payload assinado.

Antes de decidir o acesso de um PR, o workflow aguarda a sincronização mais recente em andamento.
Se o cache ainda não conhece a Installation ou o Repository, ou se o repositório consta como removido,
reconcilia o inventário autenticado pelo GitHub. Uma remoção permanece fechada até o GitHub confirmar
nova concessão. Suspensão e exclusão da Installation permanecem fechadas após a sincronização pendente.
Entregas anteriormente
ignoradas apenas por cache sem acesso podem ser reprocessadas; outras razões de descarte são mantidas.

O endpoint é fornecido pelo Probot, que verifica a assinatura do GitHub com `WEBHOOK_SECRET`. O
Codekeat não executa código do pull request, lê `.codekeat.yml` exclusivamente da branch padrão e trata
resultados do MCP como dados externos não confiáveis.

As permissões permitem buscar o PR e seu diff como Installation e atualizar o comentário consolidado
do Codekeat. A App não publica Checks, status nem comentários inline bloqueantes.

Cada relatório inclui um marcador com seu ID. A publicação consulta comentários de forma paginada
e verifica a identidade autenticada da App e a autoria Bot antes de reutilizar um comentário. Um ID
já persistido também é validado antes de atualizar. Erros nessa consulta impedem criar um comentário
às cegas. O POST não tem retries automáticos: se o GitHub gravar o comentário e a resposta se perder,
o retry do relatório reencontra o marcador e reutiliza o comentário existente. GETs e publicação usam
cancelamento e um prazo total de dez segundos.
