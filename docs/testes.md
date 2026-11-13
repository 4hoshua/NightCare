# Testes, evidências e pendências — NightCare

[Índice](../README.md) · [Instalação](manual.md) · [Interface e API](interface.md) · [Serial](serial.md)

Este documento reúne a validação antes distribuída entre auditoria e manual. Guias de uso e contratos estão em seus documentos próprios; aqui ficam procedimentos, critérios de aceitação e alcance das evidências. **Cenário descrito não significa cenário executado.**

## Executar verificações automatizadas

Na raiz do projeto, com Docker/Compose, Python 3 e Bash disponíveis:

```bash
python3 scripts/test-prepare.py
bash scripts/test-backend.sh
bash scripts/test-demo.sh
bash scripts/test-integration.sh
bash -n scripts/demo.sh scripts/setup.sh scripts/provision-device.sh scripts/test-backend.sh scripts/test-demo.sh scripts/test-integration.sh
```

| Verificação | O que cobre | O que não comprova |
| --- | --- | --- |
| `test-prepare.py` | Pacotes/identidades, nova sessão, retomada, arquivos incompatíveis e preservação de configuração | Docker real ou execução no Wokwi |
| `test-backend.sh` | Contratos, API, SQLite, migração, isolamento, notificações, observabilidade e análises | Circuito e firmware em execução |
| `test-demo.sh` | HTTP/WS/MQTT com dois clientes representando dispositivos, broker anônimo isolado e SQLite descartável | Broker público ou firmware no ESP32 |
| `test-integration.sh` | MQTT TLS, CA/hostname, ACL, confirmação, Last Will e persistência após reinício | TLS/NTP real do ESP32 ou certificado expirado sem ensaio específico |
| `bash -n` | Sintaxe dos scripts Bash | Resultado de execução |

Os testes Node usam Docker; backend requer Node >=22.13 e a imagem fixa 22.21.1. Testes de integração criam/removem seus próprios ambientes e preservam diagnósticos em `.validation/`. No Docker Desktop, use diretórios compartilhados dentro do workspace para bind mounts; `/tmp` pode não ser compartilhado. Não gerar carga nem adulterar mensagens no broker público.

### Compilar e testar partes do firmware

Com PlatformIO Core 6.1.18 instalado:

```bash
# Apenas prepara arquivos; não troca a sessão existente nem inicia serviços:
bash scripts/demo.sh --prepare-only
pio run -e esp32demo
# Para TLS, preparar o header privado ou exemplo local conforme o manual:
pio run -e esp32dev
# Requer g++ e ArduinoJson baixado pelo build esp32demo:
python3 scripts/test-firmware-clock.py
```

O ambiente fixa espressif32 6.12.0, Arduino ESP32 2.0.17 e ArduinoJson 7.4.2. Não executar setup TLS sobre configuração existente para viabilizar um build. Para compilação sem conexão real, uma cópia local do header de exemplo pode ser usada em checkout descartável, sem publicar credenciais.

O teste de relógio extrai trechos reais de `TimeService` e handlers do sketch, compila no host e usa doubles de rede/tempo/NVS nos modos demo e TLS. Abrange sincronização, deriva, validade, duplicação, diário, fila de intenções, falha NTP/NVS e rollover. Não executa ESP32 nem prova temporização física.

## Critérios manuais da interface

Prepare uma sessão de teste, preferencialmente dois IDs e dados fictícios. Para cada cenário, registre versão, ambiente, passos, resultado observado e restauração. Casos sintéticos de volume/erros devem usar backend/broker/SQLite isolados ou interceptação HTTP/WS no navegador, nunca a instalação em uso.

