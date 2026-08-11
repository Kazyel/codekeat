# GitHub App

## Registro

Crie a App como pública, com a opção **Any account**, sem publicá-la no Marketplace. A allowlist do
servidor controla quais organizações e perfis pessoais recebem processamento.

| Configuração | Valor |
|--------------|-------|
| Webhook URL | `https://<dominio>/api/github/webhooks` |
| Webhook secret | O mesmo valor de `WEBHOOK_SECRET` |
| Conteúdo de repositório | Read-only |
| Pull requests | Read-only |
| Eventos | Pull request, Installation e Installation repositories |

Não conceda permissões de escrita, Checks ou Issues nesta fase.

## Ambiente

```dotenv
APP_ID=
PRIVATE_KEY=
PRIVATE_KEY_PATH=
WEBHOOK_SECRET=
DATABASE_PATH=/app/data/codekeat.db
REVIEW_MODE=advisory
ALLOWED_GITHUB_ACCOUNTS=takeat,organizacao-parceira,perfil-pessoal
```

`ALLOWED_GITHUB_ACCOUNTS` é obrigatória. Os logins são normalizados para minúsculas e somente contas
— organizações ou perfis pessoais — presentes nessa lista criam Reviews.

Configure `PRIVATE_KEY` com o PEM ou Base64 do PEM, ou `PRIVATE_KEY_PATH` com o caminho para o arquivo
PEM. Para desenvolvimento local, prefira `PRIVATE_KEY_PATH` e não versione o arquivo.

## Eventos tratados

| Evento | Efeito |
|--------|--------|
| `installation.created` | Registra a Installation e os repositórios concedidos |
| `installation.suspend` / `installation.deleted` | Impede novos Reviews para a Installation |
| `installation.unsuspend` | Reativa a Installation permitida |
| `installation_repositories.added` / `removed` | Atualiza o Repository Access |
| `pull_request.opened` / `reopened` / `ready_for_review` / `synchronize` | Cria um Review Run para PR não-draft elegível |

O endpoint é fornecido pelo Probot, que verifica a assinatura do GitHub com `WEBHOOK_SECRET`. O
Codekeat não executa código do pull request e lê `.codekeat.yml` exclusivamente da branch padrão.
