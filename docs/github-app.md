# GitHub App

## Registro

Crie a App como pública, com a opção **Any account**, sem publicá-la no Marketplace. A allowlist do
servidor controla quais organizações e perfis pessoais recebem processamento.

| Configuração            | Valor                                                  |
| ----------------------- | ------------------------------------------------------ |
| Webhook URL             | `https://<dominio>/api/github/webhooks`                |
| Webhook secret          | O mesmo valor de `WEBHOOK_SECRET`                      |
| Conteúdo de repositório | Read-only                                              |
| Pull requests           | Read-only                                              |
| Issues                  | Read and write                                         |
| Eventos                 | Pull request, Installation e Installation repositories |

`Issues: Read and write` permite criar e atualizar o comentário consultivo do relatório no PR. Não
conceda permissões de Checks ou qualquer outro acesso de escrita nesta fase.

## Ambiente

```dotenv
APP_ID=
PRIVATE_KEY=
PRIVATE_KEY_PATH=
WEBHOOK_SECRET=
DATABASE_PATH=/app/data/codekeat.db
REVIEW_MODE=advisory
ALLOWED_GITHUB_ACCOUNTS=takeat,organizacao-parceira,perfil-pessoal
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
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

Configure `PRIVATE_KEY` com o PEM ou Base64 do PEM, ou `PRIVATE_KEY_PATH` com o caminho para o arquivo
PEM. Para desenvolvimento local, prefira `PRIVATE_KEY_PATH` e não versione o arquivo.

`GOOGLE_API_KEY`, `GEMINI_MODEL` e as quatro variáveis `TAKEAT_MCP_*` são obrigatórias para a API
iniciar. O Codekeat usa `client_credentials`, guarda o access token somente em memória e o renova antes
do vencimento. O Gemini recebe o diff e os metadados dos PRs elegíveis, além dos resultados das
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

| Evento                                                                  | Efeito                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `installation.created`                                                  | Registra a Installation e os repositórios concedidos |
| `installation.suspend` / `installation.deleted`                         | Impede novos Reviews para a Installation             |
| `installation.unsuspend`                                                | Reativa a Installation permitida                     |
| `installation_repositories.added` / `removed`                           | Atualiza o Repository Access                         |
| `pull_request.opened` / `reopened` / `ready_for_review` / `synchronize` | Cria um Review Run para PR não-draft elegível        |

O endpoint é fornecido pelo Probot, que verifica a assinatura do GitHub com `WEBHOOK_SECRET`. O
Codekeat não executa código do pull request, lê `.codekeat.yml` exclusivamente da branch padrão e trata
resultados do MCP como dados externos não confiáveis.

As permissões permitem buscar o PR e seu diff como Installation e atualizar o comentário consolidado
do Codekeat. A App não publica Checks, status nem comentários inline bloqueantes.
