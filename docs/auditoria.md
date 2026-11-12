# Auditoria técnica — NightCare

Os procedimentos de interface ficam em [manual.md](manual.md); comandos do ESP32 ficam exclusivamente em [serial.md](serial.md). Este documento cobre contratos, persistência, segurança MQTT e injeção de falhas em ambientes isolados. Não é o roteiro do pitch.

## Regras de isolamento por dispositivo

- Identidade estável de 1–32 caracteres ASCII (`A–Z`, `a–z`, números, `_`, `-`), distinta de nome do leito; IDs de serviços são reservados.
- Tópico e payload precisam identificar o mesmo dispositivo no namespace da instalação. Mensagem inválida ou ACK sem intenção correspondente não cadastra dispositivo.
- Estado novo estabelece presença; estado retido somente revela fotografia. Heartbeat 15 s e expiração 45 s são independentes por dispositivo.
- Associação explícita exige presença, dispositivo ainda sem leito e nome único. Não existe transferência, remoção ou substituição nesta versão. Corrigir nome não altera identidade nem vínculo.
- Configurações/versões, eventos, chamados, comandos, ACKs, replay e cursores são separados por deviceId, inclusive com IDs locais iguais em dois dispositivos.
- Dados anteriores ao vínculo continuam associados ao deviceId e ficam consultáveis pelo leito após associação. Renomear atualiza o rótulo mostrado no histórico; não há cadastro de pacientes.
- SQLite antigo migra em transação e conserva `nightcare-001` como Leito 1. Instalação nova começa sem dispositivos/leitos e exige confirmação.
- Rotas antigas de operação só funcionam com um único leito associado. `/api/status` e `/ws` mostram visão global; o campo singular de compatibilidade só existe com um leito. Coleções com `scope=all` permitem consulta global explícita.

## Ensaios adicionais com dois dispositivos

- **M01 — descoberta e vínculo:** anunciar dois IDs, confirmar Leito 1/2, tentar nome duplicado em duas requisições concorrentes e repetir associação. Esperar um único vencedor por nome e recusa de transferência; renomeação preserva vínculo. Retido sem mensagem nova não permite associar.
- **M02 — dados independentes:** publicar movimento e luz apenas no A, parâmetros diferentes e versão 1 para ambos. Confirmar ACK do A e verificar B pendente. ACK cujo deviceId não corresponde ao tópico deve ser recusado.
- **M03 — identificadores iguais:** usar mesmo eventId/requestId/commandId em A/B. Deduplicar dentro de cada dispositivo, manter dois registros distintos e resultados independentes. Testar ACK sem comando daquele dispositivo.
- **M04 — simultaneidade:** abrir chamados nos dois; reconhecer/encerrar A, preservando B. Desconectar A, mantendo presença/ações do B. Relógio inválido em A não bloqueia B.
- **M05 — consultas:** paginar coleções globais com datas/IDs/versões iguais; desempatar também por deviceId. Cursor de A não serve em B nem na consulta global, e vice-versa. Não aceitar `scope=all` em uma rota já delimitada por dispositivo.
- **M06 — recuperação:** reiniciar backend com dois vínculos e intenções válidas; conservar banco e associações, sem indicar online antes de estado novo. Reenviar configurações por dispositivo e apenas comandos ainda válidos.
- **M07 — identidade duplicada:** usar propositalmente a mesma identidade em dois clientes somente no broker isolado. Documentar expulsões por client ID duplicado; o produto não autentica autores no broker público nem identifica fisicamente clones.
- **M08 — migração:** abrir cópia de banco do formato anterior, conferir histórico, abertura de chamados, resultados e configuração aplicada; reabrir sem migrar novamente e sem duplicar Leito 1. Banco parcialmente antigo também deve migrar.
- **M09 — provisionamento:** gerar dois pacotes demo e comparar IDs/client IDs/tópicos. Reexecutar preservando namespace e pacotes; recusar ID inválido/repetido e pacote de outra instalação. No TLS, adicionar credencial sem substituir CA/senhas anteriores, recusar reprovisionamento e verificar ACL de A contra B.

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
- **Tratamento esperado:** HTTP 400 ou ACK REJECTED, sem aplicação parcial. Repetição idêntica no firmware não regrava NVS; versão antiga/diferente não substitui configuração válida. Consultar motivos em Administração.
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
- **Esperado:** `{items,nextCursor}` paginado; `null` no fim. Empates são resolvidos por ID; configurações ordenadas por versão. Sem pedido de paginação, eventos continuam em array. Período é por recebimento e inclui as extremidades.
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

- **Preparação:** cópia nova do repositório, requisitos do README; no Windows, Git Bash/Docker Desktop/Python.
- **Fluxo normal:** `bash scripts/demo.sh --prepare-only`, depois `bash scripts/demo.sh`; copiar os quatro arquivos gerados para Wokwi. Reexecutar e conferir reutilização do namespace.
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
- **Fluxo normal:** executar os três scripts de teste do README, build da imagem, `pio run -e esp32dev -e esp32demo` e `bash -n` dos scripts.
- **Condição anormal:** dependências nativas sem toolchain, Node incompatível, bind mount não compartilhado no Docker Desktop e falta de rede para baixar dependências.
- **Tratamento esperado:** diagnóstico explícito; usar `.validation/` dentro do workspace para testes com mounts. Build não deve incluir segundo frontend ou segredos. Não alterar serviços existentes nem gerar commit automaticamente durante ensaios.
- **Restaurar:** encerrar ambientes descartáveis; conservar logs locais sem publicar segredos.

