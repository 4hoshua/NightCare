# Auditoria funcional e roteiro completo de validação do NightCare

Esta auditoria cobre o firmware, circuito, dashboard único, API, MQTT, persistência e operação. O roteiro começa pela preparação do ambiente e separa testes locais do ESP32 de testes do painel com comunicação MQTT. Cada teste contém um fluxo normal e uma condição anormal, com o tratamento esperado. Registre o observado ao executar; os resultados esperados não são comprovação de execução no Wokwi.

## Inventário e conclusão da auditoria

| Capacidade | Onde acessar | Cenários |
| --- | --- | --- |
| AUTO/ON/OFF, brilho, prazo, agenda e fuso | Iluminação; serial; configuração HTTP/MQTT (remoto usa São Paulo) | S02–S06, P02–P04, P13, A02 |
| PIR, PWM, prazo renovável, agenda noturna/diurna/24 h e fallback sem relógio | circuito, Dashboard, Iluminação; serial para relógio de teste | S02–S06, P01, F01 |
| Abertura, reiteração, debounce, LED/buzzer e atendimento local/remoto | botão; Assistência; serial; API | S07–S08, P05–P08, P12, P14, A03 |
| Estado atual, horário real válido, disponibilidade e três conexões distintas | quatro telas e Administração; `/api/status`, `/ws` | P01, P04, P11, P15, A01, F02 |
| Agenda/prazo/fuso ativos, boot/uptime/sequência, NVS e perdas | Iluminação/Administração, estado MQTT | P04, P15, A04, F04 |
| Eventos e filtros, IDs, datas de ocorrência/recebimento e paginação | Administração; `/api/events` | P10, P16, A05 |
| Chamados, contagem, abertura estável e histórico completo | Assistência/Administração; `/api/requests` | P05–P07, P14, P16 |
| Intenções, configuração desejada/aplicada, confirmação e motivos | Iluminação/Administração; `/api/configs`, `/api/config` | P02–P04, P13, P17, A02, F03 |
| Comandos correlacionados, resultado, validade e histórico completo | Assistência/Administração; `/api/commands`, `/api/commands/:id` | P12, P16, A03, F03 |
| Navegação, responsividade, foco, áudio e preservação de edições | dashboard único em `/` | P08–P09, P13, P18 |
| Validação, deduplicação, retenção, filas, reconexão e replay | firmware/backend; ensaios MQTT isolados | S09, A04, F02–F04 |
| TLS/CA/hostname/ACL e credenciais MQTT | modalidade opcional, setup e testes TLS | O02 |
| Setup demo, Wokwi, builds, healthchecks, persistência e backup | scripts, Docker, API de saúde e operação | S08, P11, O01–O04 |

A consolidação elimina o segundo dashboard, importa troca rápida de modo, contagem de cliques e alternativa de geração de IDs, e completa consultas antes limitadas às listas recentes. Login/token foram removidos de HTTP e WebSocket. Usuários MQTT, certificados e ACL da modalidade TLS continuam ativos.

O painel não oferece reinício, pausa da rede nem relógio simulado: esses controles de teste continuam no serial por decisão de escopo. Não há cadastro de pessoas, múltiplos dispositivos, abertura remota fictícia de ajuda, autenticação de operadores ou notificações com o navegador fechado. São limites do produto, não botões escondidos.

As pendências de execução e limitações estão ao final. O inventário de cobertura não significa aprovação dos ensaios físicos.

## Preparação e registro

1. Execute `bash scripts/demo.sh` e abra o endereço informado. Se a porta estiver ocupada, use `DEMO_HTTP_PORT=3001 bash scripts/demo.sh`.
2. Atualize no Wokwi os quatro arquivos de `Wokwi/demo/` conforme o README. Confirme que o sketch começa com `#define NIGHTCARE_DEMO 1` e que existe a aba `mqtt_demo.h`.
3. Inicie a simulação e deixe o monitor serial visível. Use um comando por linha; aguarde a resposta antes do próximo. Clique no PIR e em **Simulate Motion** para provocar movimento; acione o botão AJUDA pelo circuito.
4. Não execute duas simulações da mesma instalação ao mesmo tempo: elas usam o mesmo client ID. Use somente dados fictícios no broker público.
5. Anote as configurações atuais antes de alterar: modo, brilho, prazo, agenda e fuso. Encerre um chamado de teste anterior com `reconhecer` e `encerrar` quando necessário; não encerre um chamado que você queira preservar.

A luz branca representa a luminária; o LED vermelho e o buzzer representam assistência. O PIR pode continuar ativo por alguns segundos depois do acionamento: a contagem para desligar começa **quando ele fica inativo**, não quando você clica. Para cronometrar, use o tempo da simulação; ela pode executar abaixo da velocidade real.

