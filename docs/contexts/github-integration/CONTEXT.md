# GitHub Integration

O contexto GitHub Integration representa o vínculo do Codekeat com o GitHub, os repositórios acessíveis e as entregas de eventos recebidas.

## Language

**Webhook Delivery**:
Uma entrega identificável de evento do GitHub recebida pelo Codekeat.
_Avoid_: Request, message

**Installation**:
O vínculo entre uma conta GitHub, organização ou perfil pessoal, e o Codekeat que define os repositórios aos quais o produto tem acesso.
_Avoid_: Tenant

**Repository Access**:
O estado que indica se um repositório concedido por uma Installation pode receber Reviews.
_Avoid_: Permission, subscription

## Implementação

`apps/api/src/features/github` separa controllers de webhook, services GitHub, repositories de acesso
e entrega, types, constants e utils. Outros módulos consomem somente `#features/github`.
