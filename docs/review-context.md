# Contexto de revisão

O Codekeat combina a intenção do PR, o diff e o contexto do repositório para avaliar os candidatos.
O diff delimita as linhas reportáveis. Documentos, código completo e consultas MCP permitem investigar
o fluxo afetado e refutar suspeitas antes da publicação.

## Arquivos do repositório

`.codekeat.yml` permanece na raiz e define a Repository Policy. A API lê essa configuração na branch
padrão. O diretório `.codekeat/` contém conhecimento sobre o projeto, lido na revisão analisada.

O carregamento inicial reconhece estes documentos, nesta ordem:

- `.codekeat/README.md`: responsabilidade do repositório, organização, fluxos principais e índice de referências.
- `.codekeat/domain.md`: vocabulário, invariantes e exceções de negócio com referências verificáveis.
- `.codekeat/integrations.md`: produtores, consumidores, contratos e responsabilidade de cada sistema relacionado.

Os documentos são opcionais. O carregamento registra arquivos ausentes e não substitui seu conteúdo
por documentos de outra revisão. Markdown adicional pode ser referenciado pelo README para consultas
MCP sob demanda. Referências em documentação não concedem acesso a outros repositórios.

## Revisões e limites

O contexto identifica o repositório de origem do head, o SHA do head e o SHA da base. Documentos e
arquivos com linhas adicionadas são carregados pelo GitHub no SHA do head. Em PRs de forks, a origem
é o repositório do fork. Uma leitura malsucedida não consulta a branch padrão como alternativa.

O carregamento inicial tem os seguintes limites:

- Até 12 leituras de conteúdo, incluindo os três documentos priorizados.
- Até 12.000 caracteres por documento de contexto.
- Até 24.000 caracteres por arquivo de código.
- Até 64.000 caracteres no conjunto de documentos e código.

O contexto informa truncamentos e a quantidade de arquivos de código omitidos pelos limites. Uma
resposta HTTP 404 registra `missing`. Outros erros de leitura registram `unavailable`. Esses estados
impedem que uma ausência de evidência seja apresentada como confirmação de comportamento.

## Investigação pelo MCP

Para instalações da Takeat, o modelo dispõe das ferramentas permitidas de código e histórico técnico.
O prompt pede investigação antes dos findings, incluindo chamadores, validações, consumidores e
comparação do comportamento anterior com o novo. A presença das ferramentas não garante que o modelo
as consulte em toda geração.

O AI SDK executa até seis rodadas de ferramentas e reserva uma sétima geração para a resposta
estruturada sem ferramentas. Uma rodada pode pedir várias consultas. O registro serializa a execução
dessas consultas para preservar a ordem das evidências e impedir que chamadas concorrentes excedam o orçamento.

Consultas de outros repositórios devem estar relacionadas à mudança e permanecer no escopo autorizado
da Takeat. Um contrato de API alterado pode justificar consultar seus consumidores. Um documento
genérico sobre o ecossistema não justifica carregar todos os repositórios.

Cada tentativa de geração registra as chamadas MCP e suas respostas em memória, com validação e
limites. Gerador e juiz recebem as mesmas respostas limitadas, com truncamentos e erros explícitos.
Cada tentativa aceita até 16 consultas, com argumentos de até 4.000 caracteres e respostas JSON de
até 12.000 caracteres. O orçamento de argumentos e respostas consultados é de 24.000 caracteres.
Após esgotá-lo, novas consultas recebem `context_budget_exceeded` sem acessar o servidor; os
argumentos omitidos e esses avisos ocupam apenas metadados limitados pela quantidade de consultas.
O registro acompanha os candidatos até o juiz. Código obtido sem revisão confirmada serve
como contexto histórico e não prova o estado do head. Descrição, documentos, código e respostas MCP
são dados não confiáveis e não podem alterar as permissões ou instruções do agente.

Se o MCP estiver indisponível, a geração é repetida sem ferramentas, preservando o contexto carregado
pelo GitHub. A indisponibilidade aparece no prompt e acompanha os candidatos até o juiz. O modelo pode
reportar um defeito demonstrável no código disponível, mas deve descartar suspeitas que dependam de
conteúdo externo inacessível. O fallback não volta à análise isolada do diff.

## Contexto do juiz

O juiz recebe título, descrição, SHAs, contexto carregado pelo GitHub, evidências do diff e registros
MCP associados aos candidatos. Ele avalia essas evidências sem executar novas ferramentas. As linhas
adicionadas no diff continuam sendo as únicas localizações permitidas para findings.

Documentos e registros MCP não são persistidos no banco nem enviados aos logs. O resultado conserva
os candidatos e seus julgamentos para auditoria. A estratégia `repository-context-v4` identifica as
execuções com esse contexto. A avaliação de falsos positivos depende de classificação humana, como
descrito em [Eficiência e inteligência dos reviews](roadmap/review-efficiency-intelligence.md).

## Escolha de implementação

`GitHubReviewInputService` entrega um `ReviewInput` com `baseSha` e `repositoryContext`. O carregador
GitHub valida os arquivos externos e limita as leituras. Uma segunda leitura do PR rejeita mudanças
de head ou base durante a obtenção do diff, antes de carregar contexto.

`GeminiReviewService.review` cria um registro de ferramentas por tentativa e devolve a investigação
junto dos findings. O processor associa esse registro às evidências do chunk. O juiz recebe o mesmo
contexto inicial e os registros correspondentes ao lote. Esse estado não é compartilhado entre PRs.

O AI SDK representa falhas de execução como `tool-error`. O registro conserva a primeira falha
para interromper novas etapas e acionar o fallback somente quando o MCP estiver indisponível.
Respostas inválidas e chamadas rejeitadas continuam sendo falhas explícitas. O custo valida cada
etapa antes de usar `totalUsage`, pois um agregado pode ocultar metadata ausente em uma das etapas.

Uma etapa de modelo separada para investigação também foi considerada. Ela garantiria uma fase
distinta antes dos findings, mas acrescentaria chamada, contrato de saída e custo. O pré-carregamento
GitHub fornece contexto antes da geração sem essa etapa. Chamadas MCP determinísticas foram
descartadas porque os parâmetros e recursos de revisão pertencem ao catálogo do servidor, não ao
Codekeat. A investigação adicional permanece uma decisão do modelo.