No modo automático, a agenda começa inclusiva e termina exclusiva. Horários iguais habilitam 24 h. Sem relógio válido, movimento é aceito o dia inteiro. `hora HH:MM` congela o horário para testar a agenda e impede atendimento remoto; use `hora real` e aguarde sincronização para os testes dos painéis.

Para cada teste, copie e preencha:

| Campo | Registro |
| --- | --- |
| Teste, data e executor | |
| Preparação/configuração inicial | |
| Resultado observado no fluxo normal | |
| Resultado observado na condição anormal | |
| Evidências | captura do painel, serial, IDs de eventos/comandos quando aplicável |
| Conclusão | aprovado / falhou / bloqueado por dependência externa |
| Restauração realizada | |

## Percurso 1 — comandos no terminal do ESP32

Para isolar os testes locais S01–S08, execute `rede off` após a primeira conexão. Isso pausa apenas o Wi-Fi do ESP32, mantendo o firmware executando e impedindo que uma configuração remota nova interfira. O painel pode ficar offline durante este percurso. Não é necessário parar Docker nem a internet do computador.

### S01 — leitura de estado e comandos inválidos

- **Preparação:** envie `ajuda`, depois `status`.
- **Fluxo normal:** confira no serial configuração, agenda, relógio, PIR, PWM e assistência; acione o PIR e consulte `status` novamente.
- **Esperado:** o estado acompanha o circuito; consultar ajuda/estado não altera configurações nem abre chamados.
- **Condição anormal:** envie `comando-inexistente` e uma linha com mais de 63 caracteres. Em seguida, envie `status`.
- **Tratamento esperado:** comando desconhecido ou muito longo é recusado com mensagem de erro; a linha longa é descartada inteira, sem aplicar seu prefixo; o comando seguinte continua funcionando. Confira que luz e botão seguem responsivos.
- **Restaurar:** nenhuma alteração persistente é esperada.

### S02 — modos manuais e independência da assistência

- **Preparação:** `brilho 30`, `agenda 22:00 06:00`, `hora 12:00`.
- **Fluxo normal:** envie `on`, depois `off`, e acione movimento em cada modo.
- **Esperado:** `on` mantém luz no brilho definido, independentemente de agenda/PIR; `off` mantém apagada.
- **Condição anormal:** com `off` e fora da agenda, pressione AJUDA; troque `on`/`off` enquanto o chamado está pendente.
- **Tratamento esperado:** o botão abre o chamado, LED vermelho pisca e buzzer sinaliza; trocar a iluminação não reconhece nem encerra o pedido.
- **Restaurar:** `reconhecer`, `encerrar`, `auto`.

### S03 — brilho e limites de entrada

- **Preparação:** envie `on`.
- **Fluxo normal:** envie `brilho 1`, `brilho 30` e `brilho 100`; confira brilho/PWM pelo serial e LED.
- **Esperado:** os três valores são aceitos e a saída é reavaliada imediatamente.
- **Condição anormal:** envie `brilho 0`, `brilho 101` e `brilho abc`.
- **Tratamento esperado:** cada entrada é recusada; o último valor válido continua sendo 100%, sem gravação de um valor inválido. `off` continua funcionando após os erros.
- **Restaurar:** `brilho 30`, `auto`.

### S04 — prazo e renovação por movimento

- **Preparação:** `auto`, `agenda 00:00 00:00`, `tempo 5`.
- **Fluxo normal:** acione o PIR; espere ficar inativo e conte cinco segundos. Repita acionando novo movimento antes de terminar a contagem.
- **Esperado:** luz acesa durante PIR ativo; apaga cerca de cinco segundos após ficar inativo. Novo movimento cancela a contagem anterior e o prazo recomeça somente após nova inatividade.
- **Condição anormal:** mantenha/renove movimento por mais de cinco segundos; depois envie `tempo 0` e `tempo 601`.
- **Tratamento esperado:** luz não apaga enquanto PIR está ativo; prazos inválidos são recusados e o valor 5 s permanece. O botão continua respondendo durante a temporização.
- **Restaurar:** `tempo 30`.

### S05 — agenda, meia-noite e horários inválidos

- **Preparação:** `auto`, `agenda 22:00 06:00`.
- **Fluxo normal:** teste movimento com `hora 21:59`, `hora 22:00`, `hora 05:59` e `hora 06:00`. Para observar a saída imediata da agenda, mantenha movimento ativo ao trocar de 05:59 para 06:00.
- **Esperado:** movimento permitido às 22:00 e 05:59, bloqueado às 21:59 e 06:00; a luz apaga ao sair da agenda em AUTO, mesmo antes do prazo.
- **Condição anormal:** envie `agenda 00:00 00:00` e teste ao meio-dia; depois tente `agenda 25:00 06:00`, `agenda 22:00 06:60` e `hora 24:00`.
- **Tratamento esperado:** agenda com horários iguais funciona 24 h; horários inválidos são recusados integralmente, preservando a agenda e o relógio de teste anteriores.
- **Restaurar:** `agenda 22:00 06:00`; mantenha horário de teste apenas se o próximo teste precisar.

