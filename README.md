# NightCare

Assistente acadêmico de deslocamento noturno: ESP32 com PIR, iluminação PWM e botão de assistência. O controle de luz e os sinais de assistência continuam funcionando sem internet. O aviso remoto depende da conexão. Sistema de apoio, sem certificação médica ou prevenção garantida de quedas.

Implementados: firmware autônomo, MQTT com TLS/QoS 1, backend Node.js/TypeScript/Fastify, histórico SQLite, API autenticada, painel web (React, Tailwind e shadcn/ui, servido pelo próprio backend) e implantação Docker com Mosquitto. WebSocket e notificações fora do painel (push, e-mail, mensagens) estão fora deste escopo.

## Requisitos atendidos

| Requisito | Como é atendido |
| --- | --- |
| Detecção de presença e movimentação | PIR no GPIO 27; eventos `MOTION_STARTED` e `MOTION_ENDED` |
| Acionamento automático de iluminação | Modo `AUTO`: movimento dentro da agenda acende o LED branco (GPIO 25) |
| Ajuste de intensidade por PWM | Brilho de 1 a 100%: `brilho` na serial, `brightnessPct` na API e campo no painel; saída por `analogWrite` |
| Configuração dos horários | `agenda` e `fuso` na serial; `startTime` e `endTime` na API e no painel; salvo em NVS |
| Temporização para desligamento | `tempo` na serial e `offDelaySec` (1–600 s) na API e no painel, contados a partir do PIR inativo |
| Botão físico de ajuda | GPIO 14 com debounce de 50 ms; um pedido por `requestId`, cliques seguintes reiteram o mesmo pedido |
| Sinalização local e notificação remota | Local: LED vermelho e buzzer. Remota: o evento `HELP_OPENED` chega ao backend por MQTT/TLS, fica no histórico e o painel aberto o destaca com alerta visual e sonoro opcional. Não há push, e-mail nem mensagem externa |
| Confirmação de atendimento pelo cuidador | `ACK_HELP` e `CLOSE_HELP` pela API ou pelo painel, com ACK correlacionado do ESP32; também `reconhecer` e `encerrar` na serial |
| Histórico de acionamentos e solicitações | SQLite (`events`, `assistance_requests`, `commands`, `device_configs`) e `GET /api/events`; os 20 eventos mais recentes aparecem no painel |
| Dashboard com modos, parâmetros e estados | Painel web em `/`: estado do dispositivo, modo de funcionamento, parâmetros, pedido de ajuda e histórico |

## Arquivos

```text
Wokwi/sketch.ino                  firmware e comandos seriais
Wokwi/diagram.json                circuito existente
Wokwi/libraries.txt               ArduinoJson com versão exata
Wokwi/mqtt_secrets.example.h      modelo sem credenciais
Wokwi/mqtt_secrets.h              gerado localmente, ignorado
Wokwi/wokwi.toml                  execução do binário PlatformIO no Wokwi VS Code
platformio.ini                   ESP32/Arduino e dependências fixadas
backend/src/                     contratos, SQLite, API e cliente MQTT
backend/test/                    testes de contrato/API
backend/package-lock.json        dependências exatas, usar npm ci
backend/Dockerfile               estágios de compilação, painel, testes e execução
dashboard/                       painel web (Vite, React, Tailwind, shadcn/ui)
dashboard/package-lock.json      dependências exatas do painel, usar npm ci
compose.yml                      backend e broker, volumes e healthchecks
mosquitto/mosquitto.conf          listener TLS 8883 e persistência
mosquitto/acl                     permissões por usuário/tópico
scripts/setup.sh                 CA, certificado SAN e credenciais
scripts/test-backend.sh           testes com Node 22 em Docker
scripts/test-integration.sh       TLS/ACL/MQTT/API e persistência em Docker
secrets/                         material local gerado, ignorado
.env                             parâmetros locais gerados, ignorado
```

## Preparar o host público

É necessário um servidor com Docker Engine/Compose v2, Bash, Python 3 e OpenSSL. Para compilar firmware, instale PlatformIO Core 6.1.18 ou a extensão PlatformIO do VS Code. O backend exige **Node >=22.13**, com Node **22.21.1** fixado no Dockerfile. Node 20 não é suportado pelas dependências atuais, incluindo `better-sqlite3@12.4.1` e dependências transitivas. Use Docker se o computador ainda usa Node 20.

