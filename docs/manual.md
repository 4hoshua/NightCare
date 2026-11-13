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

- **Dashboard:** mostra todos os leitos associados. Use **Buscar leito ou dispositivo** para filtrar os cartões por nome ou ID, sem diferenciar maiúsculas ou acentos; **Limpar busca** volta a exibir todos. A busca acontece no navegador. Dispositivos sem leito aparecem para associação e seus chamados conhecidos continuam visíveis, mesmo durante a busca.
- **Sino de notificações:** abre a atividade de todos os dispositivos, com filtros, horários e **Ver detalhes** para ir à tela do destinatário. O contador representa as notificações não lidas neste navegador; abrir ou atualizar a central não zera o contador. Use **Atualizar** para trazer novidades à lista aberta, **Carregar mais** para consultar as anteriores e **Marcar todas como lidas** para zerar o contador e remover os destaques, com confirmação visível. O histórico cobre os últimos 30 dias. Todas as novas notificações também aparecem em toasts com o leito/dispositivo e acesso aos detalhes, incluindo movimento, luz e presença; rajadas são resumidas em até três avisos simultâneos. O som continua dedicado aos chamados.
- **Estados nos cartões:** luz acesa tem lâmpada dourada iluminada; apagada tem lâmpada riscada. Movimento detectado pulsa discretamente. Chamado pendente destaca sino e borda dourada; reconhecido mostra confirmação. Relógio inválido usa triângulo de alerta. Ícones acompanham os textos; sem dados aparece “Sem informação”. Offline ou sem conexão, não há animação de atividade e os valores são a última informação recebida. A preferência por movimento reduzido mantém os sinais estáticos. Os botões ficam no rodapé, alinhados entre cartões da mesma linha, sem a mensagem adicional de última informação.
- **Selecionar leito ou dispositivo:** fica na faixa **Dispositivo em acompanhamento**, dentro de Iluminação e movimento, Assistência e Administração, antes dos controles. Define o destinatário dessas telas; o ID selecionado aparece ao lado. O Dashboard tem visão global, sem seletor de leito.
- **Iluminação:** um cartão reúne modo, brilho, prazo e agenda. Toda edição, inclusive Automático/Ligado/Desligado, fica como rascunho até **Aplicar configuração**. A lâmpada do slider é uma prévia local, distinta do estado real. O relógio abre o seletor próprio de hora/minuto, com **Definir horário** e **Cancelar**. As explicações ficam nos botões **?**, por hover, teclado ou toque. Detalhes de configuração ficam somente na Administração. Rascunhos e período dos gráficos são separados por leito.
- **Gráficos da iluminação:** escolha 24 h, 7 dias, 30 dias ou Agenda do leito. Consulte movimentos por hora, movimentos/acionamentos ao longo do período e distribuição dentro/fora da agenda atual de referência. Use hover ou toque nas barras, ou navegue entre elas com as setas no teclado. A referência vem do dispositivo/versão confirmada, nunca da edição em curso; não representa todas as agendas antigas. Sem horário original, o recebimento é aproximado. Sem registros, não inferir ausência física de movimento. Os gráficos não estimam duração ou consumo.
- **Assistência:** o cabeçalho reúne seletor de leito e sinais de assistência/relógio. Pedido e acompanhamento ficam juntos à esquerda; à direita, três indicadores do chamado atual mostram tempo desde a abertura, acionamentos (inicial/reiterações) e distribuição dos resultados dos comandos. A rosca considera somente comandos daquele chamado na amostra de até 30 comandos recentes do leito; não representa todo o histórico. Sem chamado ou data, há indicação explícita. Offline, o tempo fica na última comunicação. Explicações ficam nos botões **?**, por hover, foco ou toque. Os cards têm dimensões iguais no desktop e empilham em telas menores. Reconhecer precede Encerrar; som e lista global consideram todos os dispositivos.
- **Administração:** reúne header por dispositivo, registro de toda a instalação e informações detalhadas do dispositivo selecionado. Associa dispositivos encontrados e corrige nomes; não há transferência/substituição/remoção de vínculo. O header contém seletor/identidade e estado de conexão. Dispositivos e leitos e observabilidade têm dimensões iguais e altura estável: 600 px, ou 680 px até 700 px de largura. O registro mostra dois dispositivos por página, com Anterior/Próxima e rolagem interna, preservando rascunhos ao paginar. Os dois gráficos mostram presença e mensagens recebidas nas últimas 24 horas. Abaixo, o card Configurações e diagnóstico ocupa toda a largura, com abas próprias por leito; use setas/Home/End para alternar pelo teclado.
- **Histórico:** página própria na navbar. Dois cards: registros em abas Eventos/Chamados/Configurações e comandos. Filtros independentes por período, tipo, resultado e ação conforme a coleção; consulta global ou por dispositivo. Anterior/Próxima navegam páginas de 25 registros; Atualizar consulta volta à primeira. As tabelas têm rolagem interna. Datas usam recebimento nos eventos, abertura nos chamados e criação nos comandos/configurações.
- **Edições:** trocar de tela ou dispositivo preserva rascunhos e filtros na mesma página aberta. Recarregar o navegador pode descartá-los; a seleção do dispositivo fica no endereço.
- **Presença:** painel, broker e dispositivo têm conexões distintas. Offline, valores conhecidos são última informação recebida; um dispositivo offline não altera os demais.
- **Confirmação:** configuração desejada, configuração remota confirmada e parâmetros atuais são informações distintas. Sem telemetria dos parâmetros atuais, informar ausência, sem inventar valores.