### S06 — relógio inválido e fuso

- **Preparação:** `auto`, `agenda 22:00 06:00`, `hora 12:00`; confirme que movimento não acende a luz.
- **Fluxo normal:** envie `fuso -3` e consulte `status`.
- **Esperado:** fuso UTC−3 válido; temporização continua baseada no tempo decorrido, independente do horário de agenda.
- **Condição anormal:** envie `hora invalida` e provoque movimento; tente `fuso -13`, `fuso 15` e `fuso abc`.
- **Tratamento esperado:** relógio inválido libera movimento em AUTO, mantendo o prazo; fusos inválidos são recusados sem alterar o anterior. Isso não autoriza comandos remotos. Não confunda relógio fixo local válido para agenda com UTC real válido para atendimento remoto.
- **Restaurar:** `fuso -3`, `hora real`; a sincronização poderá depender de `rede on` ao concluir o percurso local.

### S07 — transições de assistência, reiteração e debounce

- **Preparação:** deixe assistência sem pedido; envie `off`.
- **Fluxo normal:** pressione AJUDA, use `status`, envie `reconhecer` e depois `encerrar`.
- **Esperado:** pendente → reconhecido → sem pedido; LED pisca/buzzer periódico enquanto pendente, LED contínuo/buzzer silencioso quando reconhecido, ambos desligados após encerrar.
- **Condição anormal:** antes de reconhecer, tente `encerrar`. Mantenha o botão pressionado por alguns segundos, solte e pressione novamente. Depois de reconhecer, repita `reconhecer`.
- **Tratamento esperado:** encerramento direto é recusado; botão mantido gera um único acionamento; nova pressão reitera o mesmo requestId. Reconhecer novamente não repete a transição. Não há encerramento automático pela temporização da luz.
- **Restaurar:** `encerrar` após reconhecimento, depois `auto`.

### S08 — reinício com pedido e configuração persistidos

- **Preparação:** `brilho 45`, `tempo 7`, abra um chamado e envie `reconhecer`. Anote requestId e configuração via `status`.
- **Fluxo normal:** envie `reiniciar`; confira novamente `status` após inicializar.
- **Esperado:** configuração, requestId e assistência reconhecida são recuperados da NVS. O reinício não equivale a um novo chamado.
- **Condição anormal:** repita com pedido ainda pendente, antes de reconhecer. Em um teste separado, pare e reabra a simulação.
- **Tratamento esperado:** o reinício por comando recupera o pedido pendente e sua sinalização. Parar/reabrir pode ter persistência diferente conforme o Wokwi: registre esse resultado separadamente, sem usá-lo como prova de falha/sucesso de `reiniciar`. Reinício volta a tentar Wi-Fi; se desejar manter isolamento, envie `rede off` novamente. Uma configuração remota mais nova pode ser aplicada ao reconectar.
- **Restaurar:** reconhecer/encerrar o pedido, `brilho 30`, `tempo 30`.

### S09 — Wi-Fi indisponível e limite da fila de eventos

- **Preparação:** com backend ativo, use `rede on`, aguarde conexão, confira em Administração o contador de eventos descartados; depois envie `rede off` e aguarde o painel indicar offline. Abra um chamado e anote requestId no serial.
- **Fluxo normal:** alterne `on`/`off` algumas vezes, acione PIR e reitere AJUDA; envie `rede on`.
- **Esperado:** controles locais continuam funcionando offline; estado e eventos ainda na fila chegam após reconectar, sem criar outro chamado.
- **Condição anormal:** repita a desconexão e alterne pelo menos 55 pares de `on`/`off`, aguardando cada resposta, até ultrapassar 100 eventos de mudança da luz. Intercale pedidos/reiterações de assistência. Reconecte sem reiniciar o ESP32.
- **Tratamento esperado:** fila limitada a 100; descarta primeiro eventos comuns antigos, prioriza assistência e incrementa perdas. Administração mostra aumento de eventos descartados após receber novo estado. Não espere recuperar eventos descartados. O serial atual não expõe ocupação da fila, portanto não afirme que mediu seu tamanho apenas olhando o terminal.
- **Restaurar:** `rede on`, `auto`, `hora real`; aguarde escoamento. Encerre o chamado. Não faça teste de carga no broker público: produza o excesso enquanto o dispositivo está offline e evite repetições desnecessárias.

## Percurso 2 — painéis com sensores e botão do ESP32

Antes de começar, confirme `rede on`, `hora real` e relógio sincronizado em Administração. Em Iluminação e movimento, envie AUTO, brilho 30%, prazo 5 s e agenda 00:00–00:00. Aguarde confirmação antes de seguir. Não use um horário fixo nos testes de reconhecimento remoto, exceto quando o próprio teste pedir essa condição.

