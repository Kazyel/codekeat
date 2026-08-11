# Arquitetura base

## Objetivo

O Codekeat inicia como um **monólito modular**: uma API única, uma interface web independente e um
banco SQLite local. A API recebe eventos do GitHub, coordena Reviews e publica Findings no modo
consultivo. Não há serviços distribuídos, broker de filas ou quality gate bloqueante nesta fase.

## Visão geral

```text
GitHub webhook
      |
      v
GitHub adapter -> Review module -> AI model port -> Gemini adapter
      |                  |                |
      |                  v                v
      |            SQLite (runs,       Typed result
      |             findings, policy)       |
      `-------------------------------------v
                              GitHub publisher -> comentário consultivo no PR

Web application -------------------------> API de leitura de Reviews
```

## Limites

| Área | Responsabilidade | Não deve conhecer |
|------|------------------|-------------------|
| `review` | Orquestrar um Review Run e produzir Findings | Probot, Octokit, Gemini, Drizzle |
| `repository-policy` | Resolver e validar a Repository Policy | Detalhes do modelo de IA |
| `github` | Receber eventos, obter contexto e publicar feedback | Regras de negócio de Review |
| `ai` | Adaptar um provedor de modelo ao contrato de análise | HTTP/GitHub/SQLite |
| `database` | Persistir o estado do Codekeat | Lógica de orquestração |
| `web` | Exibir histórico e detalhes de Reviews | Webhooks e SDKs de IA |

O diretório inicial da API deve refletir esses limites em módulos verticais. Código de domínio e
orquestração fica nos módulos; Probot, Octokit, Gemini e Drizzle ficam nos adaptadores nas bordas.
Não criar camadas genéricas, repositórios abstratos ou módulos compartilhados sem variação real.

## Fluxo de um Review

1. Um evento elegível de pull request chega pelo adaptador GitHub.
2. O adaptador deduplica pela entrega e pelo SHA do commit antes de iniciar outro Review Run.
3. A API lê a Repository Policy da branch padrão; a coleta de diff e contexto entra com o analisador.
4. O módulo `review` persiste o Review Run e o agenda na fila local somente para limitar concorrência.
5. O provedor de IA recebe uma entrada tipada e devolve Findings tipados.
6. A API persiste o resultado e publica um comentário consolidado no pull request.
7. Falhas ficam registradas no Review Run e podem ser reexecutadas sem duplicar o comentário.

O handler do webhook não executa análise longa no caminho da resposta HTTP. `p-queue` controla a
concorrência local; ele não é um broker durável. Enquanto SQLite for usado, uma única réplica da API
processa Reviews. A recuperação de runs pendentes após reinício deve usar o estado persistido.

## Extensibilidade necessária agora

### Modelos de IA

Definir um único contrato interno de modelo, por exemplo `ReviewModel`, com entrada e saída concretas.
O adaptador Gemini é a primeira implementação. Um novo modelo entra por outro adaptador, sem alterar
o módulo `review` nem os dados persistidos.

### Política por repositório

Cada repositório terá uma `Repository Policy` validada por schema. A fonte inicial será
`.codekeat.yml` na branch padrão, nunca no commit do pull request analisado. A policy pode definir
escopo de paths, instruções de revisão, severidades aceitas, tamanho máximo do diff e modelo escolhido.
Defaults do servidor são a base; a policy só pode sobrescrever opções explicitamente permitidas.

Na primeira fatia, o schema aceita somente `version: 1` e `enabled`. Arquivo ausente usa o default;
arquivo inválido também usa o default, mas registra o aviso `invalid_repository_policy` no Review Run.

## Estado persistido mínimo

SQLite guarda somente o estado pertencente ao Codekeat: instalação, repositório conectado, Review Run,
Finding e snapshot da Repository Policy usada na execução. GitHub continua sendo a fonte de verdade para
pull requests, commits e usuários.

Um Review Run deve registrar o repositório, número do PR, SHA analisado, status, timestamps, modelo,
policy aplicada, referência ao comentário publicado e erro estruturado quando houver falha.

Um Webhook Delivery registra cada evento recebido e impede que a mesma entrega seja processada duas
vezes. A chave única de repositório, PR e SHA impede Reviews duplicados quando eventos distintos se
referem ao mesmo commit.

## Restrições de produto

- O produto opera em Advisory Mode: não cria conclusões de falha, não solicita alterações e não bloqueia merge.
- O primeiro formato de publicação é um comentário consolidado por Review Run, para evitar ruído no PR.
- Nesta primeira fatia, o Review Run permanece `queued`; o processador de IA ainda não é executado.
- Todo dado externo é validado na borda antes de entrar na aplicação.
- Credenciais e conteúdo sensível do diff não podem aparecer em logs ou mensagens de erro.

## Evolução orientada por sinais

| Sinal | Próxima decisão |
|-------|-----------------|
| Reinícios ou volume tornam runs locais não confiáveis | Migrar para Postgres e uma fila durável |
| Necessidade de mais de uma réplica | Migrar do SQLite antes de escalar a API |
| A política precisa de gestão sem commits | Adicionar interface web e API de administração |
| Feedback consolidado deixa de ser suficiente | Avaliar comentários inline, mantendo Advisory Mode |
| Equipe decidir bloquear PRs | Criar ADR específica para checks, critérios e rollout |