1. Escolha um DNS público apontando para seu servidor, por exemplo `mqtt.seudominio.com`. O endereço é fornecido por você; o projeto não cria DNS, VPS nem encaminhamento de portas. IPv4 público também é aceito.
2. Libere **TCP 8883** no firewall do host e do provedor. Em rede doméstica, configure NAT/encaminhamento para o computador que executa o broker; CGNAT normalmente exige um servidor público ou outra solução de acesso. Não abra a porta 1883: ela não existe nesta configuração.
3. Copie este repositório para esse host. Execute na raiz, substituindo o domínio de exemplo pelo endereço real:

```bash
bash scripts/setup.sh mqtt.seudominio.com
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 mosquitto backend
```

O Compose sobe **ambos os serviços**. O backend usa `mqtts://mosquitto:8883` pela rede interna; o ESP32 usa o domínio público. O certificado tem SAN para os dois nomes. O healthcheck do broker publica por TLS com um usuário restrito a `health/nightcare`; o backend só inicia após esse teste passar. O healthcheck do backend verifica SQLite e conexão MQTT. A API e o painel web ficam em `127.0.0.1:3000` do servidor.

O script gera uma CA privada (10 anos), certificado de servidor (365 dias), usuários separados `nightcare-001`, `nightcare-backend`, `nightcare-health`, senhas aleatórias e token de API. DNS gera SAN `DNS:HOST,DNS:mosquitto`; IPv4 gera `IP:HOST,DNS:mosquitto`. Não usa `setInsecure`, `rejectUnauthorized:false` nem certificado autoassinado aceito sem CA. A CA privada só fica em `secrets/ca/ca.key` e não é montada nos serviços. O broker recebe apenas certificados, chave do servidor, hashes de senha e senha exclusiva do healthcheck. A pasta `secrets/` permanece acessível apenas ao dono no host; seus arquivos de execução são legíveis pelo usuário do contêiner dentro do bind mount.

O script recusa sobrescrever `.env`, `secrets/` ou `mqtt_secrets.h`. Em falha parcial de preparação, examine os arquivos antes de tentar de novo; não apague uma CA de uma instalação em uso. Para renovação, mantenha a CA e gere um novo CSR/certificado com o mesmo SAN, substitua apenas certificado e chave do servidor e reinicie Mosquitto. Se trocar a CA, atualize também o certificado no firmware e reinicie ambos os serviços. Guarde backup seguro da CA; não envie a chave privada ao Wokwi.

Para acessar a API e o painel de seu computador quando tudo roda em um servidor:

```bash
ssh -N -L 3000:127.0.0.1:3000 usuario@servidor
```

Com o túnel aberto, o painel web está em `http://127.0.0.1:3000`. O token não deve transitar em HTTP aberto na internet, o que vale também para o painel. Para exposição direta da API, use um proxy HTTPS com autenticação Bearer. A implantação padrão usa apenas loopback/túnel SSH.

## Conectar o ESP32 no Wokwi