### P01 — Dashboard recebe os sensores e sinaliza ausência de dados

- **Preparação:** abra Dashboard com dispositivo conectado.
- **Fluxo normal:** acione o PIR e observe movimento/luz; espere PIR inativo e o prazo de cinco segundos.
- **Esperado:** cartões acompanham sensor e iluminação reais, com retorno da luz ao repouso. A ação acontece no ESP32; o painel apenas a acompanha.
- **Condição anormal:** envie `rede off` e aguarde offline por disponibilidade/timeout, até 45 s desde a última atualização válida.
- **Tratamento esperado:** ambiente perde indicação de conectado; valores conhecidos não viram dados novos e são tratados como última informação recebida. O PIR e a luz continuam locais. Estado retido sozinho não comprova presença.
- **Restaurar:** `rede on`; espere heartbeat novo antes de considerar o ambiente novamente online.

### P02 — configuração de iluminação e valores inválidos

- **Preparação:** abra Iluminação e movimento.
- **Fluxo normal:** envie brilho 55%, prazo 5 s, modo AUTO e agenda 24 h. Aguarde confirmação; acione PIR e compare LED, serial e painel.
- **Esperado:** configuração enviada recebe versão, depois confirmação do dispositivo; estado mostra modo/brilho atuais e a luz usa a nova intensidade.
- **Condição anormal:** tente enviar brilho 0 ou 101 e prazo 0 ou 601; tente deixar um horário vazio.
- **Tratamento esperado:** formulário bloqueia envio inválido por seus limites/campos obrigatórios. Se contornar a validação do navegador, API recusa payload inválido com HTTP 400; nenhuma parte da configuração deve ser aplicada. A configuração confirmada anterior permanece.
- **Restaurar:** retorne aos valores de preparação e confirme o envio válido.

### P03 — configuração desejada offline e confirmação posterior

- **Preparação:** anote em Administração a versão aplicada e sua agenda/prazo; envie `rede off` e aguarde offline.
- **Fluxo normal:** ainda com painel/backend conectados, envie em Iluminação uma agenda ou prazo diferente.
- **Esperado:** intenção é registrada e aparece como configuração enviada em confirmação; a configuração remota confirmada continua sendo a versão antiga. O ESP32 offline ainda não mudou.
- **Condição anormal:** envie uma segunda configuração diferente antes de reconectar. Tente fazer isso com backend parado: neste caso é uma falha diferente.
- **Tratamento esperado:** ao executar `rede on`, o dispositivo recebe a configuração desejada mais recente; não é obrigatório aplicar cada versão intermediária. Sem backend, envio fica indisponível/retorna erro e não deve ser mostrado como salvo ou confirmado.
- **Restaurar:** backend ativo, `rede on`; aguarde a última versão aplicada e confirme valores no serial.

### P04 — alteração local versus configuração remota confirmada

- **Preparação:** confirme pelo painel uma configuração conhecida e anote versão, brilho, agenda e prazo.
- **Fluxo normal:** com MQTT conectado, envie pelo serial `on` e `brilho 65`. Consulte Dashboard, Iluminação e Administração.
- **Esperado:** modo/brilho atuais acompanham o estado recebido do ESP32, mesmo sem incrementar a versão remota.
- **Condição anormal:** altere pelo serial `tempo 9`, `agenda 23:00 05:00` e `fuso -2`.
- **Tratamento esperado:** os **parâmetros atuais do dispositivo** passam a mostrar 9 s, 23:00–05:00 e UTC−2; a **configuração remota confirmada** continua apresentando a versão anterior e seus próprios parâmetros. O formulário desejado não se transforma em telemetria. Com firmware anterior, mostrar telemetria indisponível nesses campos. A versão aplicada é consultada no banco mesmo fora das versões recentes; se nunca foi registrada, informar ausência.
- **Restaurar:** envie nova configuração completa pelo painel e aguarde confirmação. Isso volta a alinhar parâmetros locais e remotos.

### P05 — botão abre pedido em qualquer tela e reconhecimento remoto

- **Preparação:** abra Dashboard ou Administração, deixe relógio real válido e envie modo OFF pela tela de Iluminação.
- **Fluxo normal:** pressione AJUDA; abra Assistência pelo aviso global e clique Reconhecer.
- **Esperado:** pedido aparece mesmo com luz apagada; reconhecimento aguarda resposta do ESP32. Ao confirmar, LED vermelho fica contínuo, buzzer silencia e painel mostra reconhecido.
- **Condição anormal:** mantenha AJUDA pressionado, depois solte e pressione novamente antes do reconhecimento; tente clicar Reconhecer repetidamente.
- **Tratamento esperado:** pressão mantida não abre pedidos repetidos; nova pressão reitera o mesmo requestId. O painel bloqueia a ação enquanto aguarda resultado/atualização, e transições repetidas não devem duplicar efeitos. O chamado continua sinalizado ao navegar entre telas.
- **Restaurar:** deixe reconhecido para P06, ou encerre se executar isoladamente.

