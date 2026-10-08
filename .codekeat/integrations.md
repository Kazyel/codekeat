# Integrações do Codekeat

## GitHub

A GitHub App recebe webhooks, consulta pull requests e conteúdo dos repositórios e publica comentários
via Issues API. `ALLOWED_GITHUB_ACCOUNTS` restringe as contas processadas. Instalações e repositórios
conectados são registrados pela API para controlar o acesso.

[GitHubReviewInputService](../apps/api/src/features/github/services/github-review-input.service.ts)
traduz o PR para o contrato de Review. A policy é lida na branch padrão. O contexto usa o repositório
de origem e o SHA do head, inclusive em PRs de forks. Os dois tipos de leitura têm finalidades diferentes.

[GitHubReviewPublicationService](../apps/api/src/features/github/services/github-review-publication.service.ts)
publica o relatório como comentário consultivo. Permissões operacionais estão em
[docs/github-app.md](../docs/github-app.md).

## Gemini

[GeminiReviewService](../apps/api/src/integrations/gemini/services/gemini-review.service.ts) implementa
os contratos de geração e julgamento de Review. O modelo e suas tarifas vêm do catálogo da API e
ficam registrados no run. Respostas externas são validadas antes de se tornarem findings ou julgamentos.

A integração usa `ai` e `@ai-sdk/google`, com `generateText` e `Output.object` sobre schemas Zod.
Geração e julgamento mantêm thinking alto, seed 1 e temperatura 0. O custo usa os tokens de todas
as etapas da geração, incluindo cache, prompts de ferramentas e raciocínio, sem somar reasoning duas vezes.

A geração pode executar consultas MCP. O juiz recebe as evidências produzidas na geração, sem
ferramentas próprias. Credenciais do GitHub e do MCP não são enviadas ao modelo.

## Takeat MCP

A integração usa OAuth para obter access tokens. O cache Effect mantém tokens em memória, renova antes
da expiração e compartilha requisições concorrentes. Uma rejeição atrasada invalida somente o token rejeitado.
[TakeatMcpTool](../apps/api/src/integrations/takeat-mcp/services/takeat-mcp.service.ts) filtra o catálogo
e as chamadas. As ferramentas permitidas são `get_commit`, `get_commit_diff`, `list_repos`, `read_file`,
`search_code` e `search_commits`.

O SDK MCP oficial abre uma sessão por operação. `Effect.acquireUseRelease` encerra a sessão remota e
garante o fechamento local também quando a conexão falha. Operações, encerramento e fechamento têm
prazos individuais de 10 segundos. Uma rejeição de autenticação
401 permite uma renovação e uma repetição. Outras falhas não renovam as credenciais.

O MCP é disponibilizado somente para a instalação da organização Takeat configurada na integração.
Consultas a repositórios relacionados precisam ter relação com o contrato alterado no PR. Este
repositório não contém um mapa confirmado dos sistemas de negócio da Takeat.

Resultados MCP são evidências externas não confiáveis. Código sem revisão confirmada descreve
contexto histórico e não comprova o estado do head. Consultas e respostas usadas na geração seguem
para o juiz em memória, sem persistência ou conteúdo nos logs.

Se o MCP estiver indisponível, a geração é repetida sem ferramentas, mantendo o contexto do GitHub.
A indisponibilidade é explícita na geração e no julgamento. Suspeitas que dependam do conteúdo
inacessível não devem ser publicadas.

## Painel e banco

O painel consulta a API e não acessa SQLite diretamente. A API controla sessões de dashboard e
valida senhas com Argon2id. O token interno entre aplicações é independente da sessão da pessoa.

`packages/database` fornece os schemas e migrations Drizzle usados pela API. Enquanto o banco for
SQLite, a implantação precisa de uma única réplica da API. Não há broker de filas nem transação
distribuída com GitHub: falhas de publicação são registradas no Review Report para outra tentativa.