Os menus de opções seguem o tema noturno. Além do clique, aceitam setas, Home/End, busca por digitação e Enter para escolher. Escape fecha somente a lista aberta; outro Escape fecha a central. Tab avança para o próximo controle. O sino anima ao abrir, e o painel aparece/desaparece suavemente; movimento reduzido é respeitado.

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
- **Esperado:** movimento/luz apenas no primeiro; ícone de movimento pulsa e lâmpada ganha brilho dourado. A luz permanece durante PIR ativo e apaga após inatividade mais prazo; o ícone volta a lâmpada riscada e o movimento fica estático.
- **Exceção:** movimento renovado antes do prazo mantém luz; ausência de dados em um cartão não deve copiar o estado do outro.
- **Restaurar:** aguardar os dois circuitos em repouso.

### I04 — formulário e limites

- **Preparar/agir:** no leito selecionado, enviar modos AUTO/ON/OFF, brilho e prazo válidos; conferir confirmação e estado.
- **Esperado:** alterações só naquele dispositivo; agenda com horários iguais habilita 24 h.
- **Exceção:** slider limita brilho a 1–100% e o seletor limita horários válidos. Prazo vazio, 0/601 ou fracionário deve impedir envio sem aplicação parcial.
- **Restaurar:** enviar configuração inicial válida e aguardar confirmação.

### I05 — prévia e aplicação conjunta preservam rascunho

- **Preparar/agir:** com brilho confirmado de 30%, editar para 61%, escolher Ligado e definir horários sem aplicar.
- **Esperado:** lâmpada de prévia muda de intensidade, mas estado real e agenda de referência permanecem os anteriores. Nenhuma configuração é publicada até **Aplicar configuração**, que envia o conjunto.
- **Exceção:** edições durante o envio continuam como rascunho após a resposta; cliques repetidos não criam envios paralelos. Erro não apaga edição nem confirma aplicação. Cancelar o seletor de horário preserva o valor anterior.
- **Restaurar:** aplicar a configuração inicial completa e aguardar confirmação.

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

- **Preparar/agir:** produzir movimento e ciclo de assistência; filtrar por tipo e período na página Histórico.
- **Esperado:** consulta do dispositivo selecionado, com leito/ID, recebimento, ocorrência e detalhes de evento. Todos os dispositivos amplia explicitamente a consulta.
- **Exceção:** período invertido mostra erro; período vazio mostra ausência; horário do ESP32 ausente não é inventado. Trocar filtro descarta resposta anterior.
- **Restaurar:** limpar filtros e atualizar consulta.

### I12 — demais históricos e paginação

- **Preparar/agir:** conferir chamados, comandos e configurações, primeiro por dispositivo e depois globalmente; usar Anterior/Próxima com massa preparada no ambiente isolado.
- **Esperado:** IDs, abertura, contagem, parâmetros, validade, resultado e motivos corretos; IDs locais iguais de dispositivos distintos não se confundem.
- **Exceção:** novas atualizações não removem páginas antigas; Atualizar consulta volta aos recentes. Falha de consulta aparece como erro, sem fingir resultado completo.
- **Restaurar:** retornar ao dispositivo selecionado e atualizar consulta.

