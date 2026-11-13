# Interface e API — NightCare

[Índice](../README.md) · [Instalação](manual.md) · [Serial](serial.md) · [Pitch](pitch.md)

Use este guia após iniciar a aplicação e associar os dispositivos aos leitos. A interface acompanha vários dispositivos na mesma instalação, sem cadastro de pacientes. Todas as ações devem ser dirigidas ao leito/ID correto.

## Navegação e recursos compartilhados

A barra lateral abre Dashboard, Iluminação e movimento, Assistência, Administração e Histórico. Pode ser recolhida; no celular, abre como menu. Voltar/avançar do navegador preserva navegação. Os endereços usam `#dashboard`, `#iluminacao`, `#assistencia`, `#administracao` e `#historico`; o parâmetro `device` identifica a seleção.

O Dashboard é global. As outras telas têm seletor de dispositivo no conteúdo. Rascunhos, filtros, páginas e períodos ficam separados por perfil enquanto a aplicação permanece aberta. Recarregar pode perder esses estados em memória. Conexão WebSocket e áudio são globais.

Seletores aceitam clique/toque, Enter/Espaço, setas, Home/End, digitação para localizar, Escape e Tab. Abas usam setas/Home/End. Ajuda **?** abre por foco, hover ou toque e fecha com Escape/saída. Gráficos oferecem valores por teclado/toque; animações respeitam movimento reduzido. As tabelas rolam internamente nos dois eixos.

Diferencie as conexões: navegador ↔ backend, backend ↔ broker e presença recente do ESP32. Uma conexão não garante as demais. Offline preserva última informação; ausência de dado não significa zero. Estado retido não comprova presença atual.

### Convenções da API

Os exemplos usam Bash/curl, backend em `http://localhost:3000` e ID `nightcare-001`. Ajuste porta e identidade. Faça POST/PATCH somente em dispositivos de teste que você pretende operar. API e WebSocket não usam token nem login, inclusive quando MQTT usa TLS. Compose publica HTTP somente em loopback.

- `:deviceId` é a identidade técnica; `:id` de leito é número retornado pelo backend.
- JSON de entrada é validado; campos extras são recusados nos contratos descritos.
- HTTP **202** significa intenção registrada, não ação aplicada. Confira resultado e telemetria.
- HTTP **400** indica entrada/filtro/cursor inválido; **404**, recurso ausente; **409**, conflito ou condição incompatível. Erros retornam `{"error":"CÓDIGO"}`; validação de schema também pode trazer `details`.
- Datas de filtros são ISO UTC. Timestamps numéricos retornados pelo backend são milissegundos UTC. As análises usam janelas `[from,to)`; históricos aceitam extremidades inclusivas.

## Dashboard

O Dashboard mostra cartões de todos os leitos e chamados globais conhecidos, inclusive de dispositivo ainda sem vínculo. Consulte presença, movimento, luz, relógio e assistência. Os botões do cartão abrem a operação do destinatário.

Use **Buscar leito ou dispositivo** para filtrar cartões por nome/ID, ignorando caixa, acentos e espaços nas pontas. O contador, Limpar e estado sem resultados ajudam na busca. O filtro é local e não oculta os alertas globais nem a descoberta.

Luz acesa tem destaque dourado, movimento recebe sinal visual e chamado pendente destaca sino/borda. Offline ou perda de conexão neutraliza sinais de atividade sem apagar o último estado. Não interpretar ícone animado como comprovação física independente da telemetria.

### API do Dashboard

| Método e rota | Uso / resposta |
| --- | --- |
| `GET /api/status` | Visão global: `devices`, `beds`, `snapshots`, `brokerConnected` e metadados `notifications` |
| `GET /api/devices` | Array com `deviceId`, `bed`, `state`, `lastSeen`, `online` |
| `GET /api/beds` | Array de vínculos com `id`, `name`, `deviceId`, `createdAt` |
| `GET /api/devices/:deviceId/status` | Snapshot do dispositivo e conexão do broker; 404 se desconhecido |
| `GET /ws` com upgrade WebSocket | Snapshot inicial e mudanças, sem mensagem de login |

```bash
curl -fsS http://localhost:3000/api/status
curl -fsS http://localhost:3000/api/devices/nightcare-001/status
```

