<p align="center">
  <img src="assets/codekeat.svg" alt="Símbolo do Codekeat" width="180" />
</p>

<h1 align="center">Codekeat</h1>

<p align="center">
  <strong>Review consultivo de pull requests, com contexto técnico e findings concretos.</strong>
</p>

<p align="center">
  <code>GitHub → fila local → Gemini + MCP da Takeat → relatório no PR e painel</code>
</p>

Codekeat analisa pull requests do GitHub com IA e publica relatórios consultivos. Nesta fase, ele nunca
bloqueia merge, cria Checks ou aprova/reprova pull requests.

## Pré-requisitos

- Node.js 24 ou superior
- pnpm 10 (o repositório fixa a versão 10.33.2), ativado via Corepack
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

Preencha `apps/api/.env` com os valores da GitHub App, Gemini, MCP da Takeat e do administrador inicial:

```dotenv
APP_ID=
PRIVATE_KEY_PATH=/caminho/absoluto/para/codekeat.private-key.pem
WEBHOOK_SECRET=
GOOGLE_API_KEY=
TAKEAT_MCP_URL=https://mcp.takeat.app/mcp
TAKEAT_MCP_TOKEN_URL=https://mcp.takeat.app/oauth/token
TAKEAT_MCP_CLIENT_ID=
TAKEAT_MCP_CLIENT_SECRET=
ALLOWED_GITHUB_ACCOUNTS=seu-login-ou-organizacao
DASHBOARD_API_TOKEN=
INITIAL_ADMIN_EMAIL=seu-email@empresa.com
INITIAL_ADMIN_PASSWORD=uma-senha-com-pelo-menos-8-caracteres
DATABASE_PATH=../../packages/database/data/codekeat.db
REVIEW_MODE=advisory
```

Baixe a chave privada da GitHub App e configure `PRIVATE_KEY_PATH` com o caminho do arquivo PEM. Como
alternativa, use `PRIVATE_KEY` com o PEM ou seu conteúdo em Base64. Para Docker, use `PRIVATE_KEY`: o
Compose não monta o arquivo indicado por `PRIVATE_KEY_PATH` no container. Não versione a chave.

`ALLOWED_GITHUB_ACCOUNTS` aceita logins de organizações ou usuários separados por vírgula e deve conter
ao menos uma conta. `REVIEW_MODE` aceita somente `advisory`. `WEBHOOK_PROXY_URL` é opcional para o
desenvolvimento com Smee. O administrador é criado na primeira inicialização; mudar as variáveis
`INITIAL_ADMIN_*` depois não altera sua conta nem sua senha. A senha deve ter de 8 a 256 caracteres.

O modelo Gemini e as tarifas são definidos no catálogo global em **Modelos** no painel. A migração
inicial seleciona o Gemini 3.8 Flash; alterações afetam somente novas reviews.

`TAKEAT_MCP_URL` e `TAKEAT_MCP_TOKEN_URL` devem usar HTTPS. A API troca as credenciais permanentes
por um access token, mantém o token somente em memória e o renova antes do vencimento. Credenciais e
tokens não são enviados ao Gemini.

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

| Serviço        | Endereço                |
| -------------- | ----------------------- |
| API e webhooks | `http://localhost:3001` |
| Painel         | `http://localhost:3501` |

Para iniciar somente a API:

```sh
pnpm dev:api
```

O painel usa e-mail e senha locais. Acesse `http://localhost:3501/login` com as credenciais de
`INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD`. O administrador pode adicionar, editar e selecionar
modelos em **Modelos**; as páginas de conexões, revisões e métricas consultam os dados da API.

## Configurar a GitHub App

Registre uma GitHub App pública para **Any account**, sem Marketplace. Configure:

| Item           | Valor                                                 |
| -------------- | ----------------------------------------------------- |
| Webhook URL    | `https://<dominio>/api/github/webhooks`               |
| Webhook secret | Mesmo valor de `WEBHOOK_SECRET`                       |
| Contents       | Read-only                                             |
| Pull requests  | Read-only                                             |
| Issues         | Read and write                                        |
| Eventos        | Pull request, Installation, Installation repositories |

Instale a App somente nos repositórios desejados. `ALLOWED_GITHUB_ACCOUNTS` é uma segunda proteção:
somente organizações ou perfis dessa lista terão PRs processados. Após conceder `Issues: Read and write`,
aprove a alteração em instalações já existentes para permitir comentários no PR.

Para desenvolvimento local, o GitHub precisa alcançar a API. Use um túnel HTTPS ou Smee para encaminhar
o webhook a `http://localhost:3001/api/github/webhooks`. Consulte [docs/github-app.md](docs/github-app.md)
para os detalhes operacionais e de permissões.

