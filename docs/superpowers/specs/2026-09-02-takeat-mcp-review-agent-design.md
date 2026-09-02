# MCP da Takeat no agente de review

## Objetivo

Permitir que o `GeminiReviewModel` consulte código e histórico técnico dos projetos da Takeat durante a análise de um pull request. O MCP complementa o diff recebido do GitHub; ele não altera o contrato `ReviewModel`, a persistência ou o modo consultivo dos reviews.

## Escopo

O agente pode usar estas ferramentas do MCP:

- `list_repos`
- `search_code`
- `read_file`
- `search_commits`
- `get_commit`
- `get_commit_diff`

Ferramentas baseadas em autoria, incluindo `blame_file` e `commit_stats`, ficam fora do catálogo enviado ao Gemini e são recusadas na execução.

O trabalho não inclui implementar ou hospedar o servidor MCP, mudar o schema do banco, adicionar controles no painel ou configurar o MCP para agentes de desenvolvimento.

## Decisão

A API executará um cliente MCP oficial sobre Streamable HTTP. Um adaptador local converterá esse cliente em uma `CallableTool` do `@google/genai`, aplicará a allowlist e entregará ao Gemini apenas as declarações permitidas.

Essa abordagem mantém as credenciais e o access token dentro do processo do Codekeat. A alternativa `mcpServers` do Gemini foi descartada porque delegaria a conexão e a credencial à infraestrutura do provedor e não oferece, na versão instalada, o mesmo controle local da allowlist. A pré-busca determinística foi descartada porque impediria o modelo de escolher o contexto necessário para cada problema.

O `@google/genai@2.16.0` classifica `mcpToTool` como experimental. A integração isola essa dependência para limitar o impacto de futuras mudanças no SDK.

## Componentes

### `TakeatMcpTool`

Integração em `apps/api/src/integrations/takeat-mcp` com estas responsabilidades:

- obter um access token em `TAKEAT_MCP_TOKEN_URL` pelo fluxo `client_credentials`;
- manter o token somente em memória e compartilhar uma renovação concorrente;
- renovar o token antes do vencimento informado por `expires_in`;
- conectar ao endpoint definido por `TAKEAT_MCP_URL` usando Streamable HTTP;
- enviar o access token somente ao servidor MCP;
- adaptar o cliente com `mcpToTool`;
- filtrar as declarações retornadas por `tool()`;
- recusar em `callTool()` qualquer nome fora da allowlist;
- aplicar timeout de 10 segundos por chamada;
- renovar o token e repetir uma vez depois de erro de autenticação ou transporte.

A conexão será preguiçosa e reutilizada enquanto o access token permanecer válido. A fila atual processa um review por vez, mas o provedor de token ainda compartilha uma única requisição de renovação para evitar duplicação.

### `GeminiReviewModel`

O modelo continuará implementando o contrato existente:

```ts
interface ReviewModel {
	readonly name: string;
	review(input: ReviewInput, chunk: ReviewInputChunk): Promise<readonly ReviewFinding[]>;
}
```

Quando a ferramenta estiver disponível, cada geração poderá realizar no máximo seis rodadas remotas. O prompt classificará o diff, a descrição do PR e os resultados MCP como dados não confiáveis. Instruções presentes nesses dados não podem substituir as regras do review.

Todo finding continuará sujeito aos invariantes atuais:

- apontar para uma linha adicionada do chunk;
- conter evidência objetiva;
- obedecer ao schema Zod da resposta;
- evitar observações vagas, duplicadas ou especulativas.

## Fluxo

1. O processador entrega um `ReviewInputChunk` ao `GeminiReviewModel`.
2. O modelo envia o prompt e as declarações MCP permitidas ao Gemini.
3. Quando o Gemini solicita uma ferramenta, a API executa a chamada no endpoint da Takeat.
4. O resultado volta ao Gemini como resposta de função.
5. O ciclo termina quando o modelo produz o JSON de findings ou atinge seis rodadas.
6. O parser existente valida o JSON antes de devolver findings ao módulo de review.