Uma instalação nova retorna `devices: []`, `beds: []` e `snapshots: {}` na visão global. Cada snapshot individual contém `device`, `eventCount`, `activeRequest`, `appliedConfig`, `configs`, `requests` e `commands`. As listas recentes limitam chamados a 100 e comandos a 30; use Histórico/análises para consultas completas.

WebSocket envia `{"type":"snapshot","data":{...}}`, com a mesma visão global de `/api/status`. Exemplo no console do navegador, sem operar dispositivos:

```javascript
const socket = new WebSocket(`ws://${location.host}/ws`);
socket.onmessage = ({ data }) => console.log(JSON.parse(data));
// Ao terminar:
// socket.close();
```

Na aplicação em loopback usa-se `ws://`. Não é necessário criar assinatura MQTT no navegador. A busca de cartões não tem endpoint próprio.

## Iluminação e movimento

Selecione o leito e acompanhe o estado do ambiente. O card de ajustes permite modo Automático/Ligado/Desligado, brilho, prazo de desligamento e início/fim da agenda. A prévia de brilho não altera o ESP32; **Aplicar** envia o formulário completo. Confira a confirmação e os valores atuais antes de concluir que a luz mudou.

| Controle | Efeito |
| --- | --- |
| AUTO | Movimento acende dentro da agenda; sem relógio válido, permite movimento o dia todo |
| ON / Ligado | Mantém luz no brilho configurado, sem depender do PIR/agenda |
| OFF / Desligado | Mantém luz apagada; não desativa o botão AJUDA |
| Brilho | Inteiro 1–100%; não é comando de ligar/desligar |
| Prazo | Inteiro 1–600 s após PIR ficar inativo; novo movimento cancela contagem |
| Agenda | Horário `HH:MM`, pode cruzar meia-noite; horários iguais habilitam 24 h |

Selecionar um modo no formulário altera o rascunho; use Aplicar para enviá-lo. Consulte Administração para comparar parâmetros atuais, versão remota confirmada e último envio; eles podem diferir após comandos seriais ou envio pendente.

Os gráficos mostram **Movimentos por hora do dia**, **Movimentos e acionamentos da luz** e **Movimentos e agenda**. Há períodos de 24 h, 7 dias, 30 dias e Agenda do leito. Agenda usa a execução mais recente da agenda aplicada: janela em andamento até agora ou última encerrada. Sem referência conhecida, a opção fica indisponível. Uma intenção pendente nunca define essa referência.

Dados de movimento usam eventos `MOTION_STARTED`; acionamento de luz usa `LIGHT_ON`. Não há relação obrigatória de um para um: movimento fora da agenda ou em OFF não precisa acender. Eventos sem horário de ocorrência utilizam recebimento e são identificados como aproximação. Falha na consulta preserva cache com aviso; use **Atualizar gráficos** para tentar novamente.

### API de iluminação

```bash
curl -fsS -X POST http://localhost:3000/api/devices/nightcare-001/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"AUTO","brightnessPct":30,"offDelaySec":5,"startTime":"00:00","endTime":"00:00","timezone":"America/Sao_Paulo"}'
```

`POST /api/devices/:deviceId/config` exige os seis campos do exemplo. O fuso remoto aceito é `America/Sao_Paulo`, mapeado a UTC−3 fixo. Retorna HTTP 202 com esses campos e `schemaVersion: 1`, `deviceId` e `configVersion` atribuídos pelo backend. Exemplo: versão 1 significa intenção v1 registrada; ainda é preciso confirmar aplicação.

Configuração exige vínculo, mas pode ser registrada mesmo com dispositivo offline: permanece desejada/pendente para entrega posterior. Falha de publicação não autoriza mostrar os valores como atuais. Respostas de erro incluem `DEVICE_UNASSIGNED` (409), `DEVICE_NOT_FOUND` (404) e `INVALID_PAYLOAD` (400). Timeout de configuração gera aviso, preservando a intenção pendente.

```bash
curl -fsS 'http://localhost:3000/api/devices/nightcare-001/lighting-analytics?period=24h'
```

`GET /api/devices/:deviceId/lighting-analytics` aceita `period=24h|7d|30d|agenda`, padrão `24h`. Retorna:

| Campos | Significado |
| --- | --- |
| `deviceId`, `period`, `from`, `to`, `timezoneOffsetHours` | Destino e janela consultada |
| `agendaReference` | Origem `telemetry` ou `confirmed`, horários/offset; pode ser `null` |
| `totals` | `movements` e `lightOns` |
| `hourlyMovements` | 24 posições com `hour`, `movements`, `agendaFraction` |
| `activity` | Intervalos com `bucketStart`, `start`, `end`, `partial`, `movements`, `lightOns` |
| `agendaDistribution` | `{inside,outside}` ou `null` sem referência |
| `approximateTimestampCount` | Quantidade de eventos sem horário de ocorrência |

Período inválido retorna 400; `agenda` sem referência retorna `400 AGENDA_UNAVAILABLE`. As referências e regras de janela também se aplicam à assistência.

## Assistência

O pedido ativo mostra estado, identificação, acionamentos e tempo desde a abertura. O contador fica em zero quando há estado conhecido sem pedido, indisponível quando falta evidência e congelado no último contato offline.

1. Pressione **AJUDA** no ESP32: abre chamado pendente.
2. Se necessário, pressione novamente: reitera o mesmo pedido.
3. Na tela do leito, clique **Reconhecer** e aguarde confirmação. O estado deve passar a reconhecido; buzzer silencia e LED permanece aceso.
4. Após atender a ocorrência, clique **Encerrar** e aguarde confirmação. O chamado termina e a sinalização desliga.

Encerrar exige reconhecimento anterior. O painel bloqueia ações incompatíveis; backend e firmware também verificam estado, destinatário, relógio e validade. Acompanhamento lista até 30 ações recentes e mantém rolagem durante atualizações. Não confunda resultado do envio com atendimento humano concluído.

Os indicadores históricos usam todo o histórico consultável do período, não só a lista recente: chamados ao longo do período (pontos), acionamentos iniciais/reiterações e resultados de comandos. Os períodos são 24 h, 7 dias, 30 dias ou Agenda do leito. Aberturas usam `opened_at`; acionamentos usam recebimento dos eventos; comandos usam criação e resultado atual. Não estimam eventos perdidos nem tempo de resposta humana.

**Ativar som** habilita áudio para chamados pendentes de qualquer leito. Depende de interação do usuário, aba aberta e conectada; não é push externo. Desativar som não encerra o chamado.

### API de assistência

Consulte `/api/devices/:deviceId/status` e copie `device.state.requestId` ativo. Para uma nova intenção, crie `commandId` exclusivo; use o mesmo corpo/ID somente para repetir a mesma intenção.

```bash
curl -fsS -X POST http://localhost:3000/api/devices/nightcare-001/commands \
  -H 'Content-Type: application/json' \
  -d '{"commandId":"ensaio-ack-001","requestId":"ID_ATIVO","action":"ACK_HELP"}'
curl -fsS http://localhost:3000/api/devices/nightcare-001/commands/ensaio-ack-001
```

Troque `ID_ATIVO` pelo valor real. Aguarde `status: "APPLIED"` no comando e `assistanceStatus: "ACKNOWLEDGED"` na telemetria. Depois, use o mesmo requestId e **outro** commandId:

```bash
curl -fsS -X POST http://localhost:3000/api/devices/nightcare-001/commands \
  -H 'Content-Type: application/json' \
  -d '{"commandId":"ensaio-close-001","requestId":"ID_ATIVO","action":"CLOSE_HELP"}'
```

| Método e rota | Resultado |
| --- | --- |
| `POST /api/devices/:deviceId/commands` | 202 com registro: `command_id`, `request_id`, `action`, `payload`, `created_at`, `expires_at`, `status` e demais campos persistidos |
| `GET /api/devices/:deviceId/commands/:id` | Registro e resultado atual; 404 se inexistente |
| `GET /api/devices/:deviceId/assistance-analytics?period=24h` | Agregações completas da janela |

Resultados: `PENDING`, `APPLIED`, `REJECTED` e `UNCONFIRMED` após 10 s sem ACK. A validade é 60 s; uma confirmação tardia pode atualizar o mesmo registro. Aguardar sincronização NTP na demo não renova o prazo. `REJECTED` inclui motivo em `reason` quando disponível.

