# Manual da interface e roteiro do pitch — NightCare

Este é o documento principal para apresentar e operar o NightCare. Os comandos do ESP32 estão exclusivamente em [serial.md](serial.md); contratos e infraestrutura estão na [auditoria técnica](auditoria.md). Preparação e execução: [README](../README.md).

## Preparação da apresentação

Prepare dois pacotes, um para `nightcare-001` e outro para `nightcare-002`, conforme o README. Abra dois projetos/cópias distintos no Wokwi em janelas separadas, cada uma com os quatro arquivos do seu pacote. Mantenha ambas em execução e visíveis quando possível. Não duplique a identidade de uma simulação.

Abra o dashboard em `/`. Na Administração, confira os dois dispositivos encontrados e o recebimento de estado novo. Em uma instalação nova, associe um ao **Leito 1** e o outro ao **Leito 2**. Em banco migrado, o dispositivo anterior já estará no Leito 1: confirme apenas o novo. A associação é permanente nesta versão; o nome pode ser corrigido.

Para testar iluminação durante o dia, selecione cada leito em Iluminação e movimento, envie AUTO, brilho 30%, prazo 5 s e agenda 00:00–00:00. Aguarde confirmação por dispositivo. Confira relógio sincronizado e presença online. Use apenas chamados fictícios.

## Pitch sugerido — cinco a sete minutos

1. **Apresente o problema e a visão geral.** “Cada leito possui seu próprio assistente. O cuidador acompanha todos em um painel.” Mostre os cartões dos dois leitos e a identificação de luz, movimento, relógio e assistência.
2. **Demonstre movimento independente.** No circuito Wokwi do Leito 1, acione o PIR por Simulate Motion. Mostre luz/movimento somente no cartão do Leito 1, mantendo o Leito 2 em repouso. Aguarde PIR inativo e o prazo para apagar.
3. **Ajuste um leito.** Abra a iluminação do Leito 1, troque o modo ou envie um novo brilho. Mostre a intenção enviada e depois a confirmação pelo dispositivo. O Leito 2 conserva sua configuração.
4. **Abra dois pedidos de ajuda.** Pressione AJUDA em cada circuito. Mostre os dois chamados na lista global, com nomes dos leitos. O botão funciona mesmo com a iluminação desligada.
5. **Atenda um sem encerrar o outro.** Selecione o chamado do Leito 1, reconheça e encerre após confirmação. O chamado do Leito 2 continua visível. Explique que “enviado” ainda não significa “aplicado”.
6. **Mostre acompanhamento e histórico.** Em Administração, consulte eventos do leito selecionado e depois Todos os dispositivos. Mostre leito/dispositivo, horários, identificação e resultados dos comandos.
7. **Conclua com os limites.** A iluminação e o botão operam localmente; avisos remotos dependem de conexão e do painel aberto. É um protótipo acadêmico de apoio, sem certificação médica ou garantia de prevenção de quedas.

O som é opcional: habilite por clique antes de abrir os pedidos. Evite ensaios de rede, serial, banco e certificados durante o pitch. Faça esses testes separadamente.

## Regras de operação

- **Dashboard:** mostra todos os leitos associados. Dispositivos sem leito aparecem para associação e seus chamados conhecidos continuam visíveis.
- **Selecionar leito ou dispositivo:** define o destinatário das telas de iluminação, assistência e diagnóstico. A identificação selecionada aparece antes dos controles.
- **Iluminação:** configura modo, brilho, prazo e agenda do dispositivo selecionado. Troca rápida usa a última intenção enviada ou padrões se nenhuma existir; não publica os demais campos em edição.
- **Assistência:** um chamado ativo por dispositivo; vários dispositivos podem ter chamados simultâneos. Reconhecer precede Encerrar. Som e lista global consideram os chamados de todos os dispositivos.
- **Administração:** associa dispositivos encontrados, corrige nomes e consulta históricos por dispositivo ou globais. Não há ação de transferir/substituir/remover um vínculo.
- **Históricos:** filtros por tipo/período nos eventos; Carregar mais acessa registros anteriores; Atualizar consulta volta aos recentes. O período usa recebimento no backend.
- **Edições:** trocar de tela ou dispositivo preserva rascunhos e filtros na mesma página aberta. Recarregar o navegador pode descartá-los; a seleção do dispositivo fica no endereço.
- **Presença:** painel, broker e dispositivo têm conexões distintas. Offline, valores conhecidos são última informação recebida; um dispositivo offline não altera os demais.
- **Confirmação:** configuração desejada, configuração remota confirmada e parâmetros atuais são informações distintas. Sem telemetria dos parâmetros atuais, informar ausência, sem inventar valores.

## Roteiro de validação pela interface

Registre teste, data, executor, condição inicial, resultado observado, evidência e restauração. Os resultados esperados abaixo não comprovam execução. Estímulos no circuito Wokwi fazem parte da demonstração; este roteiro não exige comandos no monitor serial.

### I01 — descobrir e associar