### P06 — encerramento e transição proibida

- **Preparação:** use um chamado aberto pelo botão do ESP32.
- **Fluxo normal:** reconheça, aguarde o estado confirmado e clique Encerrar atendimento. Confira circuito e histórico em Administração.
- **Esperado:** assistência volta a sem chamado, LED/buzzer desligam e eventos de reconhecer/encerrar são distintos. Não confunda ações enviadas com eventos confirmados no histórico.
- **Condição anormal:** com outro chamado ainda pendente, tente encerrar antes de reconhecer; depois pressione AJUDA novamente após concluir um atendimento.
- **Tratamento esperado:** encerramento fica desabilitado enquanto pendente; backend/ESP32 também recusam transição incompatível se a interface for contornada. Novo atendimento tem requestId diferente; um comando destinado ao pedido anterior não pode agir sobre ele.
- **Restaurar:** reconhecer e encerrar o novo chamado. Para repetir IDs antigos por API, use apenas o exemplo de comando do README com dados fictícios; é uma verificação adicional, não um novo botão do produto.

### P07 — relógio inválido bloqueia ações sem esconder o chamado

- **Preparação:** abra pedido pelo botão, com dispositivo online.
- **Fluxo normal:** com `hora real` e sincronização válida, confira que Reconhecer está habilitado.
- **Condição anormal:** envie `hora invalida`; espere o painel atualizar e tente reconhecer. Repita com `hora 23:00`.
- **Tratamento esperado:** chamado permanece visível, mas ações remotas ficam bloqueadas e a interface explica a necessidade de sincronização. Horário fixo serve apenas para agenda. Se o relógio invalidar entre o clique e a atualização da tela, a recusa deve ser refletida sem assumir reconhecimento.
- **Restaurar:** `hora real`, aguardar sincronização e reconhecer/encerrar normalmente.

### P08 — som e atendimento ao navegar

- **Preparação:** abra Assistência, habilite o aviso sonoro por clique e navegue para Iluminação.
- **Fluxo normal:** pressione AJUDA; confira indicador global e aviso sonoro periódico com a aba aberta. Navegue até Assistência e reconheça.
- **Esperado:** áudio habilitado continua entre telas e silencia quando o pedido deixa de estar pendente; aviso global leva ao atendimento.
- **Condição anormal:** desative som durante pedido pendente; recarregue a página e não clique para ativá-lo. Teste navegador com áudio bloqueado.
- **Tratamento esperado:** aviso visual continua; a página não promete som sem habilitação. Recarga inicia som desativado; falha para habilitar áudio deve ser comunicada. Não conte com notificações com aba fechada ou em suspensão.
- **Restaurar:** encerre o pedido e deixe o som conforme desejado.

### P09 — navegação, edição e menu móvel

- **Preparação:** em Iluminação, altere brilho para 61 sem enviar; em Administração, selecione filtro por tipo.
- **Fluxo normal:** navegue pelas quatro telas, recolha/expanda a barra, use voltar/avançar e retorne ao formulário/filtro.
- **Esperado:** edição e filtro preservados, sem recriar atendimento, áudio ou conexão a cada tela. O valor não enviado não aparece como aplicado no ESP32.
- **Condição anormal:** abra endereço com hash desconhecido; teste largura de celular, menu aberto, Tab/Shift+Tab, Escape e uma atualização de sensor enquanto edita.
- **Tratamento esperado:** endereço desconhecido abre Dashboard; menu móvel fecha por seleção/Escape e mantém foco dentro enquanto aberto. Atualização não sobrescreve edição. Uma recarga completa pode perder rascunho/filtro em memória; isso é diferente de navegar entre telas.
- **Restaurar:** envie ou descarte manualmente os valores editados e remova filtros que não queira manter.

### P10 — histórico, filtros e eventos sem horário válido

- **Preparação:** produza movimento e um ciclo completo de assistência. Abra Administração.
- **Fluxo normal:** filtre por Chamado aberto, depois Chamado reconhecido/encerrado e por período que contenha o teste.
- **Esperado:** somente registros correspondentes; período usa recebimento no backend, não necessariamente horário do ESP32. Filtro não altera os dados gravados.
- **Condição anormal:** escolha início posterior ao fim, um período sem eventos e produza eventos com `hora invalida`, reconectando depois se necessário.
- **Tratamento esperado:** intervalo invertido mostra erro; período vazio informa ausência de registros; eventos sem UTC válido preservam horário do dispositivo ausente e usam recebimento para consulta. Não inventar horário de ocorrência. Reenvio de um mesmo eventId não cria outra linha; ações legítimas distintas possuem IDs distintos.
- **Restaurar:** `hora real`, remover filtros e conferir eventos gerais. A primeira página mostra até 100 registros; Carregar mais consulta os anteriores. Ausência na primeira página não prova perda no banco.