| Cenário | Ação e critério de aceitação | Exceção / restauração |
| --- | --- | --- |
| I01 — descoberta e associação | Iniciar dois dispositivos, confirmar nomes e verificar cartões distintos | Retido sem estado novo não habilita vínculo; duplicidade/transferência são recusadas |
| I02 — renomeação | Corrigir nome; identidade e histórico permanecem | Nome conflitante não altera vínculo; restaurar nome de teste |
| I03 — Dashboard e busca | Buscar por nome/ID/acentos; limpar; alertas globais continuam visíveis | Sem resultados não oculta chamados; reversões rápidas não removem cartão incorreto |
| I04 — modos e parâmetros | Aplicar AUTO/ON/OFF, brilho/prazo/agenda e comparar telemetria/confirmado/intenção | Entrada inválida não publica; seleção de modo/prévia não envia antes de Aplicar |
| I05 — edição e confirmação | Editar durante heartbeat/ACK; prévia só local; versão aplicada exata consultável | Envio pendente/recusado não vira atual; versão sem detalhes não fabrica valores |
| I06 — gráficos de iluminação | Consultar 24h/7d/30d/agenda, totais e tabela por hora | Falha mantém cache; sem agenda opção desabilitada; respostas antigas não sobrescrevem seleção |
| I07 — dois chamados | Pressionar AJUDA em A/B, reiterar A e atender somente A | Mesmo requestId na reiteração; B independente; encerrar pendente recusado |
| I08 — confirmação remota | Reconhecer/encerrar; verificar resultado e estado do mesmo pedido | Sem ACK vira UNCONFIRMED após 10s; ACK tardio atualiza registro; não inventar sucesso |
| I09 — contador e acompanhamento | Testar sem dado/sem pedido/pendente/offline e 0/1/5/30 ações | Zero só com estado conhecido; offline congela contador; scroll permanece ancorado |
| I10 — análises de assistência | Comparar totais completos com eventos/chamados/comandos, inclusive fora do snapshot | Reiteração não duplica abertura; limites temporais/fusos e zeros coerentes |
| I11 — áudio e notificações | Som global após ativação; sino/filtros/páginas, marcar lidas e recarregar | Abrir não marca; navegador independente; rajada limita avisos; reconexão sem avisos retroativos |
| I12 — perfis e navegação | Alternar tela/leito, voltar/avançar e recarregar URL | Rascunhos/filtros por perfil; dispositivo desconhecido não dispara rota vazia |
| I13 — Administração | Paginar 0/1/2/3/7 registros; editar/paginar/voltar; alternar abas | Rascunho/erro preservado; redução da lista corrige página; nomes longos não ampliam layout |
| I14 — observabilidade | Comparar durações por hora, totais, mensagens e último contato | Sem observação não é offline; retidos não contam; QoS repetido conta recebimento |
| I15 — configuração e diagnóstico | Comparar atual/confirmada/último envio e abrir todos os detalhes | Sem telemetria não usar intenção; relógio/persistência/perdas continuam visíveis |
| I16 — Histórico independente | Paginar 25 registros, combinar escopos globais/locais e filtros por card | Alterar um card preserva outro; ação mantém resultado/período; erro temporal explícito |
| I17 — tabelas e abas | Rodar rolagem vertical/horizontal por roda, teclado e toque | Cabeçalho/altura limitados; abas setas/Home/End; seleção preservada por perfil |
| I18 — teclado e ajuda | Seletores, menu móvel, Tab contido, Escape, foco inicial/retorno, tooltips e gráficos | Escape de seletor não fecha central junto; ajuda não sai da viewport |
| I19 — falha de consulta/conexão | Simular 503, resposta atrasada e perda/retorno WS | Cache com aviso, sem zeros falsos; consulta antiga não vence atual; rascunho/som preservados quando cabível |
| I20 — responsividade e animações | Conferir cinco telas em 320/390/700/768/1280/1440/1920px e movimento reduzido | Sem overflow de página; tabelas/gráficos rolam internamente; atividade neutra offline |

