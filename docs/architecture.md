# Arquitetura base

## Objetivo

O Codekeat inicia como um **monólito modular**: uma API única, uma interface web independente e um
banco SQLite local. A API recebe eventos do GitHub, coordena Reviews e publica Findings no modo
consultivo. Não há serviços distribuídos, broker de filas ou quality gate bloqueante nesta fase.

## Visão geral

```text
GitHub webhook -> GitHub adapter -> Review module -> fila local -> AI model port -> Gemini adapter
                                         |                               |
                                         v                               v
                              SQLite (runs, findings, policy)      Findings tipados

Web application -------------------------> API interna de leitura e autenticação
```

## Limites

| Área | Responsabilidade | Não deve conhecer |
|------|------------------|-------------------|
| `review` | Orquestrar um Review Run e produzir Findings | Probot, Octokit, Gemini, Drizzle |
| `repository-policy` | Resolver e validar a Repository Policy | Detalhes do modelo de IA |
| `github` | Receber eventos e obter o diff e contexto do PR | Regras de negócio de Review |
| `ai` | Adaptar um provedor de modelo ao contrato de análise | HTTP/GitHub/SQLite |
| `database` | Persistir o estado do Codekeat | Lógica de orquestração |
| `web` | Autenticar pessoas e exibir histórico e detalhes de Reviews | Webhooks, SDKs de IA e SQLite |

O diretório inicial da API deve refletir esses limites em módulos verticais. Código de domínio e
orquestração fica nos módulos; Probot, Octokit, Gemini e Drizzle ficam nos adaptadores nas bordas.
Não criar camadas genéricas, repositórios abstratos ou módulos compartilhados sem variação real.

## Fluxo de um Review

1. Um evento elegível de pull request chega pelo adaptador GitHub.
2. O adaptador deduplica pela entrega e pelo SHA do commit antes de iniciar outro Review Run.
3. A API lê a Repository Policy da branch padrão e persiste o Review Run como `queued`.
4. A fila local agenda o processamento com concorrência global de um, sem atrasar a resposta HTTP.
5. O processador reivindica somente runs `queued`, muda-os para `running` e obtém o PR atual como a Installation.
6. Se o SHA mudou, o run fica `ignored` com `superseded_head_sha`; caso contrário, o diff completo é
   dividido em Review Chunks de até 100.000 caracteres.
7. O provedor de IA recebe os chunks sequencialmente e devolve Findings tipados, localizados em linhas
   adicionadas do respectivo chunk.
8. A API valida, deduplica e persiste todos os Findings e um Review Report pendente com a transição
   atômica para `completed`.
9. A fila atualiza um comentário consultivo único do Codekeat no PR; sem Findings, publica a confirmação
   de que não encontrou problemas concretos.
10. Falhas controladas deixam o run como `failed`, sem persistência parcial de Findings, e falhas de
    publicação ficam no Review Report para nova tentativa em evento futuro.

O handler do webhook não executa análise longa no caminho da resposta HTTP. `p-queue` controla a
concorrência local; ele não é um broker durável. Enquanto SQLite for usado, uma única réplica da API
processa Reviews. Nesta fase, o bootstrap não recupera nem reenfileira runs `queued` que já existiam
antes de um reinício.

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

Um Review Run registra o repositório, número do PR, SHA analisado, status, timestamps, modelo, policy
aplicada e erro estruturado quando houver falha. Finding registra a severidade, caminho, linha adicionada,
título e justificativa; diffs, prompts e respostas brutas não são persistidos. Review Report mantém o
comentário consultivo mais recente de cada PR.

Um Webhook Delivery registra cada evento recebido e impede que a mesma entrega seja processada duas
vezes. A chave única de repositório, PR e SHA impede Reviews duplicados quando eventos distintos se
referem ao mesmo commit. Review Report é único por repositório e PR, preservando um comentário atualizado
em vez de criar ruído a cada commit.

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

## Evolução orientada por sinais

| Sinal | Próxima decisão |
|-------|-----------------|
| Reinícios ou volume tornam runs locais não confiáveis | Migrar para Postgres e uma fila durável |
| Necessidade de mais de uma réplica | Migrar do SQLite antes de escalar a API |
| A política precisa de gestão sem commits | Adicionar interface web e API de administração |
| Relatórios precisam de filtros ou ações administrativas | Ampliar o painel sem expor SQLite ao frontend |
| Equipe decidir bloquear PRs | Criar ADR específica para checks, critérios e rollout |