### P11 — perda do backend e reconexão do painel

- **Preparação:** deixe chamado reconhecido e uma edição não enviada em Iluminação. Em outro terminal do computador:

```bash
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml stop backend
```

- **Fluxo normal:** confirme aviso de ausência de atualização; continue usando PIR e botão no Wokwi. Execute `bash scripts/demo.sh` para voltar; se usa porta 3001, mantenha `DEMO_HTTP_PORT=3001` nesse comando.
- **Esperado:** painel reconecta, recupera chamado/estado e preserva o rascunho na mesma página aberta; SQLite mantém registros anteriores.
- **Condição anormal:** gere movimentos/cliques enquanto o backend está parado, mas o ESP32 ainda conectado ao broker. Tente enviar configuração ou reconhecer com o painel desconectado.
- **Tratamento esperado:** controles locais continuam; ações remotas ficam bloqueadas ou falham sem confirmação falsa. O histórico pode não conter eventos desse intervalo: o broker pode ter confirmado/removido eventos da fila do ESP32 enquanto a sessão limpa do backend estava ausente. Estado atual/chamado retornam via estado retido/NVS. Isso não é o mesmo teste de `rede off`.
- **Restaurar:** backend conectado, aguardar heartbeat e encerrar o chamado de teste. Não usar `down -v`, que apaga dados.

### P12 — ausência de confirmação e comando antigo

- **Preparação:** chamado pendente e online, relógio real válido, tela Assistência aberta.
- **Fluxo normal:** reconheça uma vez com rede estável e confira confirmação no painel/LED.
- **Condição anormal:** com outro chamado, execute `rede off` e tente Reconhecer imediatamente **enquanto o backend ainda o considera online**. Se a resposta já for offline, o teste de timeout não foi atingido: registre isso e repita apenas se necessário. Verifique em Últimas ações se houve intenção enviada.
- **Tratamento esperado:** se o comando foi aceito e não teve ACK, após dez segundos aparece Não confirmado; pedido não vira reconhecido só porque foi enviado. Depois de 60 s ele está expirado. Reconectar o ESP32 não reaplica automaticamente esse comando não retido. Se o backend reconectar ao broker enquanto ele ainda está válido, pode reenviá-lo; nesse caso o ESP32 pode confirmar e o painel deve atualizar. O estado recebido é a referência para a próxima ação.
- **Restaurar:** `rede on`, `hora real`, aguarde estado atual e validade do comando anterior antes de criar outra intenção. Reconheça/encerre o pedido conforme seu estado real. O intervalo entre falha e presença offline depende do broker; os testes automatizados são o caminho determinístico para o timeout.

## Percurso 3 — recursos consolidados e consultas completas

### P13 — troca rápida de modo sem publicar rascunho

- **Preparação:** confirme uma configuração de brilho 30% e prazo 30 s. Edite brilho para 61% e prazo para 9 s sem enviar.
- **Fluxo normal:** clique Ligado na troca rápida; aguarde confirmação e confira serial e parâmetros atuais.
- **Esperado:** somente modo muda, usando brilho/prazo da última intenção enviada; formulário conserva 61% e 9 s, sinalizados como não enviados. Enviar configuração publica então o rascunho completo. O botão ativo reflete a telemetria, não o HTTP 202.
- **Condição anormal:** tente cliques repetidos durante envio e desconecte o backend; edite um campo durante uma requisição lenta.
- **Tratamento esperado:** um envio por vez; falha não produz confirmação nem apaga rascunho. Edição feita durante envio continua marcada como não enviada. Dispositivo offline pode receber intenção posterior, mas painel sem backend não pode enviá-la.
- **Restaurar:** configuração inicial completa e confirmada.

### P14 — contagem de acionamentos e abertura estável

- **Preparação:** nenhum pedido ativo; anote hora e pressione AJUDA três vezes com soltura entre cliques.
- **Fluxo normal:** acompanhe contagem, ID e tempo desde abertura em Assistência; consulte histórico de chamados em Administração.
- **Esperado:** mesmo pedido e abertura, contagem crescente; heartbeat não reinicia a contagem de tempo. Reconhecer não encerra o chamado. Reiterar após reconhecimento preserva o comportamento definido no firmware, sem criar pedido independente.
- **Condição anormal:** recarregue a página e reinicie o ESP32 com pedido reconhecido; mantenha muitos chamados fictícios posteriores no banco isolado.
- **Tratamento esperado:** chamado ativo e abertura continuam disponíveis mesmo fora do recorte resumido de 100 registros. `reiniciar` testa NVS; recarga testa SQLite e estado recebido. Não confundir tempo desde abertura com tempo desde o reconhecimento.
- **Restaurar:** encerrar o chamado de teste.

### P15 — diagnóstico atual e compatibilidade de firmware

