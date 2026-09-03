# Dashboard Identity

O contexto Dashboard Identity identifica e autentica as pessoas autorizadas a consultar o painel interno do Codekeat.

## Language

**Dashboard User**:
Uma pessoa autorizada a consultar o painel interno do Codekeat por meio de e-mail e senha.
_Avoid_: GitHub user, account

**Dashboard Session**:
Uma sessão opaca, revogável e com prazo de expiração que identifica um Dashboard User autenticado.
_Avoid_: JWT, login token

## Implementação

`apps/api/src/features/auth` separa controller HTTP, services de autenticação e senha, repository,
types e constants. Outros módulos consomem somente `#features/auth`.
