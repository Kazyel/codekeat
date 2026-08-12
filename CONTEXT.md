# Codekeat

Codekeat analisa pull requests do GitHub com IA e publica feedback para auxiliar a revisão humana.

## Language

**Review**:
Uma análise de um pull request em uma revisão específica do código.
_Avoid_: Quality gate, approval

**Review Run**:
Uma execução identificável de um Review para um commit específico de um pull request.
_Avoid_: Job, task

**Finding**:
Uma observação acionável produzida por um Review Run concluído, com severidade, caminho, linha adicionada,
título e justificativa.
_Avoid_: Error, verdict

**Review Input**:
O contexto tipado de um Review Run usado pelo Review Model: repositório, PR, SHA, título, descrição e
Review Chunks.
_Avoid_: Payload, prompt

**Review Chunk**:
Um trecho do diff de um Review Input, de no máximo 100.000 caracteres, com o mapeamento de suas linhas
adicionadas. Os trechos são analisados em sequência.
_Avoid_: Batch, page

**Review Model**:
O contrato interno que analisa um Review Input e um Review Chunk e retorna Findings validados. Gemini é
o primeiro adaptador desse contrato.
_Avoid_: Provider, LLM

**Review Report**:
A representação consultiva mais recente de um Review Run concluído para um pull request, publicada como
comentário do Codekeat quando possível.
_Avoid_: Comment, notification

**Dashboard User**:
Uma pessoa autorizada a consultar o painel interno do Codekeat por meio de e-mail e senha.
_Avoid_: GitHub user, account

**Dashboard Session**:
Uma sessão opaca, revogável e com prazo de expiração que identifica um Dashboard User autenticado.
_Avoid_: JWT, login token

**Repository Policy**:
O conjunto de regras que determina o que o Codekeat analisa e como ele apresenta Findings em um repositório.
_Avoid_: Prompt, configuration

**Advisory Mode**:
O modo em que o Codekeat publica feedback sem bloquear, aprovar ou reprovar um pull request.
_Avoid_: Gate mode

**Webhook Delivery**:
Uma entrega identificável de evento do GitHub recebida pelo Codekeat.
_Avoid_: Request, message

**Installation**:
O vínculo entre uma conta GitHub — organização ou perfil pessoal — e o Codekeat que define os repositórios aos quais o produto tem acesso.
_Avoid_: Tenant

**Repository Access**:
O estado que indica se um repositório concedido por uma Installation pode receber Reviews.
_Avoid_: Permission, subscription