Erros relevantes (409): `DEVICE_UNASSIGNED`, `DEVICE_OFFLINE`, `CLOCK_INVALID`, `REQUEST_MISMATCH`, `INVALID_TRANSITION` e `ID_CONFLICT` ao reutilizar ID com conteúdo diferente. Uma recusa do firmware chega como resultado do comando já aceito, não como alteração retroativa do HTTP 202.

A análise aceita `24h|7d|30d|agenda` e retorna `deviceId`, `period`, `from`, `to`, `agendaReference`, `timezoneOffsetHours`, `callActivity` e:

```json
{
  "requests": {"total": 1, "pending": 0, "acknowledged": 0, "closed": 1},
  "presses": {"total": 2, "initial": 1, "reiterations": 1},
  "commands": {"total": 2, "applied": 2, "rejected": 0, "pending": 0, "unconfirmed": 0}
}
```

Esse é um recorte ilustrativo de uma resposta após um chamado encerrado. Cada ponto de `callActivity` contém `start`, `end`, `count` e `partial`: agrupamento horário em 24 h/agenda, diário em 7/30 dias, com intervalos parciais nas pontas e zeros explícitos. Não mede duração de atendimento.

## Administração

O registro global apresenta até dois dispositivos por página. Para um dispositivo recém-descoberto online, informe nome e confirme o vínculo. Para leito existente, corrija o nome. Paginar conserva rascunhos e resultados. O vínculo não pode ser removido ou transferido nesta versão.

Selecione o leito no header para consultar observabilidade e informações do dispositivo:

- **Presença:** mapa de calor de online, offline e sem observação nas últimas 24 horas; intensidade representa duração por hora.
- **Comunicação:** linha com área e totais de mensagens válidas recebidas por hora, incluindo reentregas QoS. Não equivale a eventos únicos.
- **Configurações:** comparação Atual, Remota confirmada e Último envio, com versões/resultados/motivos nos detalhes. Dados ausentes não são preenchidos pela intenção pendente.
- **Diagnóstico:** MQTT/WS, último contato, relógio, persistência, descartes, uptime, sequência, acionamentos e identificadores nos detalhes.

A janela de observabilidade termina no último minuto completo. Retidos não contam recebimentos nem estabelecem presença. Queda do broker, reinício, pausa de coleta e ausência de evidência ficam como sem observação, sem inventar offline individual. Não existe backfill; os agregados são retidos por 30 dias. Falha HTTP mantém dados anteriores com aviso.

### API de Administração

```bash
curl -fsS -X POST http://localhost:3000/api/devices/nightcare-001/assign \
  -H 'Content-Type: application/json' -d '{"name":"Leito 1"}'
```

`POST .../assign` retorna 201 com `{"id":1,"name":"Leito 1","deviceId":"nightcare-001"}` em um exemplo de primeiro vínculo. Nomes têm 1–64 caracteres após trim e unicidade normalizada. Recusas 409 incluem `DEVICE_OFFLINE`, `DEVICE_ALREADY_ASSIGNED`, `BED_NAME_CONFLICT`; ID desconhecido retorna 404.

```bash
# Use o id numérico retornado pela consulta de leitos:
curl -fsS -X PATCH http://localhost:3000/api/beds/1 \
  -H 'Content-Type: application/json' -d '{"name":"Leito A"}'
curl -fsS 'http://localhost:3000/api/devices/nightcare-001/observability?period=24h'
```

`PATCH /api/beds/:id` retorna vínculo atualizado com data de criação; não aceita `deviceId`. Nome conflitante retorna 409; leito ausente, 404.

`GET .../observability` só aceita `period=24h` (padrão). Retorna `deviceId`, `period`, `from`, `to`, `enabledAt`, `startedAt`, `lastContact`, `resolutionMs`, `totals: {onlineMs,offlineMs,unknownMs}`, `presence`, `hourly` e `messages`. `presence` discrimina intervalos por minuto; `hourly` contém `from`, `to`, `messages`. Dados de configuração/diagnóstico vêm do snapshot individual, não de uma API de escrita própria.

