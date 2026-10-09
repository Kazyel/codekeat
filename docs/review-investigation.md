# Investigar uma alteração com evidências

A estratégia `evidence-investigation-v8` combina recuperação de fontes, cenários verificáveis e
uma conclusão explícita por unidade. As reviews continuam consultivas. O registro de um cenário
é uma análise do agente apoiada em fontes; testes executáveis e avaliação humana medem sua qualidade.

## Recuperar fontes

`source_search` percorre páginas no host até encontrar o limite de resultados, concluir a varredura
ou atingir o prazo de dez segundos. Retorna posições exatas, estado completo/parcial e continuação.
Uma resposta vazia parcial ou indisponível conserva a incerteza. Quando o prazo termina antes da
primeira página, o cursor nulo significa reiniciar a mesma consulta.

Buscas completas ficam em um Cache Effect de até 256 consultas por catálogo autorizado, por dez
minutos. Consultas simultâneas compartilham o lookup. Resultados incompletos não ficam no cache.
O papel `investigation` é mutável e sempre recebe uma busca nova. A varredura lê até quatro arquivos
independentes por vez e mantém a ordem dos resultados. O backend GitHub conserva seu limite global.

`source_evidence` recebe o arquivo no head, a linha alterada, a posição anterior verificada no diff
e um símbolo opcional. Retorna trechos antes/depois, imports, testes e ocorrências lexicais, com
conteúdo de fontes de apoio prioritárias. As referências restantes e as continuações de cada
trecho permitem aprofundar a leitura. Uma ocorrência lexical exige confirmação do consumidor.

A seleção de função reconhece somente declarações simples com limites identificáveis. Sintaxe
ambígua retorna uma janela de arquivo com lacuna explícita. Cada página informa a revisão,
intervalos e continuação. Os limites de transporte não removem conteúdo dos originais privados.

## Registrar cenários e concluir

Cada hipótese registra arquivo, linha, cenário, comportamento esperado e observado, fontes e
resultado `refuted`, `candidate` ou `unresolved`. Hipóteses resolvidas exigem evidência; hipóteses
não resolvidas exigem lacunas. O agente examina os limites pertinentes ao fluxo, incluindo guardas,
igualdade, zero, estados permitidos pelos validadores e ordem de gravação.

`investigation_checkpoint` registra o progresso e indica as ferramentas necessárias na próxima
etapa. Uma conclusão completa libera a resposta final; uma conclusão incompleta conserva as
lacunas. Evidências inline permitem concluir sem chamadas de leitura adicionais.

A saída estruturada exige `conclusion`. O host valida cobertura dos arquivos reportáveis e aceita
citações somente de arquivos inline enviados ou trechos efetivamente carregados, na revisão correta.
O `before` corresponde ao merge-base, que pode diferir da ponta da branch alvo. Leituras por coluna
precisam cobrir a linha inteira antes de comprovarem uma citação por linha. Cada hipótese candidata
exige um finding no mesmo arquivo e linha; cada finding exige uma hipótese candidata correspondente.
Checkpoints passam por essa validação de fontes antes de desabilitar ferramentas.
O teto de rodadas reserva uma etapa para a resposta estruturada.
O checkpoint final conserva os cenários e as trocas das ferramentas para retomada e auditoria.

Quando a primeira descoberta retorna vazio, uma investigação independente adicional examina
lacunas ou sinais de risco: retorno antecipado em cálculo financeiro, mudança de autorização ou
operações de persistência. Essa chamada recebe os dados originais e uma tarefa específica. Ela
conserva os recibos de consumo, preserva as lacunas anteriores e envia candidatos ao juiz existente.
Os sinais são heurísticos; a avaliação controla o custo e verifica seu benefício.

## Corrigir uma resposta rejeitada

O host distingue revisão incorreta, evidência não entregue, cobertura ausente, localização fora das
linhas alteradas e divergências entre hipóteses candidatas e findings. Os diagnósticos incluem códigos
fixos e posições nos arrays da resposta; não incluem conteúdo privado nos logs. Um checkpoint
recuperável rejeitado devolve `correction_required` e libera novamente as ferramentas de investigação.
Um recibo de fonte malformado permanece uma falha do host e não admite reparação pelo modelo.

Uma resposta final inválida pode receber uma única tentativa de correção, com até duas rodadas de
consulta e uma rodada final sem ferramentas. A tentativa continua o histórico efetivamente enviado
pelo AI SDK, preserva assinaturas do provider e pares de chamadas/resultados, e reutiliza as fontes
já coletadas. A mensagem de correção informa a regra rejeitada. O modelo deve recuperar evidências
faltantes, conservar findings sustentados e explicitar lacunas quando não puder concluir.

A mesma validação de schema, cobertura, localização e proveniência se aplica à resposta corrigida.
Uma segunda rejeição encerra a execução. Cancelamento, falha de uso, transporte, capacidade,
indisponibilidade obrigatória e encerramento do provider por limite ou bloqueio não reiniciam a
investigação. Os limites de admissão, prazos e recibos de consumo abrangem a correção.

Com um catálogo disponível, respostas rejeitadas e seu histórico efetivo são preservados integralmente
em artefatos privados, inclusive na segunda rejeição. O arquivo usa a mesma proteção e retenção das
fontes de investigação. Logs conservam somente o diagnóstico, IDs e número da tentativa. Sem catálogo,
o diagnóstico permanece disponível, mas não há arquivo da resposta. Essa informação permite
investigar a regra concreta sem reconstruir a resposta a partir do consumo ou da duração.

## Manter o contexto entre etapas

Instruções, intenção do PR, documentos compartilhados e manifesto antecedem o contexto específico
da unidade. Esse prefixo estável favorece o cache implícito do provider. A telemetria registra os
tokens cacheados efetivamente informados, sem presumir acertos.

Resultados antigos e grandes de ferramentas de fontes podem virar referências a artefatos exatos.
A compactação conserva os pares de chamadas e respostas, estados incompletos, lacunas e
continuações. Resultados recentes continuam presentes. O agente pode recuperar os originais com
`source_read`; nenhuma fonte é descartada pela compactação.

## Publicar e avaliar

O relatório agrega somente folhas concluídas da geração e publica totais de unidades, arquivos,
cenários e lacunas. Textos privados da investigação permanecem nos checkpoints. Uma review
incompleta informa seu estado; uma review histórica informa que o registro detalhado não existe.
Um checkpoint inválido impede a publicação de uma conclusão baseada nele.

Use [o avaliador de snapshots](review-evaluation.md) para comparar versões com os mesmos casos.
Ele cria execuções novas, preserva fontes e recibos, permite classificação humana e calcula
precisão, recall, duração e custo. O gabarito permanece separado do contexto enviado ao agente.
