# Validação do MVP

Registro de 2 de novembro de 2026. Os resultados abaixo distinguem execução do backend, cliente MQTT de teste e firmware real. Os dados usados são fictícios.

## Resultados executados

| Verificação | Esperado | Observado |
| --- | --- | --- |
| Backend em Docker/Node 22.21.1 | contratos, API, histórico e persistência coerentes | **10 testes aprovados**, sem falhas |
| Migração de SQLite existente | manter registros e preencher abertura do chamado | aprovado; primeiro recebimento histórico ou atualização anterior; dados preservados após reabrir banco |
| Prefixo exclusivo e modo demo | instalações separadas por tópico; API aberta somente em demo explícita | aprovado |
| WebSocket | snapshot inicial, autenticação na modalidade TLS e atualizações | aprovado para histórico, comandos, timeout de 10 s, presença de 45 s e conexão do broker; token inválido recusado |
| Integração demo com broker isolado | dashboard servido, configuração confirmada e fluxo de assistência | aprovado: HTTP/WS/MQTT/SQLite, brilho confirmado, abertura → reconhecimento → encerramento |
| Idempotência e validação na demo | duplicatas sem repetir efeito; entradas inválidas recusadas | aprovado: deduplicação QoS 1, comando repetido, requestId errado, configuração inválida e relógio inválido |
| Presença na demo | offline e retorno refletidos no painel | aprovado com cliente MQTT de teste |
| Integração TLS | rejeitar hostname/CA inválidos e acesso anônimo; respeitar ACL | aprovado, incluindo bloqueio de publicação indevida por tópico |
| Integração TLS funcional | configuração confirmada, ACK correlacionado, deduplicação e Last Will | aprovado |
| Reinício de backend/broker TLS | SQLite e configuração retida preservados | aprovado |
| EMQX público | conexão e eco MQTT QoS 1 | aprovado em `broker.emqx.io:1883`, tópico aleatório, sem retenção |
| Seleção de modalidade no Wokwi | aceitar apenas mqtt_demo.h sem arquivos de exemplo/TLS | aprovada por compilação da seleção automática e explícita; TLS explícito preservado com header demo presente |
| Preparação demo repetida | manter namespace e arquivos TLS existentes | aprovado; comparação de conteúdo sem exibir segredos |
| Compilação frontend | React/TypeScript e Vite geram assets | aprovada no Docker |
| Navegador com backend/broker isolados | fluxo do cuidador integrado | brilho 55% confirmado, reconhecimento, recarga com chamado reconhecido, encerramento e filtro de histórico aprovados |
| Formulário durante atualizações | não perder edição | brilho em edição preservado durante heartbeat e reconexão |
| Parada/retorno do backend no navegador | aviso de perda e recuperação automática | aprovado; estado recuperado e formulário preservado |
| Áudio no navegador | habilitação por gesto do usuário | botão ativou/desativou o recurso; não foi feita avaliação auditiva do som |
| Layout em celular | painel utilizável sem rolagem horizontal da página | aprovado em 390 × 844; tabela tem rolagem própria |
| Firmware TLS `esp32dev` | compilação Arduino ESP32 2.0.17 | aprovada: RAM estática 15,9%, flash 73,7% |
| Firmware demo `esp32demo` | compilação incluindo `rede off` / `rede on` | aprovada: RAM estática 15,9%, flash 73,6% |
| Auditoria npm | dependências sem alertas conhecidos | backend de execução e frontend sem vulnerabilidades reportadas |
| Scripts e diff | sintaxe Bash válida e ausência de erros de whitespace | aprovados |

A integração demo e a validação no navegador usam `scripts/demo-integration.mjs` como dispositivo de teste. Esse cliente publica estados e responde a configurações/comandos; **não executa a lógica de PIR, PWM, debounce, agenda, fila do ESP32 ou NVS**.

O broker inicialmente considerado, `test.mosquitto.org`, não respondeu nesta máquina em TCP 1883; o acesso MQTT por WSS também falhou. A demonstração foi configurada para o broker público EMQX, com conexão e publicação/assinatura verificadas. Não há garantia de disponibilidade de serviços comunitários.

## Aceite pendente no Wokwi ou hardware

O assistente **não executou o firmware no Wokwi nem em hardware**. Compilar não comprova os cenários abaixo. Use o roteiro do README e registre o resultado observado ao demonstrar.

| Cenário do circuito | Esperado | Observado nesta entrega |
| --- | --- | --- |
| Movimento dentro da agenda | luz no brilho configurado | pendente no Wokwi |
| Movimento fora da agenda | não acionar luz em AUTO | pendente no Wokwi |
| Novo movimento durante temporização | cancelar desligamento | pendente no Wokwi |
| Botão e debounce | um acionamento por pressionamento; reiteração mantém pedido | pendente no Wokwi |
| Reconhecer/encerrar do painel até ESP32 real | LED/buzzer, ACK e eventos coerentes | pendente no Wokwi; fluxo backend testado com cliente MQTT |
| `rede off`, PIR e botão | controle local continua e painel fica offline | pendente no Wokwi |
| `rede on` | sincronizar estado e reenviar fila sem duplicação | pendente no Wokwi |
| Mais de 100 eventos offline | fila limitada, prioridade para assistência e perdas contadas | pendente no Wokwi |
| `hora invalida` e depois `hora real` | comportamento de agenda e proteção de comando remoto | pendente no Wokwi |
| `reiniciar` com chamado ativo | recuperar mesmo pedido e estado na NVS | pendente no Wokwi |
| Parar/reabrir simulação | observar persistência específica do simulador | pendente; verificar separadamente de `reiniciar` |

## Reproduzir

```bash
bash scripts/test-backend.sh
bash scripts/test-demo.sh
bash scripts/test-integration.sh
bash scripts/demo.sh --prepare-only
pio run -e esp32demo -e esp32dev
npm audit --prefix backend --omit=dev
npm audit --prefix frontend
bash -n scripts/*.sh
```

PlatformIO Core usado: 6.1.18. O Node local é 20; os builds e testes de backend/frontend foram executados em Docker com Node 22. Os scripts de integração criam ambientes próprios em `.validation/`, sem usar volumes do operador. Não há commit nem push desta implementação.
