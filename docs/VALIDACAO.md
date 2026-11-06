# Roteiro de testes do NightCare

Este roteiro começa pela preparação do ambiente e separa testes locais do ESP32 de testes dos painéis com comunicação MQTT. Cada teste contém um fluxo normal e uma condição anormal, com o tratamento esperado. Registre o observado ao executar; os resultados esperados não são comprovação de execução no Wokwi.

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
- **Condição anormal:** altere pelo serial `tempo 9` e `agenda 23:00 05:00`.
- **Tratamento esperado:** esses campos não fazem parte da telemetria atual. Administração mantém agenda/prazo como **configuração remota confirmada**, com aviso de origem; não deve apresentar o formulário desejado nem a configuração antiga como medida ao vivo desses campos. Se a versão aplicada não estiver no histórico recente, o painel informa detalhes indisponíveis.
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
- **Restaurar:** `hora real`, remover filtros e conferir eventos gerais. Lista mostra até 100 registros; ausência na lista não prova perda no banco.

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

## Encerramento e verificações de apoio

Ao terminar, restaure modo AUTO, brilho 30%, prazo 30 s, agenda 22:00–06:00, `fuso -3`, `hora real` e `rede on`. Confirme configuração pelo painel, finalize somente os chamados fictícios e remova filtros. Não apague o banco como parte da restauração normal.

Para apoiar a investigação de falhas sem depender do broker público:

```bash
bash scripts/test-backend.sh
bash scripts/test-demo.sh
bash scripts/test-integration.sh
```

Esses testes usam Docker e um cliente MQTT que representa o dispositivo; não executam o firmware nem comprovam PIR, PWM, debounce ou NVS no Wokwi. `test-demo.sh` cobre comunicação HTTP/WebSocket/MQTT, configuração e assistência; `test-integration.sh` cobre a alternativa TLS e persistência. Os testes de backend exercitam timeout, correlação e deduplicação de forma controlada. Não use resultados desses scripts como resultado observado dos percursos manuais acima.
