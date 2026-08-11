# GitHub App

## Registro

Crie a App como pública, com a opção **Any account**, sem publicá-la no Marketplace. A allowlist do
servidor controla quais organizações recebem processamento.

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
WEBHOOK_SECRET=
DATABASE_PATH=/app/data/codekeat.db
REVIEW_MODE=advisory
ALLOWED_GITHUB_ORGANIZATIONS=takeat,organizacao-parceira
```

`ALLOWED_GITHUB_ORGANIZATIONS` é obrigatória. Os logins são normalizados para minúsculas e somente
organizações presentes nessa lista criam Reviews.

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