- **Preparar/agir:** iniciar uma simulação ainda não associada e abrir Administração. Informar um nome e confirmar.
- **Esperado:** dispositivo aparece pelo ID; após associação, aparece pelo nome no seletor e no Dashboard.
- **Exceção:** dispositivo offline ou apenas fotografia antiga: associação indisponível até estado novo. Nome vazio não é enviado; nome duplicado retorna erro.
- **Restaurar:** usar somente os vínculos de teste desejados, pois a associação não pode ser desfeita nesta versão.

### I02 — vínculo permanente e correção de nome

- **Preparar/agir:** corrigir nome em Administração e navegar para Dashboard/históricos.
- **Esperado:** nome atualizado, mesmo dispositivo e histórico. Não existe transferência de dispositivo para outro leito.
- **Exceção:** tentar nome já usado ou confirmar o mesmo dispositivo em outra aba; mostrar conflito sem criar vínculo adicional.
- **Restaurar:** corrigir para o nome original, sem modificar o ID.

### I03 — movimento e iluminação independentes

- **Preparar/agir:** dois leitos em AUTO, agenda 24 h e prazo 5 s. Acionar PIR somente no primeiro circuito.
- **Esperado:** movimento/luz apenas no primeiro; luz permanece durante PIR ativo e apaga após inatividade mais prazo.
- **Exceção:** movimento renovado antes do prazo mantém luz; ausência de dados em um cartão não deve copiar o estado do outro.
- **Restaurar:** aguardar os dois circuitos em repouso.

### I04 — formulário e limites

- **Preparar/agir:** no leito selecionado, enviar modos AUTO/ON/OFF, brilho e prazo válidos; conferir confirmação e estado.
- **Esperado:** alterações só naquele dispositivo; agenda com horários iguais habilita 24 h.
- **Exceção:** brilho 0/101, prazo 0/601, campos fracionários ou horários vazios devem ser bloqueados/recusados sem aplicação parcial.
- **Restaurar:** enviar configuração inicial válida e aguardar confirmação.

### I05 — troca rápida preserva rascunho

- **Preparar/agir:** com brilho confirmado de 30%, editar para 61% sem enviar; clicar Ligado na troca rápida.
- **Esperado:** modo muda usando os últimos parâmetros enviados; 61% permanece como edição não enviada. Enviar configuração publica o rascunho completo.
- **Exceção:** cliques durante envio não geram requisições paralelas; erro não apaga edição nem confirma aplicação.
- **Restaurar:** configuração inicial completa.

### I06 — configuração com dispositivo offline

- **Preparar/agir:** manter backend conectado e pausar uma simulação; aguardar indicação offline. Enviar configuração para esse leito.
- **Esperado:** intenção registrada, aguardando confirmação; outro leito permanece operacional. Após retomar, a última configuração desejada pode ser aplicada.
- **Exceção:** painel sem backend não deve permitir envio como se tivesse sido salvo. Versão pendente não substitui o resumo confirmado.
- **Restaurar:** retomar simulação e confirmar valores desejados.

### I07 — parâmetros atuais e confirmação remota

- **Preparar/agir:** conferir os três blocos de configuração em Iluminação/Administração e o diagnóstico do dispositivo selecionado.
- **Esperado:** modo/brilho e parâmetros atuais vêm da telemetria; versão desejada e confirmada mantêm suas origens. Boot, sequência, uptime recebido, persistência e perdas são visíveis.
- **Exceção:** firmware sem telemetria adicional informa ausência; versão aplicada ausente do banco não usa uma intenção pendente como substituta.
- **Restaurar:** nenhuma ação destrutiva; alinhar parâmetros por novo envio somente se necessário.

### I08 — dois chamados e reiteração

- **Preparar/agir:** pressionar AJUDA em ambos os circuitos; reiterar apenas no primeiro, soltando o botão entre pressões.
- **Esperado:** dois chamados globais; contagem aumenta apenas no primeiro, conservando ID e abertura daquele chamado.
- **Exceção:** manter botão pressionado não deve gerar cliques repetidos. Chamados sem leito aparecem identificados pelo dispositivo, sem permitir atendimento antes do vínculo.
- **Restaurar:** finalizar separadamente os chamados fictícios após reconhecer.

### I09 — reconhecer e encerrar por leito

- **Preparar/agir:** selecionar o chamado do primeiro leito, reconhecer, aguardar confirmação e encerrar.
- **Esperado:** só esse pedido muda; o segundo permanece pendente. Envio, resultado do comando e estado recebido ficam distintos.
- **Exceção:** Encerrar fica indisponível antes do reconhecimento; offline/relógio inválido/comando em andamento impedem ação incompatível.
- **Restaurar:** atender e encerrar também o chamado de teste restante.

### I10 — som global

- **Preparar/agir:** ativar som por clique e abrir chamado em um leito diferente do selecionado; navegar entre telas/leitos.
- **Esperado:** alerta considera qualquer chamado pendente, preservando habilitação ao navegar. Reconhecimento retira a condição pendente daquele chamado.
- **Exceção:** som bloqueado ou desativado não remove aviso visual. Recarga inicia som desativado. Não há garantia com aba fechada/suspensa.
- **Restaurar:** desativar som e finalizar pedidos fictícios.

### I11 — histórico de eventos e filtros