| Diagnóstico HTTP | Resultado |
| --- | --- |
| `GET /health/live` | 200, `{"status":"ok"}`, se processo responde |
| `GET /health/ready` | `{"sqlite":true,"mqtt":true}` com 200; MQTT indisponível gera 503 e `mqtt:false` |
| `GET /ui-config` | `{"demo":true}` ou `false`; não retorna credenciais |

## Histórico

Há dois cards com abrangências independentes: **Histórico de registros** (abas Eventos/Chamados/Configurações) e **Histórico de comandos** (Todas/Reconhecer/Encerrar). Cada um pode consultar o dispositivo selecionado ou Todos os dispositivos.

Filtros de um card não mudam a consulta do outro. Ação em comandos preserva resultado/período e reinicia só sua paginação. **Limpar filtros** volta a Todas. Tabelas limitam a altura, oferecem rolagem e mostram até 25 registros por página. **Anterior**, **Próxima** e **Atualizar consulta** controlam leitura; novas atividades não deslocam automaticamente a página aberta.

Trocar filtro reinicia a consulta afetada. Filtros vazios exibem estado sem resultados; intervalo invertido mostra erro. A interface conserva filtros e páginas por perfil ao navegar. Falha não deve aparecer como consulta vazia bem-sucedida.

### API de Histórico

| Coleção | Rota por dispositivo | Filtros específicos |
| --- | --- | --- |
| Eventos | `GET /api/devices/:deviceId/events?page=true` | `type`, `from`, `to` por recebimento |
| Chamados | `GET /api/devices/:deviceId/requests` | `status=PENDING\|ACKNOWLEDGED\|CLOSED`, `from`, `to` por abertura |
| Configurações | `GET /api/devices/:deviceId/configs` | `status=PENDING\|APPLIED\|REJECTED`, `from`, `to` por criação |
| Comandos | `GET /api/devices/:deviceId/commands` | `status=PENDING\|APPLIED\|REJECTED\|UNCONFIRMED`, `action=ACK_HELP\|CLOSE_HELP`, `from`, `to` por criação |

Todas aceitam `limit` inteiro 1–500 (padrão 100 na API) e `cursor`. Chamados/configurações/comandos sempre retornam `{"items":[...],"nextCursor":null}`; `null` indica fim. Eventos usam esse formato com `page=true`, cursor ou abrangência global; sem isso, preservam array legado. Campos das linhas seguem os registros persistidos (`device_id`, IDs, datas, status e payload quando aplicável).

```bash
curl -fsS 'http://localhost:3000/api/devices/nightcare-001/events?page=true&limit=25&type=HELP_OPENED'
curl -fsS 'http://localhost:3000/api/devices/nightcare-001/commands?limit=25&action=ACK_HELP&status=APPLIED'
curl -fsS 'http://localhost:3000/api/requests?scope=all&limit=25'
# Datas devem ser substituídas pelo intervalo desejado:
curl -fsS 'http://localhost:3000/api/configs?scope=all&from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z'
```

Para a próxima página, copie `nextCursor` e envie com os mesmos filtros. Cursor é opaco e vinculado a coleção, destino e filtros; não reutilize entre consultas. Use URL encoding quando montar URLs. A ordenação é decrescente por recebimento/ID, abertura/ID, criação/ID ou versão, com desempate por dispositivo nas consultas globais.

Para abrangência global use `/api/{events,requests,configs,commands}?scope=all`. Não combine `scope=all` com rota que já contém deviceId. Rotas legadas sem ID e sem `scope=all`, inclusive POST `/api/config` e `/api/commands`, exigem exatamente um leito associado; caso contrário retornam `409 DEVICE_REQUIRED`. Prefira as rotas explícitas.

Paginação não é snapshot transacional entre requisições; estados podem mudar durante a leitura. Atualizar reinicia a consulta e traz o estado recente.

## Central de notificações e áudio

O sino abre histórico global com dispositivo, nome do leito na ocorrência, categoria, horário e acesso ao destinatário. Categorias: presença, iluminação, movimento, assistência, configuração, comandos, administração, diagnósticos e sistema. O histórico persistido dura 30 dias, sem converter registros anteriores à ativação.

Abrir ou atualizar **não marca como lido**. **Marcar todas como lidas** zera contador, remove destaques e salva marcador local por instalação/endereço/navegador. Outro navegador tem leitura independente. A consulta aberta fica ancorada; use Atualizar para novidades.

