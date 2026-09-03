# Review

O contexto Review executa análises consultivas de pull requests e registra seus resultados sem decidir se um merge pode prosseguir.

## Language

**Review**:
Uma análise de um pull request em uma revisão específica do código.
_Avoid_: Quality gate, approval

**Review Run**:
Uma execução identificável de um Review para um commit específico de um pull request.
_Avoid_: Job, task

**Finding**:
Uma observação acionável produzida por um Review Run concluído, com severidade, caminho, linha adicionada, título e justificativa.
_Avoid_: Error, verdict

**Review Input**:
O contexto tipado de um Review Run usado pelo Review Model: repositório, PR, SHA, título, descrição e Review Chunks.
_Avoid_: Payload, prompt

**Review Chunk**:
Um trecho do diff de um Review Input, de no máximo 100.000 caracteres, com o mapeamento de suas linhas adicionadas. Os trechos são analisados em sequência.
_Avoid_: Batch, page

**Review Model**:
O contrato interno que analisa um Review Input e um Review Chunk e retorna Findings validados. `GeminiReviewService`, em `integrations/gemini`, é a primeira implementação.
_Avoid_: Provider, LLM

**Review Report**:
A representação consultiva mais recente de um Review Run concluído para um pull request, publicada como comentário do Codekeat quando possível.
_Avoid_: Comment, notification

**Advisory Mode**:
O modo em que o Codekeat publica feedback sem bloquear, aprovar ou reprovar um pull request.
_Avoid_: Gate mode

## Implementação

`apps/api/src/features/review` organiza controllers, services, repositories, types, constants, utils e
errors. Outros módulos consomem somente `#features/review`; Gemini e Takeat MCP permanecem em
`apps/api/src/integrations`.
