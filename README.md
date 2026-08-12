# Codekeat

Codekeat analisa pull requests do GitHub com IA e publica relatórios consultivos. Nesta fase, ele nunca
bloqueia merge, cria Checks ou aprova/reprova pull requests.

```text
GitHub App webhook → API/Probot → fila local → Gemini → SQLite → comentário no PR e painel
```

## Pré-requisitos

- Node.js 24 ou superior
- pnpm 10 ou superior, ativado via Corepack
- uma GitHub App
- uma chave de API Gemini
- Docker e Docker Compose, apenas para executar os containers

## Instalação local

Clone o repositório e instale as dependências:

```sh
git clone https://github.com/Kazyel/codekeat.git
cd codekeat
corepack enable
pnpm install --frozen-lockfile
```

Crie os arquivos de ambiente locais:

```sh
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Preencha `apps/api/.env` com os valores da GitHub App, Gemini e do administrador inicial:

```dotenv
APP_ID=
PRIVATE_KEY_PATH=/caminho/absoluto/para/codekeat.private-key.pem
WEBHOOK_SECRET=
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
ALLOWED_GITHUB_ACCOUNTS=seu-login-ou-organizacao
DASHBOARD_API_TOKEN=
INITIAL_ADMIN_EMAIL=seu-email@empresa.com
INITIAL_ADMIN_PASSWORD=uma-senha-com-pelo-menos-8-caracteres
```

`PRIVATE_KEY` é uma alternativa a `PRIVATE_KEY_PATH`, mas use apenas uma das duas. O administrador é
criado na primeira inicialização; alterar essas variáveis depois não redefine a senha existente.

Em `apps/web/.env`, configure a URL local da API e repita exatamente o token interno:

```dotenv
CODEKEAT_API_URL=http://localhost:3001
DASHBOARD_API_TOKEN=<mesmo-valor-da-api>
```

Valide antes de iniciar. O comando não imprime valores secretos:

```sh
pnpm env:check
```

## Executar localmente

Suba API e painel juntos:

```sh
pnpm dev
```

| Serviço | Endereço |
|---------|----------|
| API e webhooks | `http://localhost:3001` |
| Painel | `http://localhost:3501` |

Para iniciar somente a API:

```sh
pnpm dev:api
```

O painel usa e-mail e senha locais. Acesse `http://localhost:3501/login` com as credenciais de
`INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD`.

## Configurar a GitHub App

Registre uma GitHub App pública para **Any account**, sem Marketplace. Configure:

| Item | Valor |
|------|-------|
| Webhook URL | `https://<dominio>/api/github/webhooks` |
| Webhook secret | Mesmo valor de `WEBHOOK_SECRET` |
| Contents | Read-only |
| Pull requests | Read-only |
| Issues | Read and write |
| Eventos | Pull request, Installation, Installation repositories |

Instale a App somente nos repositórios desejados. `ALLOWED_GITHUB_ACCOUNTS` é uma segunda proteção:
somente organizações ou perfis dessa lista terão PRs processados. Após conceder `Issues: Read and write`,
aprove a alteração em instalações já existentes para permitir comentários no PR.

Para desenvolvimento local, o GitHub precisa alcançar a API. Use um túnel HTTPS ou Smee para encaminhar
o webhook a `http://localhost:3001/api/github/webhooks`. Consulte [docs/github-app.md](docs/github-app.md)
para os detalhes operacionais e de permissões.

## Fluxo de revisão

Eventos elegíveis de PR criam um Review Run. A fila local processa um run de cada vez, obtém o diff como
GitHub App, envia chunks sequenciais ao Gemini e persiste os Findings no SQLite. Ao concluir, atualiza um
único comentário consultivo no PR. Quando não encontra um problema concreto, o relatório diz isso
explicitamente.

Um PR em draft, uma conta fora da allowlist ou um repositório removido da instalação não é analisado.

## Banco local e painel

O SQLite está em `data/codekeat.db` por padrão. Para inspecioná-lo com Drizzle Studio:

```sh
pnpm db:studio
```

O painel é somente leitura e consome a API internamente; ele não acessa o arquivo SQLite no navegador.

## Docker

Crie o arquivo de configuração do Compose e os ambientes de cada aplicação:

```sh
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Depois de preencher `apps/api/.env` e `apps/web/.env`, execute:

```sh
pnpm env:check
pnpm docker:up
```

O Compose usa uma única réplica da API e persiste o SQLite em `CODEKEAT_DATA_DIR` (por padrão, `./data`).
Os serviços ficam ligados em loopback por padrão; coloque um proxy HTTPS na frente deles para uso externo.

## Verificação

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm docker:config
```

## Implantação na AWS

A implantação inicial usa imagens no ECR e uma instância EC2 ou Lightsail com volume EBS local para o
SQLite. Não execute mais de uma réplica da API enquanto o banco for SQLite. Leia
[infra/aws/README.md](infra/aws/README.md) antes de implantar.

## Segurança operacional

- Nunca versione `.env`, arquivos PEM ou o SQLite.
- Não exponha `DASHBOARD_API_TOKEN` como variável `NEXT_PUBLIC_`.
- Use HTTPS para o endpoint público de webhook e para o painel.
- Faça snapshots e backups periódicos do volume que contém o SQLite.
- A GitHub App não executa código vindo do pull request e a policy é lida apenas da branch padrão.

## Documentação

- [Arquitetura](docs/architecture.md)
- [GitHub App](docs/github-app.md)
- [Implantação na AWS](infra/aws/README.md)
- [Linguagem do domínio](CONTEXT.md)