Novas notificações geram avisos de oito segundos, pausados com mouse/foco, no máximo três visíveis e resumo em rajadas. Reconexão não reproduz avisos antigos. Falha navegador/backend gera aviso local; falha do broker é global, sem simular queda individual de todos os dispositivos. Áudio permanece exclusivo dos chamados e requer ativação.

### API de notificações

`GET /api/notifications` aceita `limit` 1–100 (padrão 30), `cursor`, `deviceId`, `category`, `readThroughId`, `afterId` e `untilId`. IDs de faixa/marcador são inteiros não negativos. Categorias na API: `presence`, `lighting`, `motion`, `assistance`, `configuration`, `commands`, `administration`, `diagnostics`, `system`.

```bash
curl -fsS 'http://localhost:3000/api/notifications?limit=30&category=assistance&readThroughId=0'
```

Retorna `items`, `nextCursor`, `installationId`, `latestId` e `unreadCount` global, independente dos filtros. Itens contêm identidade sequencial, tipo, categoria, severidade, descrição, dispositivo, nome histórico e referências/horários. Cursor vincula instalação, filtros e faixa.

`readThroughId` informa o marcador do cliente; GET não grava leitura no servidor. Não existe POST de marcar lidas: a interface atualiza localStorage e passa o marcador nas consultas. `/api/status` e `/ws` anunciam `notifications: {installationId,latestId}`.

## Interações com o ESP32

O botão que aciona sinalização sonora se chama **AJUDA**. O buzzer é uma saída; não se pressiona o buzzer. Use esta tabela para demonstrar e diagnosticar o circuito:

| Ação / condição | Resposta local esperada | Resposta na interface e tratamento |
| --- | --- | --- |
| PIR ativo, AUTO e dentro da agenda | Luz no brilho escolhido; permanece enquanto há movimento | Movimento e luz atualizados; eventos alimentam gráficos |
| PIR fica inativo | Prazo começa; ao terminar, luz apaga | Estado/eventos refletem desligamento; novo movimento cancela contagem |
| PIR fora da agenda ou em OFF | Luz permanece apagada | Movimento pode existir sem luz; não é falha por si só |
| Modo ON sem movimento | Luz permanece acesa | Luz acesa sem PIR é esperado |
| Relógio inválido em AUTO | Movimento pode acender em qualquer horário | Diagnóstico alerta; atendimento remoto não é autorizado por relógio de teste |
| Pressionar AJUDA sem pedido | PENDING; LED alterna 500 ms, buzzer 100 ms a cada 5 s | Pedido global e do leito, contador/aviso e áudio se habilitado |
| Segurar AJUDA | Um acionamento após debounce de 50 ms | Não cria reiterações contínuas por manter pressionado |
| Soltar e pressionar de novo | Mesmo pedido, contador cresce, estado preservado | Reiteração; inclusive reconhecido permanece reconhecido e silencioso |
| Reconhecer confirmado | ACKNOWLEDGED; LED contínuo e buzzer silencioso | Resultado aplicado e pedido reconhecido |
| Tentar encerrar pendente | Transição recusada | Botão indisponível ou erro; reconhecer antes |
| Encerrar reconhecido | NONE; LED/buzzer desligados | Chamado encerrado no histórico; próximo clique abre outro |
| Wi-Fi do ESP32 interrompido | PIR, luz e AJUDA continuam locais; eventos entram em fila RAM limitada | Presença expira/Last Will; ações remotas indisponíveis; aguardar reconexão |
| Backend ou navegador parado | Controle local continua | Tela não confirma ações; ausência de consumidor pode perder eventos já confirmados pelo broker |
| Reiniciar ESP32 | Recupera configuração/chamado gravados em NVS; perde fila RAM | Presença só volta após estado novo; não confundir com nova abertura |
| Falha de persistência ou perdas | Diagnóstico sinaliza limite/falha quando detectada | Não interpretar estado visível como prova de gravação ou entrega integral |

Para recuperar de teste de rede use `rede on`; de relógio de teste, `hora real`, conforme [serial](serial.md). Aguarde conexão/NTP, confira pedido atual e só então envie nova ação. Execute falhas de armazenamento, carga e adulteração exclusivamente em ambiente isolado, conforme [testes](testes.md).