- **Preparação:** abrir Administração com firmware atualizado e conexão ativa.
- **Fluxo normal:** conferir boot, sequência, uptime recebido, relógio, persistência, perdas e acionamentos; alterar prazo/agenda/fuso pelo serial e conferir parâmetros atuais.
- **Esperado:** dados vêm do último estado MQTT. Uptime não avança artificialmente no navegador. Configuração remota confirmada permanece separada de alterações locais.
- **Condição anormal:** usar cliente isolado que omita `runtimeSettings`, publique `persistenceOk=false` e `droppedEvents>0`; depois desconectá-lo.
- **Tratamento esperado:** firmware antigo continua aceito, sem preencher campos ausentes com padrões inventados; falha/perdas ficam visíveis e valores offline são antigos. Isso verifica apresentação, não uma falha física de NVS.
- **Restaurar:** estado válido e reconexão; firmware atualizado no Wokwi.

### P16 — paginação de todas as coleções

- **Preparação:** banco isolado com mais de 100 eventos, chamados, comandos e configurações; não gerar carga no broker público.
- **Fluxo normal:** em cada lista de Administração, carregar mais até o fim; conferir IDs únicos, datas e quantidade; navegar para outra tela e voltar.
- **Esperado:** registros antigos acessíveis, sem limite total de 100; comandos exibem ação/pedido/validade/motivo, configurações exibem versão e parâmetros, chamados exibem contagem/abertura/alteração. Eventos oferecem detalhes de ID, boot e uptime.
- **Condição anormal:** produzir atualização enquanto lê páginas antigas, trocar filtros de eventos, inverter período e interromper uma consulta.
- **Tratamento esperado:** página antiga permanece; Atualizar consulta retorna à primeira página. Trocar filtros reinicia a consulta e cancela resposta anterior. Erros não aparecem como lista completa ou sucesso. Em coleções mutáveis, Atualizar consulta recupera resultados recentes.
- **Restaurar:** remover filtros, atualizar consultas e descartar apenas o ambiente isolado.

### P17 — versão aplicada antiga ou desconhecida

- **Preparação:** no banco isolado, criar mais de 30 configurações; publicar estado com versão aplicada existente anterior às 30 recentes.
- **Fluxo normal:** consultar configuração remota confirmada.
- **Esperado:** parâmetros corretos dessa versão, obtidos diretamente no banco; última intenção enviada pode ser diferente.
- **Condição anormal:** publicar versão aplicada sem registro no banco.
- **Tratamento esperado:** informar ausência, sem usar a última intenção como confirmação. Parâmetros atuais do dispositivo continuam visíveis quando transmitidos.
- **Restaurar:** alinhar estado e configuração por envio confirmado.

### P18 — URL única, teclado e tamanhos de tela

- **Preparação:** abrir `/`, `/dashboard` e `/dashboard/`; testar 390, 768, 1024 e 1440 px.
- **Fluxo normal:** verificar quatro telas, áudio e navegação; usar teclado, menu móvel, Escape, link de pular conteúdo e voltar/avançar.
- **Esperado:** URLs antigas redirecionam para `/`; não há segundo frontend, login, token ou botão Sair. Tabelas extensas rolam dentro do cartão sem alargar a página. Conteúdo de Administração oculto não participa do foco nas demais telas.
- **Condição anormal:** hash desconhecido, backend indisponível e navegador sem `crypto.randomUUID`.
- **Tratamento esperado:** hash retorna ao Dashboard; desconexão explícita; ações geram identificador válido pela alternativa. Mensagem de envio não equivale à aplicação pelo ESP32.
- **Restaurar:** reconectar e encerrar apenas o chamado fictício.

## Percurso 4 — contrato HTTP, WebSocket e MQTT

Use instância isolada para mensagens inválidas e adulterações; não publique esses ensaios no namespace do usuário. Os scripts existentes exercitam parte destes cenários de forma determinística.

### A01 — todas as rotas e conexão sem autenticação

- **Preparação:** backend com banco temporário; executar tanto com `DEMO_MODE=true` quanto com MQTT TLS.
- **Fluxo normal:** consultar `/health/live`, `/health/ready`, `/ui-config`, `/api/status`, as quatro coleções e `/api/commands/:id`; conectar em `/ws` sem mensagem inicial.
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
- **Fluxo normal:** POST `/api/commands`, consultar resultado por ID, repetir corpo idêntico e encerrar com CLOSE_HELP/ID novo somente após ACKNOWLEDGED.
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

## Percurso 5 — falhas, recuperação e operação

### F01 — limites de tempo e funcionamento local

