# Contexto de revisão

O Codekeat combina a intenção do PR, o diff e o contexto do repositório para avaliar os candidatos.
O diff delimita as linhas reportáveis. Documentos, código completo e consultas MCP permitem investigar
o fluxo afetado e refutar suspeitas antes da publicação.

## Arquivos do repositório

`.codekeat.yml` permanece na raiz e define a Repository Policy. A API lê essa configuração na branch
padrão. O diretório `.codekeat/` contém conhecimento sobre o projeto, lido na revisão analisada.

O carregamento inicial prioriza estes documentos, nesta ordem:

- `.codekeat/README.md`: responsabilidade do repositório, organização, fluxos principais e índice de referências.
- `.codekeat/domain.md`: vocabulário, invariantes e exceções de negócio com referências verificáveis.
- `.codekeat/integrations.md`: produtores, consumidores, contratos e responsabilidade de cada sistema relacionado.

O carregador descobre também arquivos e subdiretórios de `.codekeat/`, validando as entradas retornadas
pelo GitHub. Ele lê o conteúdo textual completo e ignora links simbólicos, submódulos e caminhos que
escapem do diretório solicitado. Diretórios já consultados não são visitados novamente.

Os documentos são opcionais. O carregamento registra arquivos ausentes e não substitui seu conteúdo
por documentos de outra revisão. Referências em documentação não concedem acesso a outros repositórios.

## Revisões e limites

O contexto identifica o repositório de origem do head, o SHA do head e o SHA da base. Documentos e
arquivos alterados são carregados pelo GitHub no SHA do head. Em PRs de forks, a origem
é o repositório do fork. Uma leitura malsucedida não consulta a branch padrão como alternativa.

Documentos, código e respostas MCP não têm cortes por quantidade de caracteres. Todos os caminhos
alterados são carregados uma vez, inclusive arquivos com apenas remoções. Arquivos removidos aparecem
como ausentes no head, e seu diff conserva as linhas anteriores. Quando o GitHub retorna `encoding:
none` para um arquivo grande, uma segunda leitura usa mídia raw no mesmo repositório e SHA. O conteúdo
precisa corresponder ao tamanho declarado e ser texto válido.

O carregador acrescenta imports relativos diretos e testes relacionados cuja existência é confirmada
na listagem do diretório. Ele não percorre indefinidamente o grafo de dependências nem consulta caminhos
fora do repositório. Consultas adicionais usam o manifesto de fontes e as ferramentas de investigação.

Uma resposta HTTP 404 registra `missing`. Outros erros de leitura registram `unavailable`. Esses estados
impedem que uma ausência de evidência seja apresentada como confirmação de comportamento.

Cada trecho de análise conserva o bloco bruto de um arquivo, incluindo metadados Git, cabeçalhos,
hunks e linhas inteiros. Caminhos com escapes Git são decodificados para leituras no GitHub e
localizações de findings. Escapes inválidos ou blocos que não correspondam a um arquivo encerram o
carregamento com erro. A construção acumula as linhas adicionadas em um conjunto local, sem copiar
o conjunto a cada adição. O juiz extrai o hunk completo da mesma representação, preservando as linhas
mesmo quando o arquivo ou hunk é grande.

Cada prompt recebe a descrição completa do PR, os documentos do projeto e o código pertinente ao
arquivo ou aos candidatos analisados. As demais fontes aparecem num manifesto com path, estado,
repositório e revisão. Isso permite recuperar contexto relevante sem repetir todos os arquivos em
todas as chamadas. As regras de revisão ficam no system prompt; os textos externos ficam nos dados.
O pacote inclui relações de imports e testes entre as fontes já carregadas nos dois sentidos. Assim,
um chamador disponível acompanha a função alterada, independentemente da ordem dos arquivos. Uma
fila com caminhos visitados percorre esse grafo em tempo linear, sem novas leituras remotas.

A janela do modelo continua finita. A integração consulta os limites reais do modelo e conta os tokens
do request serializado, incluindo instruções, ferramentas e histórico. Capacidade insuficiente é uma
falha explícita; ela não autoriza cortar uma fonte ou apresentar uma análise parcial como concluída.

## Investigação pelo MCP

Para instalações da Takeat, o modelo dispõe das ferramentas permitidas de código e histórico técnico.
O prompt pede investigação antes dos findings, incluindo chamadores, validações, consumidores e
comparação do comportamento anterior com o novo. A presença das ferramentas não garante que o modelo
as consulte em toda geração.

