# Catálogo de modelos e custo por review

## Objetivo

Remover `GEMINI_MODEL` da configuração de ambiente e permitir que administradores gerenciem, pelo dashboard, o catálogo global de modelos Gemini usado nas reviews. Cada review deve preservar o modelo, as tarifas e o custo calculado no momento em que o run é criado.

`GOOGLE_API_KEY` permanece no ambiente porque contém uma credencial. O catálogo guarda somente metadados públicos e tarifas.

## Escopo

O trabalho inclui:

- tabela global de modelos;
- catálogo inicial de modelos Gemini estáveis compatíveis com function calling e structured output;
- criação, edição, habilitação, desabilitação e seleção pelo dashboard;
- endpoints autenticados para essas operações;
- snapshot do modelo e das tarifas em cada novo `review_run`;
- remoção do modelo e das tarifas fixas do ambiente e do código.

O trabalho não inclui modelos de imagem, áudio, vídeo ou preview, preços Batch, Flex ou Priority, consumo de grounding, tarifa de armazenamento de cache ou preços por faixa de contexto.

## Catálogo inicial

A migration cadastrará estes modelos e preços Standard pagos por 1 milhão de tokens, conforme a documentação oficial do Gemini consultada em 3 de setembro de 2026:

| Identificador           |  Entrada | Entrada em cache |    Saída | Selecionado inicialmente |
| ----------------------- | -------: | ---------------: | -------: | ------------------------ |
| `gemini-3.8-flash`      | US$ 0,75 |        US$ 0,075 | US$ 3,75 | sim                      |
| `gemini-3.7-flash`      | US$ 0,75 |        US$ 0,075 | US$ 3,75 | não                      |
| `gemini-3.6-flash`      | US$ 0,75 |        US$ 0,075 | US$ 3,75 | não                      |
| `gemini-3.5-flash`      | US$ 1,50 |         US$ 0,15 | US$ 9,00 | não                      |
| `gemini-3.5-flash-lite` | US$ 0,30 |         US$ 0,03 | US$ 2,50 | não                      |
| `gemini-3.1-flash-lite` | US$ 0,25 |        US$ 0,025 | US$ 1,50 | não                      |

Fontes:

- [Catálogo de modelos Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Preços da Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing)

A tabela de preços informa que as tarifas de Gemini 3.8, 3.7 e 3.6 Flash dobrarão em 1º de janeiro de 2027. O catálogo começa com as tarifas vigentes. Um administrador deverá atualizar os valores antes dessa data; o snapshot impede que essa atualização altere custos históricos ou reviews já enfileiradas.

## Persistência

### Tabela `models`

A tabela terá:

- `id`: UUID;
- `display_name`: nome apresentado no dashboard;
- `api_name`: identificador único enviado ao Gemini;
- `input_nano_usd_per_token`: tarifa de entrada;
- `cached_input_nano_usd_per_token`: tarifa de entrada em cache;
- `output_nano_usd_per_token`: tarifa de saída, incluindo thinking tokens;
- `enabled`: disponibilidade para seleção;
- `selected`: indicação do modelo global usado em novos runs;
- `created_at` e `updated_at`.

Um índice único parcial em `selected = 1` garante no máximo uma seleção. A migration insere um modelo selecionado, e a API impede que o sistema fique sem seleção. A troca de modelo ocorre em uma transação que remove a seleção anterior e seleciona um modelo habilitado.

A API não apaga linhas. Desabilitar substitui exclusão física para preservar referências e histórico. O modelo selecionado não pode ser desabilitado; o administrador precisa selecionar outro antes.

### Snapshot em `review_runs`

Cada novo run copiará:

- `model_id`;
- `model_name`;
- `model_input_nano_usd_per_token`;
- `model_cached_input_nano_usd_per_token`;
- `model_output_nano_usd_per_token`.

O processador usa somente esse snapshot. Alterar o catálogo não afeta runs existentes, inclusive os que ainda aguardam na fila. Reenfileirar o mesmo run preserva a configuração; uma nova SHA cria outro run e captura a seleção vigente.

A migration mantém `cost_usd_micros` como valor histórico autoritativo para runs concluídos. Ela associa dados antigos ao modelo sem recalcular custos e preenche runs não concluídos com Gemini 3.8 Flash, o único modelo aceito pelo código atual. As novas colunas permanecem compatíveis com registros históricos que não possuam todos os metadados.

## Fluxo de review

