# Repository Policy

O contexto Repository Policy mantém as regras que determinam o escopo e a apresentação de um Review para um repositório.

## Language

**Repository Policy**:
O conjunto de regras que determina o que o Codekeat analisa e como ele apresenta Findings em um repositório.
_Avoid_: Prompt, configuration

## Implementação

`apps/api/src/features/repository-policy` contém o service de validação e resolução, seus types e
constants. O acesso público ocorre por `#features/repository-policy`; a leitura de `.codekeat.yml`
pela API do GitHub permanece no service da feature GitHub.