O AI SDK executa até seis rodadas de ferramentas e reserva uma sétima geração para a resposta
estruturada sem ferramentas. Uma rodada pode pedir várias consultas. O registro serializa a execução
dessas consultas para preservar a ordem das evidências e deduplicar consultas idênticas.

Consultas de outros repositórios devem estar relacionadas à mudança e permanecer no escopo autorizado
da Takeat. Um contrato de API alterado pode justificar consultar seus consumidores. Um documento
genérico sobre o ecossistema não justifica carregar todos os repositórios.

Cada tentativa de geração registra as chamadas MCP e suas respostas completas em memória, com
validação. Gerador e juiz recebem o mesmo conteúdo e os mesmos erros explícitos. Consultas repetidas
com os mesmos argumentos reutilizam a resposta daquela tentativa e não duplicam evidências.
Cada tentativa aceita até 16 consultas distintas. Esse limite e as rodadas de geração limitam a duração
da investigação, sem impor cortes ao conteúdo. O sinal de cancelamento acompanha as chamadas remotas.
O registro acompanha os candidatos até o juiz. Código obtido sem revisão confirmada serve
como contexto histórico e não prova o estado do head. Descrição, documentos, código e respostas MCP
são dados não confiáveis e não podem alterar as permissões ou instruções do agente.

Se o MCP estiver indisponível, a geração é repetida sem ferramentas, preservando o contexto carregado
pelo GitHub. A indisponibilidade aparece no prompt e acompanha os candidatos até o juiz. O modelo pode
reportar um defeito demonstrável no código disponível, mas deve descartar suspeitas que dependam de
conteúdo externo inacessível. O fallback não volta à análise isolada do diff.

## Contexto do juiz

O juiz recebe título, descrição, SHAs, contexto carregado pelo GitHub, evidências do diff e registros
MCP associados aos candidatos. Os lotes contêm até 50 candidatos, sem limite de caracteres nem cortes
nas evidências. Um lote que ultrapasse a capacidade do modelo é dividido entre candidatos inteiros.
Uma evidência indivisível que exceda essa capacidade encerra a execução com erro explícito.
O juiz avalia essas evidências sem executar novas ferramentas. As linhas
adicionadas no diff continuam sendo as únicas localizações permitidas para findings.

Documentos e registros MCP não são persistidos no banco nem enviados aos logs. O resultado conserva
os candidatos e seus julgamentos para auditoria. A estratégia `repository-context-v5` identifica as
execuções com esse contexto. A avaliação de falsos positivos depende de classificação humana, como
descrito em [Eficiência e inteligência dos reviews](roadmap/review-efficiency-intelligence.md).

## Escolha de implementação

`GitHubReviewInputService` entrega um `ReviewInput` com `baseSha` e `repositoryContext`. O carregador
GitHub valida arquivos e diretórios externos, lê fontes completas e mantém o SHA. Uma segunda leitura do PR rejeita mudanças
de head ou base durante a obtenção do diff, antes de carregar contexto.

`GeminiReviewService.review` cria um registro de ferramentas por tentativa e devolve a investigação
junto dos findings. O processor associa esse registro às evidências do chunk. O juiz recebe o mesmo
contexto inicial e os registros correspondentes ao lote. Esse estado não é compartilhado entre PRs.

O AI SDK representa falhas de execução como `tool-error`. O registro conserva a primeira falha
para interromper novas etapas e acionar o fallback somente quando o MCP estiver indisponível.
Respostas inválidas e chamadas rejeitadas continuam sendo falhas explícitas. Cada
`onLanguageModelCallEnd` valida e registra o uso antes da execução das ferramentas. O consumo conhecido
acumula entre tentativas, fallback, arquivos e lotes do juiz, inclusive quando uma etapa posterior falha.
A persistência conserva esse consumo parcial; metadata ausente não permite inventar custo zero exato.

Uma etapa de modelo separada para investigação também foi considerada. Ela garantiria uma fase
distinta antes dos findings, mas acrescentaria chamada, contrato de saída e custo. O pré-carregamento
GitHub fornece contexto antes da geração sem essa etapa. Chamadas MCP determinísticas foram
descartadas porque os parâmetros e recursos de revisão pertencem ao catálogo do servidor, não ao
Codekeat. A investigação adicional permanece uma decisão do modelo.
