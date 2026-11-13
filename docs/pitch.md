# Pitch e demonstração — NightCare

[Índice](../README.md) · [Instalação](manual.md) · [Interface](interface.md) · [Comandos seriais](serial.md)

Roteiro de **5–7 minutos** para apresentação acadêmica. As respostas abaixo são resultados esperados para a demonstração; não constituem registro de ensaio executado. Faça um ensaio prévio com a versão dos arquivos que será apresentada.

## Preparar antes da apresentação

1. Instale requisitos e inicie uma sessão conforme o manual. Para aproveitar leitos já preparados, use `bash scripts/demo.sh --resume`; não inicie sessão nova acidentalmente.
2. Abra painel e Wokwi lado a lado. Copie os quatro arquivos do pacote da sessão atual, principalmente `mqtt_demo.h`, e inicie a simulação.
3. Associe dispositivo online em Administração com nome fictício, como Leito 1. Se usar segundo dispositivo, prepare projeto separado e associe Leito 2.
4. Aguarde MQTT e relógio válido. Configure AUTO, brilho 30%, prazo 5 s e agenda 00:00–00:00; espere confirmação. Isso permite mostrar movimento em qualquer horário real, sem congelar o relógio.
5. Deixe assistência sem chamado e PIR inativo. Habilite som pelo painel se desejar demonstrá-lo. Tenha monitor serial aberto para `rede off`/`rede on`.
6. Confira internet e acesso ao broker público. Não use dados pessoais nem gere carga. Prefira a interface compilada para uma apresentação sem edições; se usar 5173, confirme que backend e fontes correspondem.

## 0:00–0:45 — Problema e proposta

**Fala sugerida:** “Durante um deslocamento noturno, uma pessoa pode precisar de iluminação e de uma forma simples de solicitar ajuda. O NightCare combina controle local de luz e botão de assistência com uma visão central dos leitos para o cuidador.”

Mostre ESP32, PIR, LED que representa a iluminação, botão AJUDA, LED de assistência e buzzer. Explique que cada leito tem dispositivo independente e que o projeto é um sistema acadêmico de apoio, sem promessa de prevenção de quedas.

## 0:45–1:30 — Como as partes se conectam

Mostre o primeiro diagrama da [arquitetura](arquitetura.md#primeira-etapa-wokwi-e-broker-público).

**Fala sugerida:** “O ESP32 toma decisões locais. O broker transporta mensagens; o backend registra e supervisiona, e a interface apresenta os leitos. Nesta primeira etapa, usamos Wokwi, broker público e aplicação local em Docker.”

Na Administração, aponte ID e nome do leito. Explique: `mqtt_demo.h` coloca o dispositivo na mesma sessão da aplicação; o operador confirma onde ele está instalado. Cadastro do leito não é identificação de paciente.

## 1:30–2:30 — Funcionamento normal: movimento e luz

| Ação ao vivo | O que mostrar |
| --- | --- |
| Abrir Iluminação e movimento e conferir AUTO/agenda 24 h | Configuração confirmada e estado do dispositivo |
| Clicar no PIR e em **Simulate Motion** | Luz acende; painel indica movimento e luz |
| Esperar PIR ficar inativo | Luz permanece pelo prazo de 5 s e apaga após a contagem |
| Consultar gráficos | Movimento e acionamento de luz são registros diferentes; atualização pode depender da consulta |

**Fala sugerida:** “A luz segue movimento, agenda e brilho. O prazo começa quando o sensor fica inativo. Não precisamos manter a interface aberta para o controle local.”

Não prometa apagar cinco segundos após o clique: o PIR pode permanecer ativo por um intervalo e o Wokwi mede tempo simulado.

## 2:30–3:45 — Funcionamento normal: assistência

1. Pressione **AJUDA**. Mostre LED piscando, buzzer periódico e pedido pendente na interface.
2. Solte e pressione novamente. Mostre reiteração: mesmo chamado, mais um acionamento.
3. Clique **Reconhecer** e aguarde confirmação do dispositivo. Mostre estado reconhecido, LED contínuo e buzzer silencioso.
4. Clique **Encerrar** após o atendimento e aguarde confirmação. Mostre sinalização desligada e registro no Histórico.

**Fala sugerida:** “O sistema distingue pedido, reconhecimento e encerramento. Enviar um comando não prova aplicação: esperamos a resposta do ESP32. A luz pode apagar sem encerrar assistência.”

Se houver segundo leito, mostre que seu estado não muda ao atender o primeiro. Não alongue a demonstração abrindo chamados que não dará tempo de finalizar.

## 3:45–5:15 — Condição anormal: perda de rede do dispositivo

Use somente a demo. Não pare o backend para representar perda de Wi-Fi: são falhas diferentes.

| Passo | Resposta esperada |
| --- | --- |
| Digitar `rede off` no serial | Wi-Fi pausado; firmware e circuito continuam ativos |
| Acionar PIR e AJUDA no circuito | Luz e sinalização funcionam localmente; painel não acompanha enquanto desconectado |
| Mostrar interface | Last Will ou expiração de até 45 s indica offline; última informação é preservada, sem fingir atividade atual |
| Durante a espera, abrir Histórico/notificações | Explicar registros, confirmação e diferença entre ausência de comunicação e atendimento |
| Digitar `rede on` | Reconexão e estado novo recuperam presença e chamado atual; aguardar NTP para comandos |
| Reconhecer e encerrar o chamado fictício | Comandos só são concluídos após confirmação; sinalização local muda junto |

**Fala sugerida:** “A falha de comunicação reduz a supervisão remota, mas não deve parar as funções locais. O painel informa a perda de presença. Na volta, verificamos o estado atual antes de agir.”

A fila do firmware é limitada e volátil. Não prometa recuperar todo histórico: ela cobre desconexão do dispositivo; uma parada do consumidor tem limites diferentes. Se o comando ficar não confirmado, mostre esse resultado honestamente e aguarde atualização; não repita cliques para esconder atraso.

## 5:15–6:15 — Histórico e segunda etapa

Abra Histórico e filtre o leito da demonstração. Mostre eventos, chamado e resultados dos comandos. Aponte central de notificações e leitura por navegador; som depende de ativação e aba conectada.

Mostre o segundo diagrama de arquitetura.

**Fala sugerida:** “A segunda etapa é montar ESP32 real e adotar Mosquitto próprio com TLS e credenciais por dispositivo. O software de infraestrutura já existe, mas Wi-Fi real, circuito elétrico e comportamento em hardware ainda exigem adaptação e validação.”

## 6:15–7:00 — Fechamento e limites

**Fala sugerida:** “Entregamos um protótipo que une iluminação local, pedido de ajuda persistente e acompanhamento por leito. Os próximos ensaios devem comprovar o circuito físico e suas falhas. O NightCare apoia o cuidado; não substitui supervisão humana nem oferece garantia médica.”

Se o broker ou Wokwi falhar antes da apresentação, explique a indisponibilidade e use diagramas ou gravação de ensaio anterior identificada como tal. Não apresente dados simulados por cliente MQTT como execução do firmware. Evidências disponíveis e pendências estão em [testes](testes.md).

## Restaurar após a demonstração

Confira `rede on`, relógio real, conectividade e chamados fictícios finalizados. Retorne à configuração combinada com a equipe; os padrões são AUTO, 30%, 30 s e 22:00–06:00. Preserve a sessão com `--resume` se for continuar. Parar/reabrir Wokwi e reiniciar o firmware são testes diferentes de persistência.