Abra o [projeto original](https://wokwi.com/projects/479504505300117505) ou crie uma cópia privada. Substitua os arquivos pelo conteúdo atual de `Wokwi/sketch.ino`, `Wokwi/diagram.json` e `Wokwi/libraries.txt`. Crie também uma aba `mqtt_secrets.h` com o conteúdo gerado por `scripts/setup.sh`. O arquivo contém **somente a credencial do dispositivo e o certificado público da CA**, nunca a chave da CA ou token da API.

Não publique um projeto Wokwi contendo credenciais reais: o código é visível para quem acessa o projeto. Use uma cópia privada e senhas exclusivas da demonstração; revogue a credencial se compartilhá-la. Se o projeto for público ou compartilhado, não salve a aba `mqtt_secrets.h`: crie-a só durante a sessão e recrie-a a partir de `Wokwi/mqtt_secrets.h` quando a página for recarregada.

A rede Wi-Fi é `Wokwi-GUEST`, sem senha. A sincronização UTC vem de `pool.ntp.org`. O cliente só inicia TLS depois de obter data UTC plausível, para verificar validade do certificado. Falha de NTP impede MQTT/TLS, mas não o PIR, botão ou iluminação local. Antes de horário válido, o modo automático aceita movimento o dia todo. Relógio de teste congelado serve à agenda, nunca autoriza comandos remotos.

O ESP32 e o backend conectam ao **mesmo broker público**. O dispositivo não acessa a API nem `localhost` do seu computador. O gateway público do Wokwi fornece acesso de saída à internet; não fornece acesso direto à sua rede privada. Se preferir o gateway privado, configure o Wokwi separadamente e ajuste DNS/certificado coerentemente. O caminho documentado aqui usa o host público.

Alternativamente, compile na raiz e use a extensão Wokwi do VS Code com `Wokwi/wokwi.toml`:

```bash
pio run
```

O binário e o ELF são gerados em `.pio/build/esp32dev/`. A configuração fixa `espressif32@6.12.0` (Arduino ESP32 2.0.17) e `ArduinoJson@7.4.2`. O código também contém o formato de configuração MQTT do ESP-IDF 5, mas essa variante exige validação própria; a compilação reproduzível é a do PlatformIO. Sem `mqtt_secrets.h`, o exemplo permite compilar e o firmware informa no serial que MQTT está desabilitado.

O `mqtt_secrets.h` aceita macros opcionais: `MQTT_PORT` (padrão 8883), para um broker alcançado em outra porta pública, e `MQTT_DISABLE_KEEPALIVE` (veja _Simulador lento_). `MQTT_USE_TLS` (padrão 1), `MQTT_TOPIC_PREFIX` (padrão `nightcare/nightcare-001/`) e `MQTT_CLIENT_ID` (padrão `nightcare-001`) permitem usar outro broker em demonstrações. Compilando com `NIGHTCARE_DEMO=1`, o firmware inclui `mqtt_demo.h` (ou `mqtt_demo.example.h`) em vez de `mqtt_secrets.h` e acrescenta os comandos seriais `rede off` e `rede on`, que pausam e restauram o Wi-Fi sem reiniciar, para testar o controle local.

### Circuito e controle local

| Componente | Ligação |
| --- | --- |
| PIR OUT | GPIO 27; alimentação 5 V e GND |
| Botão AJUDA | GPIO 14 e GND, `INPUT_PULLUP` |
| LED branco | GPIO 25, resistor 220 Ω e GND |
| LED vermelho | GPIO 26, resistor 220 Ω e GND |
| Buzzer | positivo GPIO 32, negativo GND |

Clique no PIR e em **Simulate Motion**; a saída permanece ativa por cerca de cinco segundos. O brilho padrão é 30%, a temporização após PIR inativo é 30 s e a agenda é 22:00–06:00. Início é inclusivo, fim exclusivo e início igual ao fim significa 24 h. `ON` e `OFF` ignoram agenda. Ao sair da agenda, `AUTO` apaga imediatamente. Novo movimento cancela o desligamento pendente.

O botão tem debounce de 50 ms e gera um evento por pressionamento. Abre apenas um pedido e novos cliques reiteram seu `requestId`, inclusive depois do reconhecimento. Pendente: LED alterna a cada 500 ms e buzzer toca 100 ms a cada 5 s. Reconhecida: LED aceso, buzzer silencioso. Encerramento exige reconhecimento; timeout da luz e soltar o botão não encerram o chamado.

Comandos no monitor serial (115200 baud):

```text
auto
on
off
brilho 30
tempo 30
agenda 22:00 06:00
fuso -3
hora 21:59
hora real
hora invalida
reconhecer
encerrar
status
ajuda
reiniciar
```

`brilho`: 1–100%; `tempo`: 1–600 s; `fuso`: inteiro −12 a +14. O horário fixo e o relógio inválido não são salvos. Configuração e assistência usam NVS/Preferences (`nightcare`, chaves `config` e `help`). O formato anterior é migrado sem descartar os parâmetros; registro de assistência inválido abre um pedido de recuperação. `reiniciar` é o primeiro teste de persistência; parar/reabrir a simulação tem comportamento de armazenamento próprio e deve ser testado separadamente.

Configurações remotas aceitam `timezone: America/Sao_Paulo` e aplicam UTC−3 fixo; não há base IANA nem regras históricas/futuras de horário de verão no ESP32. O comando serial `fuso` mantém a compatibilidade de teste. Uma configuração remota mais nova restaura UTC−3. Alterações locais não incrementam `appliedConfigVersion`: esse número identifica apenas a última configuração remota aplicada. Confira também os campos atuais de `state` ao comparar a configuração.

## Contrato MQTT

Prefixo: `nightcare/nightcare-001/`. Todas as mensagens JSON têm `schemaVersion: 1` e `deviceId: nightcare-001`. O backend valida estrutura, tipos, faixas e tópicos; mensagens inválidas são rejeitadas e registradas sem interromper o serviço. IDs têm até 64 caracteres alfanuméricos, `_` ou `-`.

| Sufixo | Direção | QoS | Retido |
| --- | --- | --- | --- |
| `events` | ESP32 → backend | 1 | não |
| `state` | ESP32 → backend | 1 | sim |
| `availability` | ESP32 → backend | 1 | sim, Last Will `offline` |
| `config/set` | backend → ESP32 | 1 | sim |
| `commands` | backend → ESP32 | 1 | não |
| `acks` | ESP32 → backend | 1 | não |

A ACL permite ao dispositivo escrever apenas seus quatro tópicos de saída e ler apenas configuração/comandos. O backend tem permissões inversas. O usuário de healthcheck não acessa os tópicos do dispositivo. Não há acesso anônimo ou wildcard entre dispositivos.

Eventos: `eventId`, `bootId`, `type`, `occurredAt` (UTC ou `null`), `uptimeMs`, `requestId` (ou `null`) e `pressCount`. Tipos: `BOOT`, `MOTION_STARTED`, `MOTION_ENDED`, `LIGHT_ON`, `LIGHT_OFF`, `HELP_OPENED`, `HELP_REITERATED`, `HELP_ACKNOWLEDGED`, `HELP_CLOSED`, `HELP_RECOVERED`, `CONFIG_APPLIED`. IDs combinam dispositivo, boot aleatório de 64 bits e contador. O ID do evento `HELP_OPENED` é o próprio `requestId` salvo até encerrar.

`state`: `bootId`, `sequence`, `uptimeMs`, `mode`, `lightOn`, `brightnessPct`, `motion`, `assistanceStatus` (`NONE`, `PENDING`, `ACKNOWLEDGED`), `requestId`, `pressCount`, `clockValid`, `appliedConfigVersion`, `droppedEvents`, `persistenceOk`. Publicado ao mudar, ao reconectar e a cada 15 s. Estado retido é uma fotografia, não prova de presença: o backend exige heartbeat novo e marca offline após 45 s (configurável por `DEVICE_STALE_MS`, veja _Simulador lento_) ou disponibilidade `offline`. Sequências repetidas do mesmo boot não renovam a presença.

Configuração desejada: `configVersion` crescente, `mode`, `brightnessPct`, `offDelaySec`, `startTime`, `endTime`, `timezone`. O backend aloca a versão dentro de transação SQLite. O ESP32 valida tudo antes de aplicar/gravar. Versões antigas são rejeitadas; versão igual e conteúdo igual retorna `ALREADY_APPLIED` sem nova escrita em NVS; versão igual com conteúdo diferente é rejeitada. `acks` e `state.appliedConfigVersion` comprovam aplicação. `202 Accepted` da API só confirma registro da intenção.

Comando: `commandId`, `requestId`, `action` (`ACK_HELP` ou `CLOSE_HELP`), `issuedAt`, `expiresAt`, validade de 60 s. O ESP32 exige UTC real válido, pedido ativo correspondente e transição válida. Comando retido é rejeitado. A repetição de um comando aceito não repete a transição: o resultado e o estado resultante são gravados atomicamente no mesmo registro NVS, com diário dos últimos 16 comandos. Após a expulsão do diário, as regras de pedido/transição e validade continuam impedindo repetir os efeitos de comandos antigos. Reutilizar um ID com outro conteúdo é conflito no diário/backend.

ACK: `commandId` e `requestId`, ou `configVersion`; `status: APPLIED|REJECTED`; `reason`. O backend só atualiza comandos por ACK correlacionado. Sem ACK em dez segundos, a API apresenta `UNCONFIRMED` (resultado não confirmado), mesmo que a publicação MQTT tenha recebido PUBACK. Um ACK tardio ainda pode confirmar. O histórico de eventos e o estado do dispositivo são evidências distintas do envio de comando.

A rede usa a tarefa do ESP-MQTT; o loop local recebe no máximo uma mensagem de configuração/comando por iteração através de uma fila FreeRTOS. Envio usa `esp_mqtt_client_enqueue`, com QoS 1 e um evento em trânsito. Há backoff de 1, 2, 4, 8, 16, até 30 s. A fila de eventos em RAM tem limite de 100 e só remove por PUBACK ou descarte: lotada, descarta o evento comum mais antigo; se todos forem de assistência, descarta o mais antigo. Cada descarte incrementa `droppedEvents`. Reconexão publica estado e escoa a fila; o banco deduplica por `eventId`. Fila e contador de perdas não sobrevivem a reboot; chamado ativo e configurações sobrevivem se NVS estiver operacional.

## API HTTP

Leia `API_TOKEN` no arquivo `.env` gerado e defina no terminal, sem incluí-lo em arquivos versionados:

```bash
read -rsp 'API token: ' API_TOKEN
export API_TOKEN
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
curl -fsS -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:3000/api/status
```

Variáveis exportadas no shell têm prioridade sobre o `.env` no Docker Compose. Se exportou `API_TOKEN`, rode `unset API_TOKEN` antes de `docker compose up` ou dos testes de integração, para que o backend suba com o token do `.env`.

| Método e caminho | Uso |
| --- | --- |
| `GET /health/live` | processo HTTP ativo |
| `GET /health/ready` | SQLite disponível e broker conectado; 503 sem MQTT |
| `GET /api/status` | dispositivo, presença, configurações desejadas, chamados e comandos |
| `GET /api/events?limit=100&type=HELP_OPENED&from=...&to=...` | histórico, intervalo UTC pelo horário de recebimento; limite 1–500 |
| `POST /api/config` | configuração completa sem versão; retorna intenção registrada (202) |
| `POST /api/commands` | `commandId`, `requestId`, `action`; retorna comando registrado (202) |
| `GET /api/commands/:id` | confirmação/recusa/resultado não confirmado |
| `GET /` | painel web: arquivos estáticos sem autenticação, o token é pedido na página |

As rotas `/api/` exigem `Authorization: Bearer TOKEN`; healthchecks e os arquivos do painel não. `400` indica payload inválido, `401` autenticação ausente/incorreta, `404` registro ausente, `409` conflito, dispositivo offline, relógio inválido ou transição inválida. Corpos JSON têm limite de 8 KiB.

Enviar configuração:

```bash
curl -fsS -X POST http://127.0.0.1:3000/api/config \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"AUTO","brightnessPct":30,"offDelaySec":30,"startTime":"22:00","endTime":"06:00","timezone":"America/Sao_Paulo"}'
```

Depois de apertar AJUDA, copie o `requestId` de `/api/status`. Substitua `ID_ATIVO` abaixo e use um ID novo por intenção. Para repetir a mesma intenção, reenvie o mesmo `commandId` e o mesmo corpo.

```bash
curl -fsS -X POST http://127.0.0.1:3000/api/commands \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"commandId":"demo-reconhecer-001","requestId":"ID_ATIVO","action":"ACK_HELP"}'
curl -fsS -H "Authorization: Bearer $API_TOKEN" \
  http://127.0.0.1:3000/api/commands/demo-reconhecer-001
```

Espere `APPLIED` e confirme `ACKNOWLEDGED` em `state`. Depois envie outra intenção, com ID novo e `action: CLOSE_HELP`, mantendo o mesmo `requestId`. Verifique `NONE` em `state` e os dois eventos distintos no histórico. Não trate ACK de transporte MQTT como confirmação de atendimento.

### Executar backend fora do Compose

Com Node 22 e ferramentas de compilação nativa (Python/make/g++ se o binário SQLite pré-compilado não estiver disponível):

```bash
cd backend
npm ci
npm run build
```

Defina `MQTT_URL=mqtts://HOST_PUBLICO:8883`, `MQTT_USER=nightcare-backend`, `MQTT_PASSWORD` com a senha gerada, `MQTT_CA_FILE` com caminho absoluto para `secrets/mosquitto/ca.crt` e `API_TOKEN`. `DB_PATH` é opcional (padrão `./data/nightcare.sqlite`), `HOST` é `127.0.0.1` e `PORT` é `3000`. `DEVICE_STALE_MS` (padrão 45000) define quanto tempo sem estado novo torna o dispositivo offline; 0 desativa a regra e usa só o Last Will. Execute `npm start`. Só execute uma instância do backend por broker: o client ID fixo é `nightcare-backend`.

SQLite usa WAL e tabelas `devices`, `device_configs`, `events`, `assistance_requests`, `commands`. O estado atual é autoritativo para o pedido ativo; reenvios antigos de eventos não reabrem pedidos encerrados. Configuração desejada e comandos são persistidos antes de publicar. Ao reconectar, o backend repete a última configuração retida e comandos não confirmados ainda dentro da validade. Eventos com hora inválida preservam `occurredAt=null` e recebem horário de chegada no banco.

## Painel web

O backend serve, na mesma porta da API (`/`), um painel em React com Tailwind e componentes shadcn/ui (`dashboard/`). Abra `http://127.0.0.1:3000` (ou o túnel SSH acima) e informe o `API_TOKEN`: ele fica apenas no `sessionStorage` do navegador e segue como Bearer nas chamadas `/api/`. O painel consulta `/api/status` e `/api/events` a cada 2 s (não há WebSocket) e mostra:

- presença do dispositivo e conexão com o backend;
- alerta de pedido de ajuda pendente ou reconhecido, com **Reconhecer atendimento** e **Encerrar pedido** (`ACK_HELP` e `CLOSE_HELP`) e alerta sonoro opcional (o navegador exige um clique para liberar o áudio);
- estado: luz e brilho, movimento, pedido de ajuda, relógio, broker MQTT, versão e situação da última configuração;
- modo de funcionamento (`AUTO`, `ON`, `OFF`) e parâmetros (brilho, tempo para desligar, início e fim da agenda);
- os 20 eventos mais recentes.

Erros da API (dispositivo offline, relógio inválido, transição inválida) aparecem na própria tela. Um `202` só confirma o registro da intenção; o estado muda quando o ESP32 confirma. Navegadores reduzem a frequência de abas em segundo plano: mantenha a janela do painel visível durante a demonstração.

A imagem Docker já inclui o painel: o estágio `dashboard` de `backend/Dockerfile` executa `npm ci` e `npm run build` e copia o resultado para `/app/public`. Se não existir uma pasta `public` ao lado de `dist/`, o backend sobe só com a API, como nos testes. Fora do Docker (Node >=22.13):

```bash
cd dashboard
npm ci
npm run build
rm -rf ../backend/public && cp -r dist ../backend/public
```

Para desenvolver com recarga automática, mantenha o backend em `127.0.0.1:3000` e rode `npm run dev` em `dashboard/`; o Vite encaminha `/api` ao backend. Há um `components.json`, então `npx shadcn@latest add <componente>` acrescenta componentes ao painel.

## Validação e demonstração

Execute os testes reproduzíveis sem depender da versão local do Node:

```bash
bash scripts/test-backend.sh
bash scripts/test-integration.sh
pio run
npm audit --prefix backend
docker compose build
npm ci --prefix dashboard && npm run build --prefix dashboard
bash -n scripts/setup.sh scripts/test-backend.sh scripts/test-integration.sh
```

Testes automáticos cobrem deduplicação/replay, ordem de eventos de assistência, estado retido sem falsa presença, heartbeat de 45 s, configuração inválida/versão monotônica, correlação de ACK, comandos duplicados/conflitantes, timeout de dez segundos, replay somente antes da validade, autenticação e respostas da API. O painel não tem testes automatizados: `docker compose build` compila o painel (`tsc` e `vite build`), e o último comando acima, que exige Node >=22.13, faz o mesmo fora do Docker. Compilar não substitui testar o circuito no simulador.

| Cenário manual | Resultado esperado |
| --- | --- |
| `auto`, `hora 21:59`, movimento | luz apagada |
| `hora 22:00`, movimento | luz no brilho configurado |
| `hora 05:59` e depois `hora 06:00` | permitida antes do fim, apaga no fim |
| `agenda 00:00 00:00` | automático habilitado o dia inteiro |
| PIR inativo e novo movimento antes do prazo | desligamento cancelado |
| `off` e botão AJUDA | pedido abre mesmo com luz desligada |
| Botão mantido pressionado | um único incremento |
| `hora invalida`, movimento | luz aceita movimento; comando remoto recusado |
| `hora real`, aguardar NTP | comando remoto permitido com UTC válido |
| Reconhecer e encerrar via API | ACKs correlacionados, LED e histórico coerentes |
| Reenviar comando com mesmo ID/corpo | sem segunda transição |
| ID antigo com outro pedido | rejeitado |
| Configuração inválida | rejeição integral, sem alterar saída/NVS |
| Configuração repetida com mesma versão | sem nova gravação NVS |
| Desconectar Wi-Fi/broker | botão/luz locais continuam; API fica offline |
| Reconectar | estado atual e fila enviados, sem duplicar histórico |
| Mais de 100 eventos offline | perdas contadas, prioridade para assistência |
| `reiniciar` com pedido reconhecido | mesmo pedido e estado recuperados |
| Reiniciar backend/broker | SQLite, configuração e dados do broker preservados |
| Abrir o painel e informar o token | estado e histórico aparecem; dispositivo online |
| Apertar AJUDA no simulador | alerta vermelho no painel em poucos segundos, com Reconhecer |
| Reconhecer e depois Encerrar no painel | alerta muda para reconhecido e some; histórico mostra os dois eventos |
| Trocar modo ou parâmetros no painel | linha Configuração passa de PENDING para APPLIED quando o ESP32 confirma |

Verifique TLS de fora do servidor, substituindo o host:

```bash
openssl s_client -connect mqtt.seudominio.com:8883 \
  -servername mqtt.seudominio.com -verify_hostname mqtt.seudominio.com \
  -CAfile secrets/mosquitto/ca.crt -verify_return_error </dev/null
```

Com IPv4, use `-verify_ip` em lugar de `-verify_hostname`. Uma CA errada ou outro hostname deve falhar. A autenticação sem usuário/senha deve ser recusada, e o usuário do dispositivo não pode publicar em `config/set` ou tópicos de outro dispositivo.

### Operação e diagnóstico

`docker compose logs --tail=100 backend mosquitto` mostra conexões e payloads rejeitados, sem imprimir senhas. Se MQTT não conectar no Wokwi, confira domínio público, TCP 8883, CA completa, credencial exclusiva, validade do certificado, NTP e SAN. O nome `mosquitto` funciona apenas na rede Docker. Se só houver estado antigo em SQLite, aguarde um heartbeat novo para presença online.

O volume `sqlite_data` contém o banco e `mosquitto_data` contém a persistência MQTT. `docker compose down` preserva ambos; `down -v` apaga dados e não deve ser usado para reinício normal. Faça backup consistente de SQLite por sua API de backup ou com backend parado (WAL não pode ser ignorado), além de `.env` e `secrets/` em local seguro. Nunca versione credenciais ou dados de demonstração pessoais.

**Simulador lento.** O Wokwi no navegador pode rodar a uma fração do tempo real (em um notebook modesto, cerca de 8%: 1 s simulado leva cerca de 13 s reais; com a aba em segundo plano, perto de 0%). Três limites contam em tempo real e deixam de acompanhar o relógio da simulação: o keepalive de 15 s do MQTT (o broker derruba o cliente após 22,5 s reais sem tráfego), o heartbeat de estado de 15 s e a regra de 45 s de presença do backend. Sintomas: `transport_read(): EOF` na serial, o broker ou o túnel registrando o fim da conexão e o dispositivo aparecendo offline com o Wokwi aberto. Em hardware real isso não ocorre. Para demonstrações em simulador lento: mantenha a janela do Wokwi visível e o notebook na tomada; defina `DEVICE_STALE_MS=0` no `.env` (o Compose repassa ao backend; reinicie-o), de modo que a presença dependa só do Last Will; e defina `#define MQTT_DISABLE_KEEPALIVE 1` no `mqtt_secrets.h`, o que desliga o keepalive do cliente MQTT e deixa a queda ser detectada pelo fechamento da conexão TCP. Não use essas opções em hardware real.

Limites: um dispositivo e um ambiente; painel web simples, sem contas de usuário, sem WebSocket e sem notificação fora do painel; UTC−3 fixo; fila em RAM; entrega remota depende da internet; demonstração real no Wokwi e acesso público devem ser validados com seu host. A simulação representa a luminária por LED: uma luminária real requer estágio de potência e alimentação adequados.

Referências: [ESP-MQTT e envio por fila](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/protocols/mqtt.html), [Fastify](https://fastify.dev/docs/latest/Reference/Server/), [rede do Wokwi](https://docs.wokwi.com/guides/esp32-wifi).


O teste de integração cria credenciais descartáveis em `.validation/run-*`, não publica portas no host, inicia os dois serviços, valida TLS/ACL e fluxos MQTT/API, reinicia os serviços para verificar persistência e remove apenas os volumes/contêineres do projeto de testes ao terminar. Os arquivos ignorados são preservados para diagnóstico. Docker Desktop precisa compartilhar a pasta do projeto. As mensagens do dispositivo nesse teste são produzidas por um cliente MQTT de teste; não equivalem à execução do firmware no Wokwi.