### I13 — rascunhos e filtros por dispositivo

- **Preparar/agir:** editar brilho no Leito 1 sem enviar, trocar para Leito 2 e editar outro valor; alternar telas e retornar.
- **Esperado:** cada rascunho/filtro é preservado separadamente. Nenhuma troca de seleção publica alterações. O leito destinatário permanece explícito.
- **Exceção:** receber heartbeat ou configuração de outro leito não sobrescreve edição. Envio em andamento deve continuar identificado pelo destinatário original.
- **Restaurar:** enviar ou corrigir manualmente os valores de teste em cada leito.

### I14 — navegação, celular e teclado

- **Preparar/agir:** abrir as cinco telas em 390/768/1024/1440 px; recolher menu, usar voltar/avançar, Tab, Shift+Tab, Escape e pular conteúdo.
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

### I19 — central de notificações

- **Preparar/agir:** com dois dispositivos conectados, provoque movimento, luz e chamados de teste. Abra o sino, filtre por dispositivo/categoria, carregue mais e use **Ver detalhes**.
- **Esperado:** cada ocorrência identifica o destinatário e horário; o link abre o dispositivo correto. Avisos importantes aparecem por oito segundos e pausam durante interação. A lista mantém as páginas consultadas até **Atualizar**.
- **Exceção:** heartbeats não geram avisos; ausência de resultados mostra mensagem; desconexão do painel mantém os dados já carregados. Reconectar não reapresenta histórico em avisos. Uma falha do broker aparece como ocorrência global.
- **Restaurar:** confirme que abrir/atualizar preserva as não lidas, limpe os filtros, marque todas como lidas e observe contador/destaques zerados e confirmação. Feche por Escape. Recarregue para confirmar a leitura neste navegador; outro navegador mantém leitura própria.

### I20 — menus de opções e animações

- **Preparar/agir:** abra os seletores de dispositivo, modo, histórico e filtros de notificações. Escolha por clique/toque e por teclado (setas, Home/End, digitação e Enter).
- **Esperado:** mesma aparência noturna, opção selecionada identificada e opções longas disponíveis com rolagem. A lista cabe na tela, inclusive no celular. Alterar o modo no formulário só edita o rascunho até enviar.
- **Exceção:** Escape fecha primeiro a lista, mantendo a central; Tab avança sem escolher outra opção. Sem dispositivos, o seletor informa espera e fica indisponível. Movimento reduzido desativa as animações do sino e das listas.
- **Restaurar:** volte aos filtros originais, descarte rascunhos de teste e feche a central; confirme abertura e fechamento suaves.

### I21 — gráficos, detalhes e troca de leito

- **Preparar/agir:** abrir Iluminação e movimento, consultar os botões **?**, escolher os três períodos e alternar os leitos com rascunhos diferentes.
- **Esperado:** a Administração mantém atual/confirmado/enviado; período e rascunho são preservados por leito. Gráficos compactos têm explicações nos tooltips, larguras iguais na dupla inferior e empilhamento em telas menores. Cartões e gráficos têm transição ao ativar leito/período. Heartbeats não reiniciam animações. Barras mostram os valores por hover, toque e teclado, sem tabelas adicionais.
- **Exceção:** sem registros, mostrar ausência de eventos, sem simular dados; sem agenda, não classificar dentro/fora. Falha de consulta preserva a última consulta daquele período/leito; respostas atrasadas não podem sobrescrever a seleção atual. Offline, sinais param e histórico fica identificado como última consulta. Movimento reduzido desativa animações.
- **Restaurar:** retornar às últimas 24 h, fechar os tooltips e restaurar configurações dos leitos.

## Encerramento e pendências

Restaure em cada leito AUTO, brilho 30%, prazo 30 s e agenda 22:00–06:00 pela interface; aguarde confirmação. Finalize os pedidos fictícios, limpe filtros e deixe som conforme desejado. Não apague volumes nem refaça vínculos para restaurar a apresentação.

Compilações e clientes MQTT de teste não substituem execução observada de duas simulações Wokwi. Circuito, debounce, PWM, latência e NVS precisam de ensaios próprios. Resultados efetivamente executados e limitações ficam na [auditoria técnica](auditoria.md).

O período **Agenda do leito** usa a execução mais recente da agenda aplicada: desde o início até agora, quando em andamento, ou a última janela encerrada. Considera virada de dia e fuso do dispositivo; horários iguais significam 24 horas. A edição ainda não aplicada não altera o intervalo. Sem agenda conhecida, a opção fica indisponível.