1. O webhook resolve a política do repositório.
2. `requestReview` lê o modelo global selecionado.
3. O repositório grava o run e o snapshot do modelo na mesma operação lógica antes de enfileirar o trabalho.
4. O processador reivindica o run e recebe os dados do modelo junto aos demais dados executáveis.
5. `GeminiReviewService` envia `model_name` ao SDK e calcula o uso de cada chunk com as tarifas capturadas.
6. O processador soma tokens e custos dos chunks e persiste `cost_usd_micros` ao concluir.

A ausência de um modelo selecionado representa violação de configuração e impede a criação do run. O código não escolhe um fallback silencioso.

## API

A API exporá:

- `GET /api/v1/models`: lista o catálogo e a seleção;
- `POST /api/v1/models`: cria um modelo habilitado ou desabilitado;
- `PATCH /api/v1/models/:id`: altera nome, identificador, tarifas ou disponibilidade;
- `POST /api/v1/models/:id/select`: seleciona um modelo habilitado.

Todos os endpoints exigem o bearer interno já usado pelo dashboard e uma sessão válida do usuário. `admin` e `member` podem consultar. Somente `admin` pode executar mutações.

O backend Next.js enviará o token da sessão no header `x-dashboard-session`. A API validará esse header com `DashboardAuthService`; nenhum endpoint de catálogo aceitará papel informado pelo cliente.

O controller valida payloads externos com Zod. `api_name` deve começar com `gemini-`; nomes devem conter texto; tarifas devem ser inteiros não negativos em nano-USD por token. O dashboard converte esses inteiros para valores em USD por 1 milhão de tokens sem arredondamento implícito.

Respostas de erro:

- `400`: payload ou tarifa inválida;
- `401`: bearer ou sessão ausente, inválida ou expirada;
- `403`: usuário autenticado sem papel de administrador;
- `404`: modelo inexistente;
- `409`: identificador duplicado, tentativa de desabilitar o selecionado ou outra violação de estado.

O endpoint não consulta o Gemini para testar um identificador. O administrador pode cadastrar um modelo estável futuro, mas deve informar um modelo compatível com function calling, structured output e tarifa Standard plana.

## Dashboard

A página `/dashboard/models` ficará acessível pela navegação do dashboard. Ela mostrará:

- nome e identificador de cada modelo;
- estado habilitado ou desabilitado;
- modelo selecionado;
- tarifas de entrada, cache e saída em USD por 1 milhão de tokens.

Administradores terão formulários para criar, editar, habilitar, desabilitar e selecionar. Membros verão os mesmos dados sem controles de mutação. Os formulários serão processados no servidor Next.js; o navegador não receberá `DASHBOARD_API_TOKEN`, e o token de sessão continuará em cookie `HttpOnly`.

Depois de cada mutação válida, o servidor redirecionará para a página do catálogo e recarregará os dados. Erros esperados aparecerão na página sem expor payloads internos ou tokens.

## Segurança e concorrência

A API validará o bearer de serviço e a sessão do usuário. A checagem de papel ocorrerá na API, não somente na interface. Logs não incluirão o token de sessão, o bearer ou o corpo bruto da requisição.

A seleção roda em transação SQLite. O índice parcial protege a unicidade mesmo que duas solicitações concorram. A restrição atual de uma réplica da API continua válida enquanto o sistema usa SQLite.

## Migração de configuração

A implementação removerá:

- `GEMINI_MODEL` do schema e do tipo de ambiente;
- `GEMINI_MODEL` de `apps/api/.env.example`;
- `GEMINI_MODEL_NAME` e as três constantes de tarifa;
- o argumento de nome do modelo criado no bootstrap.

A API continuará exigindo `GOOGLE_API_KEY`.

## Verificação

Testes automatizados devem provar:

1. seed dos seis modelos e seleção única do Gemini 3.8 Flash;
2. listagem para membro e administrador;
3. recusa de mutações para membro ou sessão inválida;
4. criação e edição com validação de identificador e tarifas;
5. seleção transacional de um modelo habilitado;
6. recusa ao desabilitar o selecionado e ao duplicar identificadores;
7. snapshot do modelo e das tarifas na criação do run;
8. preservação do snapshot após edição do catálogo e reenfileiramento;
9. cálculo do custo com as tarifas do run;
10. ausência de `GEMINI_MODEL` na validação de ambiente.

A verificação executará os testes específicos durante a implementação e, ao final, `pnpm check && pnpm typecheck && pnpm test && pnpm build`. O dashboard será exercitado no navegador com um usuário administrador e um membro, cobrindo mutação, modo somente leitura e persistência após recarregar a página.
