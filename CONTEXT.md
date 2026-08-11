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
Uma observação acionável produzida por um Review, com localização, severidade e justificativa.
_Avoid_: Error, verdict

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