### I22 — assistência compacta e indicadores por chamado

- **Preparar/agir:** abrir Assistência com chamado fictício, reiterar AJUDA e observar os três indicadores. Trocar de leito e reconhecer/encerrar separadamente.
- **Esperado:** cabeçalho com seletor e sinais; pedido/acompanhamento à esquerda e KPIs à direita, com larguras/alturas iguais a partir de 1440 px. Contagem e barra mudam apenas no chamado correspondente; rosca filtra pelo ID atual. Transições não reiniciam em heartbeats sem alteração. Tempo não representa prazo ou tempo até reconhecimento.
- **Exceção:** sem chamado/dados há estado vazio; sem data de abertura, tempo desconhecido; offline conserva última informação e desabilita ações. Relógio inválido e comando pendente mantêm avisos operacionais. Tooltip da rosca explica a amostra limitada. Validar ajuda por teclado/toque/Escape e preferência de movimento reduzido; telas menores empilham sem overflow.
- **Restaurar:** encerrar os chamados fictícios e voltar ao leito inicial.


### I23 — Administração e observabilidade

- **Preparar/agir:** selecionar um dispositivo com estado novo. Observar presença e comunicações nas últimas 24 horas; alternar leitos, abrir configurações e diagnóstico e consultar as ajudas **?**.
- **Esperado:** quatro cards principais; header com seletor e identidade, registro paginado de dois dispositivos, observabilidade somente do selecionado e card de configurações/diagnóstico em abas. A dupla central mantém largura/altura iguais e não cresce com o total de dispositivos. Cada barra de presença distribui uma hora entre online/offline/sem observação; barras de comunicação contam recebimentos válidos, incluindo reentregas QoS. Valores por hover, toque e foco/setas/Escape. Janela até o último minuto completo; coleta iniciada agora não traz dados anteriores.
- **Exceção:** pausas do backend/broker não viram offline. Retidos não confirmam presença nem contam como comunicação. Falha de API preserva o gráfico anterior e oferece tentar novamente. Preferência de movimento reduzido desativa transições. Não interpretar presença como garantia de funcionamento físico.
- **Restaurar:** retornar ao leito inicial e fechar detalhes; executar falhas somente em ambiente isolado.

### I24 — Histórico separado, limitado e filtrado

- **Preparar/agir:** abrir Histórico, consultar abas e comandos, filtrar por tipo/estado/ação/período e alternar alcance dispositivo/global. Navegar até a segunda página, mudar de tela e voltar.
- **Esperado:** até 25 linhas por card/página, tabelas com rolagem própria e navegação acessível; abas, filtros e página ficam preservados entre telas. Novas atividades não deslocam a leitura. Trocar filtro reinicia na primeira página. Configurações/chamados preservam todos os detalhes antes consultados na Administração.
- **Exceção:** intervalo invertido mostra erro; filtros sem resultados mostram vazio. Falha de consulta não publica sucesso nem altera outro card. Checar teclado e layouts estreitos.
- **Restaurar:** limpar filtros, atualizar consultas e retornar ao dispositivo selecionado.


### I25 — paginação estável e detalhes em abas

- **Preparar/agir:** em ambiente isolado, exibir 0, 1, 2, 3 e vários dispositivos. Editar nome, paginar e voltar; repetir durante envio e em erro. Alternar as abas de detalhes, trocar de leito e retornar.
- **Esperado:** até dois registros por página; largura/altura iguais nos cards de registro e observabilidade, sem mudar pela quantidade de dispositivos. Paginação no rodapé; conteúdo excedente rola internamente. Rascunho, resultado de envio e erro não são perdidos ao paginar. Lista menor ajusta a página para a última válida; heartbeat/renomeação não reiniciam a paginação. Abas abrem Configurações por padrão e preservam seleção por leito, com Tab/setas/Home/End. Relógio e chamado permanecem no diagnóstico, não no header.
- **Exceção:** nenhum registro preserva área vazia e desabilita paginação. Nomes/erros longos não ampliam os cards. Em telas menores os cards empilham; verificar 320 a 1920 px e movimento reduzido.
- **Restaurar:** limpar rascunhos, retornar à primeira página e à aba Configurações; não remover associações reais para este ensaio.