Os antigos cenários de interface I01–I28 foram consolidados nesta matriz por comportamento; a numeração acima é a referência atual. Os nove ensaios locais S01–S09 permanecem em [serial.md](serial.md#ensaios-locais), com passos normais, anormais e restauração. O [pitch](pitch.md) é um roteiro de apresentação, não substitui esta regressão.

## Ensaios adicionais com dois dispositivos

- **M01 — descoberta e vínculo:** anunciar dois IDs, confirmar Leito 1/2, tentar nome duplicado em duas requisições concorrentes e repetir associação. Esperar um único vencedor por nome e recusa de transferência; renomeação preserva vínculo. Retido sem mensagem nova não permite associar.
- **M02 — dados independentes:** publicar movimento e luz apenas no A, parâmetros diferentes e versão 1 para ambos. Confirmar ACK do A e verificar B pendente. ACK cujo deviceId não corresponde ao tópico deve ser recusado.
- **M03 — identificadores iguais:** usar mesmo eventId/requestId/commandId em A/B. Deduplicar dentro de cada dispositivo, manter dois registros distintos e resultados independentes. Testar ACK sem comando daquele dispositivo.
- **M04 — simultaneidade:** abrir chamados nos dois; reconhecer/encerrar A, preservando B. Desconectar A, mantendo presença/ações do B. Relógio inválido em A não bloqueia B.
- **M05 — consultas:** paginar coleções globais com datas/IDs/versões iguais; desempatar também por deviceId. Cursor de A não serve em B nem na consulta global, e vice-versa. Não aceitar `scope=all` em uma rota já delimitada por dispositivo.
- **M06 — recuperação:** reiniciar backend com dois vínculos e intenções válidas; conservar banco e associações, sem indicar online antes de estado novo. Reenviar configurações por dispositivo e apenas comandos ainda válidos.
- **M07 — identidade duplicada:** usar propositalmente a mesma identidade em dois clientes somente no broker isolado. Documentar expulsões por client ID duplicado; o produto não autentica autores no broker público nem identifica fisicamente clones.
- **M08 — migração:** abrir cópia de banco do formato anterior, conferir histórico, abertura de chamados, resultados e configuração aplicada; reabrir sem migrar novamente e sem duplicar Leito 1. Banco parcialmente antigo também deve migrar.
- **M09 — provisionamento:** gerar dois pacotes demo e comparar IDs/client IDs/tópicos. Reexecutar com `--prepare-only` ou `--resume`, preservando namespace e pacotes; recusar ID inválido/repetido e pacote de outra instalação. No TLS, adicionar credencial sem substituir CA/senhas anteriores, recusar reprovisionamento e verificar ACL de A contra B.

Os ensaios M01–M09 complementam os testes de regressão abaixo. Use banco/broker isolados para carga, mensagens inválidas, falhas e duplicação de identidade.

## Contrato HTTP, WebSocket e MQTT

Nos ensaios abaixo, use `/api/devices/:deviceId/...` para consultas e operações individuais; para coleções globais use `scope=all`. As rotas singulares antigas são compatibilidade para exatamente um leito associado. Configure os vínculos antes dos comandos remotos.

Use instância isolada para mensagens inválidas e adulterações; não publique esses ensaios no namespace do usuário. Os scripts existentes exercitam parte destes cenários de forma determinística.

### A01 — todas as rotas e conexão sem autenticação

- **Preparação:** backend com banco temporário; executar tanto com `DEMO_MODE=true` quanto com MQTT TLS.
- **Fluxo normal:** consultar `/health/live`, `/health/ready`, `/ui-config`, `/api/status`, as quatro coleções e `/api/devices/:deviceId/commands/:id`; conectar em `/ws` sem mensagem inicial.
- **Esperado:** HTTP/WS sem token; snapshot imediato e novas mensagens ao mudar eventos, configurações, comandos, broker e presença. Liveness é 200 com processo ativo; readiness é 200 com SQLite/MQTT disponíveis e 503 sem MQTT. `/ui-config` informa modalidade, não credenciais.
- **Condição anormal:** consultar ID de comando ausente, rota desconhecida, enviar JSON inválido ou corpo acima de 8192 bytes; iniciar com `API_TOKEN` antigo/arbitrário no ambiente.
- **Tratamento esperado:** 404 para ausência; erros HTTP para JSON/tamanho, sem mutação parcial ou encerramento do processo; variável antiga ignorada. WebSocket continua funcionando sem autenticação nas duas modalidades.
- **Restaurar:** encerrar conexões e descartar banco isolado.

### A02 — contrato e atomicidade de configuração

- **Preparação:** registrar configuração válida com todos os seis campos editáveis; anotar versão.
- **Fluxo normal:** enviar AUTO/ON/OFF, extremos 1/100% e 1/600 s, agendas que cruzam ou não meia-noite e horários iguais.
- **Esperado:** 202 e versão crescente; intenção persistida antes da publicação. Firmware confirma versão/valores por ACK ou estado, inclusive após desconexão/reinício.
- **Condição anormal:** campos ausentes/extras, decimais, tipos incorretos, modo/fuso inválido, horários fora de HH:MM, configurações MQTT antigas/repetidas/mesma versão com conteúdo diferente.
- **Tratamento esperado:** HTTP 400 ou ACK REJECTED, sem aplicação parcial. Repetição idêntica no firmware não regrava NVS; versão antiga/diferente não substitui configuração válida. Consultar motivos nos detalhes da Administração e no Histórico.
- **Restaurar:** publicar configuração nova válida; testes de desgaste/gravação exigem instrumentação, não apenas observar a interface.

### A03 — contrato, correlação e idempotência de comandos

- **Preparação:** dispositivo online, relógio real válido, chamado PENDING; gerar ID novo para ACK_HELP.
- **Fluxo normal:** POST `/api/devices/:deviceId/commands`, consultar resultado por ID, repetir corpo idêntico e encerrar com CLOSE_HELP/ID novo somente após ACKNOWLEDGED.
- **Esperado:** 202 registra intenção; mesmo ID/corpo retorna resultado anterior; ACK explícito correlacionado confirma aplicação; transição real depende do estado recebido.
- **Condição anormal:** ID reutilizado com outro corpo, chamado antigo, CLOSE antes de reconhecer, dispositivo offline, relógio inválido, comandos retidos, expirados, datas inválidas, ACK de outro pedido e payload malformado.
- **Tratamento esperado:** HTTP 400/409 ou rejeição do firmware conforme camada; ACK não correlacionado é descartado. ACK de transporte MQTT não confirma aplicação. Após 10 s sem ACK, UNCONFIRMED; validade 60 s. Relógio fixo de teste não autoriza atendimento remoto.
- **Restaurar:** aguardar expiração antes de nova intenção quando não se conhece o resultado, sincronizar e conferir estado atual. Diário NVS limita-se a 16 comandos; validar também expulsão e reinício em ensaio de firmware.

### A04 — schemas, sequência e mensagens retidas

- **Preparação:** broker isolado; cliente de teste com prefixo próprio e schemas válidos.
- **Fluxo normal:** publicar todos os tipos de evento do filtro, estado novo e heartbeat; repetir eventId.
- **Esperado:** tipos reconhecidos, IDs deduplicados, timestamps nulos preservados; sequência crescente dentro do boot; novo boot aceito. Estado/availability/config são retidos; events/commands/acks não.
- **Condição anormal:** schemaVersion/deviceId incorretos, campos desconhecidos, tipo/tamanho inválido, sequência repetida/antiga, evento/ACK retido e estado retido de dispositivo ausente.
- **Tratamento esperado:** mensagens inválidas não alteram banco; estado antigo do mesmo boot é ignorado; fotografia retida não cria presença online. `runtimeSettings` é opcional, mas quando presente precisa estar completo e válido. Ordem/reentrega não reabre chamado encerrado no histórico por evento antigo.
- **Restaurar:** publicar estado novo válido; limpar somente mensagens retidas do prefixo isolado.

### A05 — filtros, limites e cursores

- **Preparação:** eventos com mesmo `received_at`, IDs distintos e horários de ocorrência nulos/não nulos.
- **Fluxo normal:** comparar array legado com `page=true`; consultar páginas pequenas até o fim em eventos/chamados/comandos/configurações; testar filtros e extremos de limite 1 e 500.
- **Esperado:** `{items,nextCursor}` paginado; `null` no fim. Empates são resolvidos por ID; configurações ordenadas por versão. Sem pedido de paginação, eventos continuam em array. Período usa recebimento nos eventos, abertura nos chamados e criação nos comandos/configurações, incluindo as extremidades.
- **Condição anormal:** limite 0/501/fracionário, cursor malformado, cursor de outra coleção/filtro e período invertido.
- **Tratamento esperado:** HTTP 400; registros preservados. Novos dados não exigem reiniciar a API. Paginação não oferece snapshot transacional entre requisições: atualizar consulta recupera mudanças posteriores.
- **Restaurar:** reiniciar consulta sem cursor.

## Falhas, recuperação e operação

### F01 — limites de tempo e funcionamento local

- **Preparação:** circuito ativo; agenda diurna e noturna, limites 00:00/23:59, fuso −12/+14 e prazo mínimo/máximo.
- **Fluxo normal:** complementar S04–S06 com agenda que não cruza meia-noite; testar entrada inclusiva e saída exclusiva, movimento contínuo e novo movimento antes do prazo.
- **Condição anormal:** interromper rede/NTP durante acionamento do PIR e botão; alternar relógio real, fixo e inválido.
- **Tratamento esperado:** luz/botão continuam locais, sem bloqueios de 30 s por tentativa de rede; agenda inválida não substitui anterior; fallback sem relógio permite movimento. Uptime/millis usa diferença sem sinal; ensaio de rollover e medida de latência exigem instrumentação específica.
- **Restaurar:** hora real, UTC−3 e configuração padrão.

### F02 — distinguir falhas de dispositivo, broker e consumidor

- **Preparação:** ambiente isolado, chamado ativo e rascunho em edição.
- **Fluxo normal:** interromper separadamente Wi-Fi do ESP32 (procedimento no manual do serial), broker, backend e conexão do navegador; recuperar um por vez.
- **Esperado:** informações distinguem painel/backend, backend/broker e dispositivo. Heartbeat 15 s, expiração de presença 45 s e Last Will offline; reconexão com backoff até 30 s no firmware/backend. Estados locais não dependem do consumidor.
- **Condição anormal:** reconexões repetidas, client ID duplicado, snapshot retido sem heartbeat novo e múltiplas abas com ações simultâneas.
- **Tratamento esperado:** sem presença falsa ou confirmação otimista; uma aba recebe resultado da outra e transições inválidas são recusadas. Client IDs duplicados causam expulsões e precisam ser corrigidos; painel não resolve colisões sozinho.
- **Restaurar:** uma instância por dispositivo/client ID, serviços conectados e estado novo.

### F03 — persistência e replay de intenções

- **Preparação:** configuração pendente e comando ainda válido em banco isolado; chamado persistido no firmware.
- **Fluxo normal:** reiniciar backend/broker; verificar SQLite, configuração retida e replay somente de comandos pendentes/não confirmados ainda válidos. Reiniciar firmware com chamado pendente e reconhecido em ensaios separados.
- **Condição anormal:** expirar comando antes do replay, simular queda entre persistir e publicar e repetir ACK/comando após reinício.
- **Tratamento esperado:** intenção não desaparece antes da publicação; comando expirado não é reenviado. Chamado/resultado de comando no firmware são persistidos atomicamente. Interrupção durante gravação NVS e migração de formato antigo exigem firmware/simulador instrumentado.
- **Restaurar:** serviços ativos; finalizar apenas pedidos fictícios. Parar/reabrir Wokwi é teste distinto do reinício por comando local e pode não preservar flash do simulador.

### F04 — fila cheia, perdas e falha de armazenamento

- **Preparação:** ensaio local/isolado; pausar rede do dispositivo, mantendo firmware e circuito ativos.
- **Fluxo normal:** gerar eventos e reconectar; conferir replay sem duplicatas e prioridade de assistência.
- **Condição anormal:** ultrapassar 100 eventos, perder conexão antes de PUBACK, reiniciar com fila pendente, simular NVS indisponível e SQLite sem acesso/espaço.
- **Tratamento esperado:** fila RAM limitada, descartes contados, eventos removidos após PUBACK; assistência priorizada. Reboot perde fila/contador RAM, preservando somente o que foi gravado em NVS. Persistência falha fica sinalizada no estado; comando não deve confirmar uma transição que falhou ao persistir. Backend sem SQLite utilizável deve falhar explicitamente, sem afirmar prontidão.
- **Restaurar:** restabelecer armazenamento/rede e configuração. Injeção de NVS cheia/falha não é obtida publicando `persistenceOk=false`: esse payload testa apenas apresentação. Não sobrecarregar broker público.

### O01 — preparação e repetibilidade da demo

- **Preparação:** cópia nova do repositório, requisitos do [manual](manual.md); no Windows, Git Bash/Docker Desktop/Python.
- **Fluxo normal:** `bash scripts/demo.sh` cria sessão vazia; copiar os quatro arquivos gerados para Wokwi. Reexecutar com `--resume` e conferir preservação de namespace/volume. Executar sem `--resume` e conferir sessão nova vazia, volume antigo preservado e header novo. `--prepare-only` não deve rotacionar a sessão atual.
- **Condição anormal:** porta ocupada, requisito ausente, arquivo de demo incompatível, header ausente, duas instalações/client IDs iguais e broker inacessível.
- **Tratamento esperado:** mensagens úteis e recusa de sobrescrita incompatível; porta alternativa com DEMO_HTTP_PORT; firmware informa header necessário. Não precisa de login, cadastro, VPS ou gateway privado. Configuração demo não sobrescreve TLS.
- **Restaurar:** corrigir dependência/configuração; não apagar namespace/volume do usuário para resolver um teste.

### O02 — MQTT TLS e ACL

- **Preparação:** executar `scripts/test-integration.sh`, que cria CA/credenciais e serviços descartáveis sem portas públicas.
- **Fluxo normal:** conexão com CA/hostname corretos, usuários separados e tópicos permitidos; API/WS locais sem token.
- **Condição anormal:** CA não confiável, hostname errado, acesso MQTT anônimo/senha errada, publicação em tópico proibido ou de outro dispositivo; certificado expirado/data inválida em ensaio adicional.
- **Tratamento esperado:** handshake/autenticação/ACL recusam o acesso indevido. Não usar aceitação irrestrita de certificado. Proteção MQTT não significa HTTPS ou autenticação de operador no dashboard.
- **Restaurar:** script remove seus próprios serviços/volumes; não modificar credenciais existentes. Certificado expirado, NTP/TLS no ESP32 e falhas físicas continuam exigindo ensaio específico.

### O03 — backup, restauração e atualização

- **Preparação:** banco isolado com eventos, chamados, comandos e configurações conhecidos; registrar volume e namespace.
- **Fluxo normal:** parar backend, copiar SQLite (ou usar backup consistente do SQLite), restaurar em volume isolado e iniciar com a mesma configuração MQTT; conferir conteúdo e reconexão.
- **Condição anormal:** backup sem WAL de banco ativo, banco corrompido, acesso negado e tentativa de setup sobre arquivos existentes.
- **Tratamento esperado:** procedimento correto preserva dados; não afirmar integridade de cópia incompleta. Setup recusa sobrescrita de credenciais. `down` preserva volume; `down -v` apaga dados e não é restauração normal.
- **Restaurar:** remover somente o ambiente de restauração. Atualizar primeiro backend/interface, depois os quatro arquivos Wokwi; backend antigo com schema estrito pode rejeitar a telemetria nova. `.env` antigo não precisa ser regenerado por causa da remoção do token.

### O04 — compilação e verificações reproduzíveis

- **Preparação:** Node >=22.13 ou Docker Node 22.21.1; PlatformIO Core 6.1.18 e headers preparados.
- **Fluxo normal:** executar os scripts de teste listados no início deste documento, build da imagem, `pio run -e esp32dev -e esp32demo` e `bash -n` dos scripts.
- **Condição anormal:** dependências nativas sem toolchain, Node incompatível, bind mount não compartilhado no Docker Desktop e falta de rede para baixar dependências.
- **Tratamento esperado:** diagnóstico explícito; usar `.validation/` dentro do workspace para testes com mounts. Build não deve incluir segundo frontend ou segredos. Não alterar serviços existentes nem gerar commit automaticamente durante ensaios.
- **Restaurar:** encerrar ambientes descartáveis; conservar logs locais sem publicar segredos.

## Evidências registradas antes desta reorganização

Os itens abaixo sintetizam registros de 12 e 13/11/2026 da documentação anterior. **Não foram reexecutados nesta alteração documental.** Números são marcos históricos, não uma declaração de estado de serviços ou de uma nova execução.

| Área | Evidência anterior | Alcance |
| --- | --- | --- |
| Backend e janelas de agenda | Último marco documentado: 56 testes backend aprovados; 9 cenários de equivalência entre iluminação/assistência, limites, offsets e referências | Docker/Node; não prova firmware |
| Integrações demo e TLS | Dois clientes MQTT, confirmação ACK/CLOSE, deduplicação, independência, Last Will, CA/hostname/ACL e reinício aprovados em revisões registradas | Clientes representam ESP32 em ambientes isolados |
| Firmware | Builds esp32dev/esp32demo com PIO 6.1.18; marco de relógio: RAM ~16,0%, flash ~74,1%; teste de handlers no host aprovado | Compilação/execução no host; nenhum Wokwi/hardware executado pelo assistente |
| Pacotes e sessões | Geração de IDs distintos e recusa de incompatíveis; rotação/retomada testadas em cópia descartável, shell com Docker simulado e resolução Compose | Mudança de sessão não foi executada na instalação real naquele ensaio |
| Interface | Navegador com clientes MQTT e contextos HTTP/WS interceptados: perfis, filtros, comandos, notificações, acessibilidade, cache e recuperação | Dados fictícios isolados; não é ensaio físico |
| Responsividade | Cinco telas × sete larguras (320 a 1920px), teclado/toque e movimento reduzido conferidos no último marco | Navegador Chromium; não afirma cobertura de todos os navegadores |
| Dados e migrações | Backups SQLite consistentes, migração em cópia e comparação por chaves preservaram coleções durante evoluções de leitos/notificações/observabilidade | Não equivale a restauração completa de desastre |
| Desenvolvimento | HMR CSS/React e API/WS conferidos; posteriores revisões acompanhadas em 5173 com backend compilado anterior em 3000 | Estado histórico; portas não garantem versão atual |

Durante uma validação de análises de assistência houve auxiliar temporário de leitura SQLite (`readonly`, sem MQTT) para disponibilizar uma rota no preview. Esse arranjo não integra a arquitetura/instalação padrão. Uma reconstrução pelo script com `--resume --dev` utiliza as rotas definitivas do backend. Não depender de contêineres ou arquivos ignorados de uma sessão anterior.

Foram observadas recusas reais `EXPIRED_OR_INVALID_TIME`, compatíveis com deriva do tempo simulado. A solução documentada passou a aguardar amostra NTP nova na demo sem estender validade dos comandos. Compilação, teste de handlers e clientes MQTT passaram; reconhecer/encerrar com firmware atualizado em Wokwi real permaneceu pendente de observação.

As antigas entradas incrementais sobre cores, dimensões e reorganizações de componentes foram incorporadas aos guias de comportamento e à matriz manual. Tentativas intermediárias corrigidas não são instruções de instalação. Evidências de builds e migrações permanecem históricas e não são apresentadas como verificações desta reescrita.

## Pendências reais e limites conhecidos

- **Wokwi/hardware:** executar e registrar PIR, PWM, debounce, agenda, latência do loop, reconexão, duas simulações simultâneas, fila de eventos e persistência após `reiniciar`. Parar/reabrir Wokwi é teste separado. Confirmação remota após sincronização automática ainda exige observação no firmware real.
- **Falhas instrumentadas:** NVS cheia/corrompida, queda durante gravação, migração NVS antiga, expulsão do diário após 16 comandos, rollover físico, certificado expirado, TLS/NTP no ESP32 e restauração completa. Testes de handlers no host cobrem parte da lógica; não encerram a pendência física.
- **Histórico:** backend usa sessão MQTT limpa. Eventos confirmados pelo broker enquanto consumidor está ausente podem faltar, mesmo com chamado atual recuperável por NVS/estado retido. Não há estimativa/backfill de perdas.
- **Persistência/tempo:** fila e perdas são RAM; reboot as apaga. UTC real/NTP autoriza comandos. Fuso remoto é UTC−3 fixo; uptime reinicia no boot.
- **Segunda etapa:** adaptar Wi-Fi e elétrica do ESP32 real; validar componentes, alimentação e acionamento da luminária. Infraestrutura TLS existente não significa montagem física concluída.
- **Acesso:** broker público não autentica autores; namespace não é segredo. API/WS não têm login em nenhuma modalidade, com HTTP em loopback pelo Compose. Não há push garantido, certificação médica ou garantia de prevenção de quedas.
- **Ambientes:** instalação Windows e `nix develop` não foram executados nos registros consolidados. Variante ESP-IDF 5 não compilada/validada; build reproduzível utiliza Arduino 2/IDF 4. Compatibilidade de scrollbar fora de Chromium não foi comprovada pelo ensaio citado.

## Como registrar uma nova evidência

Informe data, revisão do código, ambiente real ou simulado, comando/passos, resultado observado, limitações e localização de artefatos sem segredos. Separe resultado esperado de observado. Só marque execução Wokwi/hardware quando ela tiver sido efetivamente acompanhada. Use `.validation/` para logs/backups locais; não publique credenciais, bancos de usuários ou pacotes privados.

## Verificação desta reorganização — 13/11/2026

Os sete documentos foram conferidos contra scripts, firmware, rotas/contratos do backend e telas atuais. Passaram a verificação de 45 links internos/âncoras, consistência das tabelas, sintaxe de 20 blocos Bash, cinco corpos JSON de exemplos curl e bloco JSON de resposta. Os quatro diagramas Mermaid foram renderizados em contexto isolado no navegador; `git diff --check` passou.

Esta alteração não executou os exemplos HTTP de escrita, scripts de instalação, builds, testes de aplicação ou firmware. Nenhuma sessão demo foi gerada e nenhum serviço foi reiniciado. As evidências funcionais acima continuam identificadas como registros anteriores.
