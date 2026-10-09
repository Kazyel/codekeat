# Contexto de revisão

A estratégia `repository-context-v6` combina intenção do PR, diff completo, fontes do repositório e
investigação pelo modelo. As linhas adicionadas delimitam onde um finding pode ser publicado. Código,
descrição, documentação e respostas externas são dados não confiáveis; não alteram as instruções nem
as permissões do agente.

## Fontes e proveniência

`.codekeat.yml` continua definindo a política na branch padrão. `.codekeat/` contém conhecimento da
revisão analisada. Use README.md para organização e fluxos, domain.md para invariantes e exceções, e
integrations.md para produtores, consumidores e contratos. Inclua referências verificáveis ao código.

O catálogo nativo existe para todas as instalações autorizadas. Gerador e juiz dispõem de listagem,
leitura, busca e descoberta de arquivos relacionados. As fontes distinguem `head`, `before`,
`pull_request` e `investigation`. `before` corresponde ao merge-base congelado, e não ao estado atual
da branch de destino. PRs de forks conservam a origem do head. Falhas nunca consultam a branch padrão
como alternativa. Symlinks e submódulos aparecem explicitamente como fontes não suportadas.

A árvore GitHub usa SHA; uma árvore recursiva truncada exige percorrer as árvores não recursivas.
Leituras de blobs usam identidade e revisão congeladas. Páginas conservam hash, origem, posição e
continuação. Linhas muito longas podem ser consultadas por colunas UTF16 com fim exclusivo. O conteúdo
não é cortado silenciosamente, e uma busca paginada não apresenta seu resultado parcial como completo.

O carregamento inicial seleciona arquivos inteiros conforme um orçamento estimado derivado da
capacidade do modelo. Fontes disponíveis apenas no catálogo têm estado próprio, sem serem marcadas
como ausentes. A seleção permite manter documentos e arquivos pertinentes no prompt de PRs pequenos,
sem baixar todo o repositório antes da análise. O preflight do Google conta o request serializado
completo e é a autoridade final sobre a capacidade.

Descrição e diffs completos permanecem acessíveis no catálogo. Tentativas usam prompt inline,
prompt com contexto sob demanda e, quando necessário, referências ao pacote integral. O modo de
referências exige leitura completa do artefato do pacote antes de aceitar a resposta. Uma ferramenta
ter sido chamada não basta para comprovar essa leitura.

## Investigação e julgamento

Para a Takeat, as ferramentas MCP complementam o catálogo nativo com código e histórico técnico do
ecossistema. O agente deve consultar somente fontes relacionadas à mudança e permitidas pela
instalação ou pelo MCP. Código sem SHA confirmado serve como evidência histórica, não como prova do
head. Respostas MCP completas viram artefatos consultáveis; o prompt recebe referências em vez de
repetir grandes payloads em cada chamada.

O juiz pode investigar novamente. Ele recebe candidatos, hunks e registros da investigação original,
com as mesmas fontes congeladas. Os lotes contêm até 50 candidatos, sem cortar uma evidência por
caracteres. Lotes que excedem a capacidade são subdivididos entre candidatos inteiros.

Tentativas com catálogo permitem até doze rodadas de ferramentas; o caminho legado de MCP permite
seis. Esses limites e os prazos continuam finitos. Evidência não lida ou unidade indivisível que não
caiba produz falha explícita, preservando checkpoints. Não há garantia de qualidade independente do
volume ou da indisponibilidade das fontes. A avaliação de falsos positivos ainda depende de exemplos
classificados por humanos.

## Planejamento, cobertura e retomada

O planejador agrupa diffs pequenos de arquivos próximos. A estimativa decide como empacotar; o
preflight considera instruções, ferramentas, histórico e schema reais. Uma falha de capacidade ou
leitura incompleta permite subdividir grupos, arquivos, hunks e janelas de linhas. Os cabeçalhos das
janelas preservam as coordenadas originais. Adições, remoções e contexto continuam disponíveis.

Planos e unidades ficam em SQLite. O fingerprint inclui base, head, repositório, título, descrição,
diffs, contexto inicial, modelo e versão da estratégia. Uma mudança nessa identidade invalida as
unidades anteriores. Consumo pago continua preservado. Pais subdivididos deixam de contar como
unidades executáveis; seus filhos passam a representar o trabalho restante.