- **Preparação:** circuito ativo; agenda diurna e noturna, limites 00:00/23:59, fuso −12/+14 e prazo mínimo/máximo.
- **Fluxo normal:** complementar S04–S06 com agenda que não cruza meia-noite; testar entrada inclusiva e saída exclusiva, movimento contínuo e novo movimento antes do prazo.
- **Condição anormal:** interromper rede/NTP durante acionamento do PIR e botão; alternar relógio real, fixo e inválido.
- **Tratamento esperado:** luz/botão continuam locais, sem bloqueios de 30 s por tentativa de rede; agenda inválida não substitui anterior; fallback sem relógio permite movimento. Uptime/millis usa diferença sem sinal; ensaio de rollover e medida de latência exigem instrumentação específica.
- **Restaurar:** hora real, UTC−3 e configuração padrão.

### F02 — distinguir falhas de dispositivo, broker e consumidor

- **Preparação:** ambiente isolado, chamado ativo e rascunho em edição.
- **Fluxo normal:** interromper separadamente Wi-Fi do ESP32 (`rede off`), broker, backend e conexão do navegador; recuperar um por vez.
- **Esperado:** informações distinguem painel/backend, backend/broker e dispositivo. Heartbeat 15 s, expiração de presença 45 s e Last Will offline; reconexão com backoff até 30 s no firmware/backend. Estados locais não dependem do consumidor.
- **Condição anormal:** reconexões repetidas, client ID duplicado, snapshot retido sem heartbeat novo e múltiplas abas com ações simultâneas.
- **Tratamento esperado:** sem presença falsa ou confirmação otimista; uma aba recebe resultado da outra e transições inválidas são recusadas. Client IDs duplicados causam expulsões e precisam ser corrigidos; painel não resolve colisões sozinho.
- **Restaurar:** uma instância por dispositivo/client ID, serviços conectados e estado novo.

### F03 — persistência e replay de intenções

- **Preparação:** configuração pendente e comando ainda válido em banco isolado; chamado persistido no firmware.
- **Fluxo normal:** reiniciar backend/broker; verificar SQLite, configuração retida e replay somente de comandos pendentes/não confirmados ainda válidos. Reiniciar firmware com chamado pendente e reconhecido em ensaios separados.
- **Condição anormal:** expirar comando antes do replay, simular queda entre persistir e publicar e repetir ACK/comando após reinício.
- **Tratamento esperado:** intenção não desaparece antes da publicação; comando expirado não é reenviado. Chamado/resultado de comando no firmware são persistidos atomicamente. Interrupção durante gravação NVS e migração de formato antigo exigem firmware/simulador instrumentado.
- **Restaurar:** serviços ativos; finalizar apenas pedidos fictícios. Parar/reabrir Wokwi é teste distinto de `reiniciar` e pode não preservar flash do simulador.

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
- **Produto:** um dispositivo/ambiente, sem notificações garantidas em segundo plano, sem certificação médica ou garantia de prevenção de quedas. Variante ESP-IDF 5 não validada. Não adicionar controles remotos de teste para ocultar essas limitações.


## Verificações efetivamente executadas nesta consolidação

Em 12/11/2026, passaram os 12 testes de backend em Docker Node 22.21.1, a integração demo isolada, a integração MQTT TLS/ACL e a persistência após reinício de backend/broker. A imagem com TypeScript/Vite e único frontend foi construída; as duas compilações PlatformIO Core 6.1.18 (`esp32dev` e `esp32demo`) passaram. Os scripts também passaram pela verificação sintática Bash.

O navegador, com cliente MQTT de teste representando o dispositivo, validou troca rápida sem publicar rascunho, configuração confirmada, contagem de cliques, reconhecer/recarregar/encerrar, ativação de áudio, reconexão preservando edição/som, parâmetros atuais separados dos remotos, sinalização de persistência falha e IDs sem `randomUUID`. Consultas com 125 registros por coleção, filtros e preservação de páginas ao navegar foram verificadas. As quatro telas passaram em 390/768/1024/1440 px; o foco inicial/retorno do menu móvel foi corrigido e conferido em três recargas consecutivas.

Essas verificações não executaram o firmware no Wokwi nem em hardware e não aprovam automaticamente os 40 cenários manuais. As pendências acima permanecem abertas.

## Encerramento e verificações de apoio

Ao terminar, restaure modo AUTO, brilho 30%, prazo 30 s, agenda 22:00–06:00, `fuso -3`, `hora real` e `rede on`. Confirme configuração pelo painel, finalize somente os chamados fictícios e remova filtros. Não apague o banco como parte da restauração normal.

Para apoiar a investigação de falhas sem depender do broker público:

```bash
bash scripts/test-backend.sh
bash scripts/test-demo.sh
bash scripts/test-integration.sh
```

Esses testes usam Docker e um cliente MQTT que representa o dispositivo; não executam o firmware nem comprovam PIR, PWM, debounce ou NVS no Wokwi. `test-demo.sh` cobre comunicação HTTP/WebSocket/MQTT, configuração e assistência; `test-integration.sh` cobre a alternativa TLS e persistência. Os testes de backend exercitam timeout, correlação e deduplicação de forma controlada. Não use resultados desses scripts como resultado observado dos percursos manuais acima.