## Fluxo de revisão

Eventos elegíveis de PR criam um Review Run. A fila local processa até cinco runs ao mesmo tempo e obtém
o diff, a descrição e o contexto do repositório como GitHub App. Os documentos em `.codekeat/` e os arquivos
alterados são lidos integralmente no SHA do PR. Imports locais diretos e testes relacionados
complementam o contexto, sem cortes por quantidade de caracteres.

`REVIEW_CONCURRENCY` em `apps/api/.env` define o máximo de análises simultâneas. O padrão é `5`;
o valor deve ser um inteiro positivo. Use `1` para processamento serial. Cada run mantém seus chunks
e julgamentos sequenciais. Relatórios usam uma fila separada, com uma publicação por vez, para não
esperarem pelas análises em andamento. O limite vale dentro de uma única réplica da API.

O Gemini recebe esse contexto com cada chunk. Para instalações da Takeat, o modelo também pode consultar
código e histórico técnico no MCP. O juiz recebe título, descrição, contexto do repositório e as consultas
MCP realizadas na geração dos candidatos. Instruções ficam separadas dos dados externos. Antes de cada
geração, a API conta o request completo e verifica a capacidade real do modelo. Um contexto indivisível
que não cabe causa uma falha explícita. A API persiste o julgamento e publica um comentário
consultivo por execução, identificado mesmo quando o GitHub grava uma publicação e sua resposta se perde.
Quando não encontra um problema concreto, o relatório diz isso explicitamente.

A integração usa o [AI SDK da Vercel](https://ai-sdk.dev/docs/introduction) com o provider Google e
respostas estruturadas por Zod. O Effect gerencia cache, prazos, renovação de credenciais e recursos
dos adaptadores OAuth e MCP, além das falhas e da execução sequencial no pipeline de revisão. Cada
tentativa de geração tem prazo de cinco minutos e o run tem prazo de trinta minutos. O consumo
conhecido de review e judge é conservado em falhas, fallbacks e retries, sem duplicar tokens de cache.
Consulte [Padrões de Effect na API](docs/effect.md) para os critérios de uso. Os contratos de revisão
permanecem independentes dessas bibliotecas.

O diretório `.codekeat/` descreve o projeto, seus domínios e suas integrações. A configuração permanece
em `.codekeat.yml`, na branch padrão. Consulte [Contexto de revisão](docs/review-context.md) para os
arquivos reconhecidos, os limites e a interpretação das evidências.

Um PR em draft, uma conta fora da allowlist ou um repositório removido da instalação não é analisado.

## Banco local e painel

No desenvolvimento local, o SQLite fica em `packages/database/data/codekeat.db`. A API aplica as
migrações ao iniciar. Para inspecionar o banco com Drizzle Studio:

```sh
pnpm db:studio
```

O painel acessa a API pelo servidor; o navegador não acessa o SQLite nem recebe `DASHBOARD_API_TOKEN`.

## Docker

Crie o arquivo de configuração do Compose e os ambientes de cada aplicação:

```sh
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Em `.env`, configure `CODEKEAT_DATA_DIR` para o diretório que guardará o SQLite. O arquivo de exemplo
usa `./data`; sem essa variável, o Compose usa `./packages/database/data`. Também é possível ajustar
`BIND_ADDRESS`, `API_PORT` e `WEB_PORT`. Em `apps/api/.env`, configure `PRIVATE_KEY` com o PEM em
Base64, pois um caminho local em `PRIVATE_KEY_PATH` não fica disponível no container. Preencha os
demais valores de `apps/api/.env` e `apps/web/.env`, mantendo o mesmo `DASHBOARD_API_TOKEN` nos dois.

Valide a configuração e inicie os containers:

```sh
pnpm env:check
pnpm docker:up
```

O Compose usa uma única réplica da API e persiste o SQLite em `CODEKEAT_DATA_DIR`.
Os serviços ficam ligados em loopback por padrão; coloque um proxy HTTPS na frente deles para uso externo.

## Verificação

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm docker:config
```

## Segurança operacional

- Nunca versione `.env`, arquivos PEM ou o SQLite.
- Não exponha `DASHBOARD_API_TOKEN` como variável `VITE_`.
- Use HTTPS para o endpoint público de webhook e para o painel.
- Faça snapshots e backups periódicos do volume que contém o SQLite.
- Não execute mais de uma réplica da API enquanto o banco for SQLite.
- A GitHub App não executa código vindo do pull request e a policy é lida apenas da branch padrão.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Contexto de revisão](docs/review-context.md)
- [GitHub App](docs/github-app.md)
- [Mapa e linguagem dos contextos](CONTEXT-MAP.md)