Cada unidade registra seu resultado somente depois de validar a resposta. Tentativas seguintes
reutilizam as unidades concluídas. Antes do julgamento, a API verifica cobertura de arquivos, linhas
alteradas e conteúdo do diff. O relatório só é criado depois de todas as unidades e todos os
julgamentos terminarem. Cobertura significa que o trabalho foi processado; não prova que o modelo
identificou todos os bugs.

O prazo de cinco minutos cobre cada chamada HTTP do modelo após admissão, incluindo o corpo da
resposta. Esperas por quota e concorrência continuam sujeitas à fatia do processor. O prazo de trinta minutos passa a ser
uma fatia de execução: a API libera o run para a fila e retoma checkpoints. Na inicialização, claims
interrompidos voltam à fila. Relatórios pendentes e publicações interrompidas também são recuperados;
a publicação usa o marcador GitHub existente para evitar comentários duplicados.

Recibos de uso e agregados do run são gravados na mesma transação, antes de validar a resposta ou
executar ferramentas. A chave run/etapa/chamada/passo deduplica notificações. Metadata ausente permanece
desconhecida. Isso reduz perda de contabilização em interrupções, mas um processo morto antes de
receber a resposta do provider não pode registrar consumo que nunca observou.

## Privacidade e armazenamento

Checkpoints privados contêm evidência necessária para retomar o trabalho. Os artefatos completos
ficam em `review-artifacts/` ao lado do banco, em diretórios 0700 e arquivos 0600. O volume persistente
precisa acompanhar backups e recuperação do banco. Os artefatos não expiram automaticamente enquanto
forem necessários à retomada. Planeje armazenamento conforme a retenção das reviews.

Código, descrição, argumentos e respostas privadas não aparecem nos logs nem nos endpoints de
telemetria. O dashboard recebe metadados operacionais, candidatos e julgamentos.

## Limites compartilhados e medição

`REVIEW_CONCURRENCY` limita PRs simultâneos, com padrão cinco. `REVIEW_UNIT_CONCURRENCY` limita unidades
por PR, com padrão dois. `REVIEW_MODEL_CONCURRENCY` limita chamadas reais Google compartilhadas por
gerador e juiz, com padrão cinco. Publicações continuam serializadas. SQLite exige uma única réplica
API para que a recuperação de claims seja segura.

`GOOGLE_REQUESTS_PER_MINUTE` e `GOOGLE_INPUT_TOKENS_PER_MINUTE` são limites locais opcionais. Configure-os
conforme a quota do projeto; metadata do modelo não informa essa quota. O guard reserva chamadas e
tokens de entrada para cada request real, incluindo retries e rodadas de ferramentas. Entrada já
cacheada também entra no orçamento local. Metadata e countTokens ficam fora do orçamento de geração.
Retry-After em 429 bloqueia novas admissões, com cancelamento. O AI SDK permanece o único dono dos
retries de geração.

Contagens idênticas compartilham cache de 256 entradas por dez minutos; metadata válida usa TTL de uma
hora. Os caches conservam hashes e contagens. O catálogo conserva referências a blobs em disco e
isola o escopo por run. Leituras GitHub mantêm limites de quatro por catálogo e dezesseis no processo.

A telemetria registra fila, entrada, preparação, contagem, geração, ferramentas e juiz. Endpoints
`/api/v1/review-telemetry` e `/api/v1/review-telemetry/:runId` exigem o token do dashboard. Eventos têm
paginação explícita. Agregados mostram P50/P95 por período, fase, tipo de medição e faixa de tamanho do
diff. Etapas completas e operações internas têm séries separadas, para evitar somar tempos
sobrepostos. Memória RSS pertence ao processo compartilhado, e não à alocação exclusiva de um PR.

Métricas de velocidade e custo não substituem avaliação de precisão. A configuração inicial mantém
um modelo único, paralelismo moderado e deduplicação. Trocas de modelo e aumentos de concorrência
precisam considerar as amostras reais e a qualidade dos achados. Veja a
[pesquisa de escala](roadmap/review-context-scale-research.md) e o
[plano de avaliação](roadmap/review-efficiency-intelligence.md).