## Pendências reais e limites conhecidos

- **Wokwi e hardware:** percursos de circuito, debounce, PWM, agenda, latência, filas reais, NVS, reinício e TLS/NTP do ESP32 precisam de execução observada. Compilação e cliente MQTT representando dispositivo não comprovam esses comportamentos.
- **Injeção de falhas:** NVS cheia/corrompida, queda durante gravação, rollover de millis, migração NVS antiga, diário acima de 16 comandos, certificado expirado e restauração completa de backup precisam de ensaios instrumentados; não marcar como aprovados por equivalência com testes HTTP.
- **Entrega durante parada do backend:** com consumidor ausente e ESP32 conectado, broker pode confirmar eventos que não chegarão ao histórico por causa da sessão limpa do backend. Fila do firmware cobre desconexão do dispositivo; não garante histórico nesse outro cenário.
- **Persistência e tempo:** fila/contador de perdas são RAM; relógio real/NTP autoriza comandos remotos; São Paulo é UTC−3 fixo, sem base IANA/horário de verão; uptime é amostra e reinicia no boot.
- **Demo e acesso:** broker público não autentica autores nem protege tópicos; prefixo evita colisões acidentais. API/WS não têm autenticação de operador em nenhuma modalidade e Compose publica HTTP só em loopback. Usar dados fictícios.
- **Ambientes de desenvolvimento:** instalação Windows e `nix develop` não foram executados nesta consolidação. O hook Nix foi ligado ao devShell e os auxiliares adaptados à API sem token; sua execução permanece pendente.
- **Produto:** vários leitos em uma instalação, com associação permanente, sem notificações garantidas em segundo plano, sem certificação médica ou garantia de prevenção de quedas. Variante ESP-IDF 5 não validada. Não adicionar controles remotos de teste para ocultar essas limitações.



## Evidências desta implementação — 12/11/2026

- **Backend:** 16 testes aprovados em Docker Node 22.21.1, incluindo migração, descoberta, associação concorrente, identidade/tópico, IDs iguais em dispositivos diferentes, versões/ACKs isolados, cursores e reabertura do banco com dois vínculos.
- **Preparação:** teste Python aprovado para pacotes distintos, repetição estável, adição de identidade e recusa de IDs/pacotes incompatíveis sem sobrescrita.
- **Integração demo:** clientes MQTT representando dois dispositivos validaram movimento independente, duas chamadas, configuração isolada, reconhecimento/encerramento, consulta global e Last Will de apenas um dispositivo. O broker usado foi local e isolado, sem carga no broker público.
- **Integração TLS:** CA/hostname, acesso anônimo, ACL, deduplicação, confirmação, idempotência e persistência após reinício passaram. Credencial adicional foi provisionada preservando a anterior; o segundo usuário foi impedido de publicar no tópico do primeiro.
- **Builds:** TypeScript/Vite e imagem Docker aprovados; PlatformIO Core 6.1.18 compilou TLS e demo do primeiro dispositivo e o pacote demo do segundo. RAM estática 15,9%; flash aproximadamente 73,8% TLS e 73,7% demo.
- **Navegador:** com dois clientes MQTT de teste, foram conferidos descoberta/associação, nomes duplicados/renomeação, cartões distintos, rascunhos por dispositivo, troca rápida sem publicar rascunho, comandos isolados, som global, históricos globais e navegação/seleção pelo endereço. As quatro telas passaram em 390/768/1024/1440 px, com menu móvel/foco e voltar do navegador. Instalação vazia com ID desconhecido no endereço também foi verificada.
- **Migração real ensaiada em cópia:** backup consistente do banco existente; migração da cópia preservou a quantidade de registros nas quatro coleções e associou o dispositivo anterior ao Leito 1. O serviço existente foi atualizado mantendo volume e namespace.

**Não executado:** firmware no Wokwi ou em hardware, nem duas simulações Wokwi reais simultâneas. Compilação, clientes MQTT e ensaios de navegador não comprovam PIR, debounce, PWM, latência, NVS ou TLS/NTP do ESP32. Ensaios instrumentados e demais pendências acima continuam abertos.

### Atualização automática da interface no Docker — 12/11/2026

- Imagem de desenvolvimento Node 22.21.1 construída; instalação sem vulnerabilidades reportadas e build TypeScript/Vite aprovado. Sintaxe de `scripts/demo.sh` validada com `bash -n`.
- Serviço `frontend-dev` saudável em localhost:5173, com fontes montadas do workspace e dependências isoladas em volume. API respondeu 200, `/ui-config` identificou a demo e `/ws` entregou snapshot pelo proxy.
- Navegador confirmou alteração temporária de CSS sem recarregar a página e alteração temporária em React/TypeScript com recarga automática. Fontes restauradas e restauração observada no navegador. IDs, horários de início e contadores de reinício dos dois contêineres permaneceram iguais durante as edições; backend existente continuou saudável.
- Polling configurado para Docker Desktop/Windows/WSL; execução efetiva realizada nesta máquina Linux com Docker Desktop. Windows/WSL continuam sem ensaio direto. Nenhum comando MQTT de teste foi publicado e nenhum firmware foi executado nesta alteração.