- **Preparar/agir:** produzir movimento e ciclo de assistência; filtrar por tipo e período em Administração.
- **Esperado:** consulta do dispositivo selecionado, com leito/ID, recebimento, ocorrência e detalhes de evento. Todos os dispositivos amplia explicitamente a consulta.
- **Exceção:** período invertido mostra erro; período vazio mostra ausência; horário do ESP32 ausente não é inventado. Trocar filtro descarta resposta anterior.
- **Restaurar:** limpar filtros e atualizar consulta.

### I12 — demais históricos e paginação

- **Preparar/agir:** conferir chamados, comandos e configurações, primeiro por dispositivo e depois globalmente; usar Carregar mais com massa preparada no ambiente isolado.
- **Esperado:** IDs, abertura, contagem, parâmetros, validade, resultado e motivos corretos; IDs locais iguais de dispositivos distintos não se confundem.
- **Exceção:** novas atualizações não removem páginas antigas; Atualizar consulta volta aos recentes. Falha de consulta aparece como erro, sem fingir resultado completo.
- **Restaurar:** retornar ao dispositivo selecionado e atualizar consulta.

### I13 — rascunhos e filtros por dispositivo

- **Preparar/agir:** editar brilho no Leito 1 sem enviar, trocar para Leito 2 e editar outro valor; alternar telas e retornar.
- **Esperado:** cada rascunho/filtro é preservado separadamente. Nenhuma troca de seleção publica alterações. O leito destinatário permanece explícito.
- **Exceção:** receber heartbeat ou configuração de outro leito não sobrescreve edição. Envio em andamento deve continuar identificado pelo destinatário original.
- **Restaurar:** enviar ou corrigir manualmente os valores de teste em cada leito.

### I14 — navegação, celular e teclado

- **Preparar/agir:** abrir as quatro telas em 390/768/1024/1440 px; recolher menu, usar voltar/avançar, Tab, Shift+Tab, Escape e pular conteúdo.
- **Esperado:** menu móvel contém foco e retorna ao gatilho; conteúdo de outros perfis não entra no foco; tabelas rolam dentro do cartão.
- **Exceção:** hash desconhecido retorna ao Dashboard; `/dashboard` e `/dashboard/` redirecionam para a aplicação única.
- **Restaurar:** voltar ao Dashboard e fechar menu móvel.

### I15 — perda de uma simulação

- **Preparar/agir:** pausar/parar somente a simulação do Leito 1; manter a segunda ativa e aguardar expiração de presença.
- **Esperado:** primeiro fica offline e conserva último estado conhecido; segundo permanece online e pode receber ações.
- **Exceção:** fotografia antiga não comprova reconexão. Mesmo nome de leito não corrige identidades duplicadas; cada simulação exige seu pacote.
- **Restaurar:** retomar primeira simulação e aguardar estado novo.

### I16 — reconexão do painel

- **Preparar/agir:** deixar rascunho e som habilitado; durante uma interrupção controlada do backend, observar a página aberta; retomar serviço conforme README.
- **Esperado:** aviso de desconexão, bloqueio/erro de envio e reconexão automática, preservando rascunho/som na mesma página.
- **Exceção:** histórico pode não conter eventos enviados ao broker durante ausência do consumidor; não confundir recuperação do estado atual com garantia de histórico integral.
- **Restaurar:** serviço ativo, estado novo de cada dispositivo e chamados fictícios finalizados.

### I17 — resultado não confirmado

- **Preparar/agir:** usar cenário de teste controlado sem resposta de dispositivo, preparado conforme auditoria técnica; observar Assistência.
- **Esperado:** após 10 s, comando Não confirmado; envio não reconhece/encerra automaticamente o pedido. Validade é 60 s.
- **Exceção:** ACK posterior válido atualiza o resultado; uma ação dirigida ao outro leito não confirma este comando.
- **Restaurar:** aguardar validade, conferir estado recebido e concluir apenas o pedido de teste.

### I18 — persistência e migração

- **Preparar/agir:** após reinício controlado do backend, abrir Administração e os dois detalhes; em banco migrado, conferir Leito 1 e registros antigos.
- **Esperado:** nomes, vínculos, histórico e intenções preservados; presença exige estado novo. Recarga conserva chamado reconhecido no banco, sem transformá-lo em pendente por conta da navegação.
- **Exceção:** instalação nova não inventa leitos; abre descoberta. Não oferecer exclusão/transferência de vínculo como restauração de teste.
- **Restaurar:** aguardar reconexão, revisar configurações e encerrar somente pedidos fictícios.

## Encerramento e pendências

Restaure em cada leito AUTO, brilho 30%, prazo 30 s e agenda 22:00–06:00 pela interface; aguarde confirmação. Finalize os pedidos fictícios, limpe filtros e deixe som conforme desejado. Não apague volumes nem refaça vínculos para restaurar a apresentação.

Compilações e clientes MQTT de teste não substituem execução observada de duas simulações Wokwi. Circuito, debounce, PWM, latência e NVS precisam de ensaios próprios. Resultados efetivamente executados e limitações ficam na [auditoria técnica](auditoria.md).
