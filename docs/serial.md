# Manual do serial — NightCare

Documento exclusivo dos comandos e ensaios do monitor serial do ESP32. A operação apresentada no pitch está no [manual da interface](manual.md); a preparação dos pacotes está no [README](../README.md).

## Preparar o terminal correto

Abra o monitor serial da simulação desejada em **115200 baud**. Cada simulação usa seu próprio pacote e deviceId. `status` informa a identidade do dispositivo: mudanças neste terminal afetam somente esse ESP32. O firmware não conhece o nome do leito, que é mantido no backend.

Use uma linha por comando. Anote os valores antes de testar. Para isolar ensaios locais na demo, use `rede off`; isso preserva o loop local. `rede on` restaura a rede. Esses dois comandos não estão disponíveis na compilação TLS.

## Referência de comandos

| Comando | Efeito e limites |
| --- | --- |
| `ajuda`, `status` | ajuda e consulta, sem alterar o estado |
| `auto`, `on`, `off` | modo automático, sempre ligado ou desligado |
| `brilho N` | inteiro de 1 a 100% |
| `tempo N` | inteiro de 1 a 600 segundos após PIR ficar inativo |
| `agenda HH:MM HH:MM` | início inclusivo/fim exclusivo; cruza meia-noite; horários iguais habilitam 24 h |
| `fuso N` | offset UTC inteiro −12..+14, sem horário de verão |
| `hora HH:MM` | congela horário de teste da agenda; não autoriza comandos remotos |
| `hora invalida` | simula relógio inválido; AUTO aceita movimento em qualquer horário |
| `hora real` | volta ao relógio real; aguardar NTP para atendimento remoto |
| `reconhecer`, `encerrar` | transições locais de teste; encerramento exige reconhecimento prévio |
| `reiniciar` | reinício do ESP32 para ensaiar NVS |
| `rede off`, `rede on` | apenas demo: pausa/restaura Wi-Fi sem parar o firmware |

## Ensaios locais

Os passos abaixo se aplicam ao ESP32 do terminal selecionado. Observações de PIR, LED e buzzer são evidências do circuito, não ações no dashboard. O prazo é medido após o PIR ficar inativo, pelo tempo da simulação.

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

### S09 — pausa e retorno da rede sem parar o loop

- **Preparação:** na demo, envie `rede on` e aguarde a mensagem de conexão no serial. Consulte `status` e anote requestId/configuração.
- **Fluxo normal:** envie `rede off`; consulte `status`, altere brilho/modo e use reconhecimento/encerramento locais de um pedido fictício existente. Depois envie `rede on`.
- **Esperado:** Wi-Fi pausa e retorna; o terminal e os controles locais continuam responsivos. Nenhum comando de rede muda por si só iluminação ou assistência.
- **Condição anormal:** repetir `rede off`/`rede on` e tentar usar esses comandos em uma compilação TLS.
- **Tratamento esperado:** repetição não reinicia o dispositivo; TLS não oferece esses comandos de teste. O serial não expõe ocupação da fila nem comprova entrega ao backend; o ensaio completo de fila/perdas está na auditoria técnica.
- **Restaurar:** `rede on`, `hora real`, configuração original e assistência fictícia finalizada.

## Restaurar

No dispositivo testado, retorne a `auto`, `brilho 30`, `tempo 30`, `agenda 22:00 06:00`, `fuso -3`, `hora real` e, na demo, `rede on`. Finalize somente chamados fictícios, usando `reconhecer` antes de `encerrar`. Refaça a restauração em cada terminal usado.

Configuração e assistência são NVS; fila/contador de perdas são RAM. `reiniciar` e parar/reabrir uma simulação são ensaios diferentes. Não copie uma identidade para outra simulação nem interprete compilação como execução desses ensaios.
