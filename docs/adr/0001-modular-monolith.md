# Iniciar com monólito modular

O Codekeat será uma única API modular com SQLite, fila local apenas para controle de concorrência e
adaptadores para GitHub e modelos de IA. Microserviços e broker durável foram descartados para o
protótipo porque aumentariam a operação sem resolver uma necessidade atual; os limites internos mantêm
a migração futura possível quando houver volume, múltiplas réplicas ou requisitos de disponibilidade.