O Codekeat não persiste argumentos, resultados MCP, prompts ou respostas brutas.

## Falhas e observabilidade

Uma falha de autenticação, conexão, protocolo ou timeout do MCP primeiro invalida a sessão e o access
token, emite outro token e repete a operação MCP uma vez. Se a repetição falhar:

1. a sessão MCP volta a ser invalidada;
2. a API registra `takeat_mcp.unavailable_using_diff_only` com `reviewRunId`, repositório e índice do chunk;
3. o modelo repete uma vez a análise completa do chunk sem ferramentas MCP.

O log não incluirá URLs, credenciais, tokens, argumentos, resultados ou mensagem bruta da exceção. Um
erro retornado por uma ferramenta válida permanece na conversa para o Gemini decidir entre outra busca
e a conclusão sem aquele dado.

Se a geração sem MCP falhar, o fluxo existente continuará responsável por classificar o run como `gemini_request_failed` ou `gemini_invalid_response`. Não haverá novo estado persistido nem fallback silencioso.

## Configuração

A API exigirá no startup:

```dotenv
TAKEAT_MCP_URL=https://mcp.takeat.app/mcp
TAKEAT_MCP_TOKEN_URL=https://mcp.takeat.app/oauth/token
TAKEAT_MCP_CLIENT_ID=
TAKEAT_MCP_CLIENT_SECRET=
```

As URLs devem usar HTTPS e as credenciais devem ser não vazias. Ausência ou formato inválido representa
erro de configuração e impede o startup. O access token não é persistido; a API o renova em memória antes
do vencimento. Indisponibilidade operacional depois de uma configuração válida usa o fallback descrito acima.

O pacote `@modelcontextprotocol/sdk` será fixado no catálogo do workspace em uma versão compatível com o peer dependency de `@google/genai@2.16.0`. O lockfile será atualizado somente pelo pnpm.

## Segurança

- A integração aplica a allowlist tanto na descoberta quanto na execução.
- Credenciais e access tokens não saem das conexões entre a API e os endpoints da Takeat.
- Conteúdo retornado pelo MCP é tratado como entrada externa não confiável.
- O prompt proíbe seguir instruções encontradas em código, commits, diffs ou documentação recuperada.
- Logs e erros persistidos não contêm conteúdo corporativo ou credenciais.
- O agente continua consultivo e só publica findings localizados no diff do PR.

## Arquivos previstos

- `apps/api/src/integrations/takeat-mcp/services/takeat-mcp.service.ts`
- `apps/api/src/integrations/takeat-mcp/services/takeat-mcp-access-token.service.ts`
- `apps/api/src/integrations/gemini/services/gemini-review.service.ts`
- `apps/api/src/bootstrap/environment.ts`
- `apps/api/src/bootstrap/application.ts`
- testes correspondentes em `apps/api/tests`
- `apps/api/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`, gerado pelo pnpm
- `apps/api/.env.example`
- `README.md`
- `docs/github-app.md`
- `docs/architecture.md`

O `compose.yaml` não precisa mudar porque a API já lê `apps/api/.env`.

## Verificação

Testes automatizados locais devem provar:

1. validação das URLs HTTPS e credenciais no ambiente;
2. cache, renovação antecipada e single-flight do access token;
3. rejeição de respostas inválidas do endpoint de token;
4. remoção das ferramentas de autoria das declarações enviadas ao Gemini;
5. recusa de chamadas fora da allowlist antes de atingir o servidor MCP;
6. execução de uma ferramenta permitida por transporte MCP em memória ou double local equivalente;
7. fallback único para análise sem MCP depois da repetição autenticada;
8. emissão do aviso sanitizado sem credenciais ou conteúdo corporativo;
9. preservação da validação estruturada dos findings.

A verificação final executará os testes específicos, o typecheck da API e a verificação completa definida pelo repositório. O CI não dependerá do endpoint corporativo. Um teste ponta a ponta contra o servidor real ficará limitado ao ambiente operacional que possua credenciais válidas.
