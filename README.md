# NightCare

MVP acadêmico de Microprocessadores e Microcontroladores para apoiar deslocamentos noturnos: ESP32, sensor de movimento, luz com brilho ajustável e botão de ajuda. O cuidador acompanha o ambiente e atende chamados pelo dashboard.

**O caminho principal é gratuito:** Wokwi no navegador, broker MQTT público sem cadastro e backend/dashboard no seu computador. Não exige gateway privado, VPS, domínio, cartão ou abertura de portas no roteador. Use somente dados fictícios: o broker da demonstração é público, sem autenticação ou privacidade. O projeto é um sistema de apoio, sem certificação médica ou garantia de prevenção de quedas.

## Começar em poucos passos

Requisitos: Docker com Compose v2, Python 3, Bash, internet e navegador. Docker Desktop precisa ter acesso à pasta do projeto. Não é necessário instalar Node para executar pelo Docker.

### Preparar o Windows (Docker Desktop e Git Bash)

1. Baixe o [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/) e execute o instalador. Use o backend **WSL 2** e contêineres **Linux**. Se o WSL ainda não estiver instalado, abra o **PowerShell como administrador**, execute `wsl --install` e reinicie o computador. A virtualização precisa estar habilitada na BIOS/UEFI; confira os requisitos do Windows na página oficial.
2. Abra o **Docker Desktop** pelo menu Iniciar e aguarde o mecanismo Docker ficar em execução. Mantenha o aplicativo aberto durante a demonstração; ele já inclui o Compose v2.
3. Baixe e instale o [Git for Windows](https://git-scm.com/install/windows), que inclui o **Git Bash**. Mantenha os componentes padrão, incluindo a integração com o Explorador de Arquivos. Após instalar, abra **Git Bash** pelo menu Iniciar ou use **Open Git Bash here** no menu de contexto da pasta `NightCare` (no Windows 11, pode estar em **Mostrar mais opções**).
4. Instale também o [Python 3 para Windows](https://www.python.org/downloads/windows/), caso ainda não tenha. Ao usar o instalador tradicional, marque **Add python.exe to PATH**. Feche e reabra o Git Bash após as instalações para atualizar o PATH.
5. No **Git Bash**, entre na pasta do projeto e confira os requisitos. Por exemplo, para um projeto em `C:\Users\SeuNome\Downloads\NightCare`:

   ```bash
   cd "/c/Users/SeuNome/Downloads/NightCare"
   docker info
   docker compose version
   python3 --version
   ```

   Substitua `SeuNome` pelo seu usuário e ajuste o caminho se necessário. `docker info` deve mostrar a seção **Server** sem erro; se falhar, confirme que o Docker Desktop terminou de iniciar.

   O script exige o comando `python3`. Se ele não existir ou abrir a Microsoft Store, mas `python --version` mostrar Python 3, execute no Git Bash:

   ```bash
   python3() { python "$@"; }
   export -f python3
   python3 --version
   ```

   Essa adaptação vale para a sessão atual do terminal e é herdada pelo `bash scripts/demo.sh`.

### Executar a demonstração

Na raiz do projeto, execute no Bash (no Windows, use o **Git Bash** preparado acima):

```bash
bash scripts/demo.sh
```

O script prepara uma configuração exclusiva e inicia o backend com o dashboard. Abra **http://localhost:3000**. O painel abre sem login; o dispositivo ficará offline até iniciar a simulação.

Se a porta 3000 já estiver em uso:

```bash
DEMO_HTTP_PORT=3001 bash scripts/demo.sh
```

Nesse caso, abra http://localhost:3001 e use a mesma variável em futuras execuções. Para preparar apenas os arquivos do Wokwi, sem iniciar Docker:

```bash
bash scripts/demo.sh --prepare-only
```

O script gera `.env.demo`, `Wokwi/mqtt_demo.h` e um pacote em `Wokwi/demo/`. Ele reutiliza o identificador nas execuções seguintes, não altera `.env`, `secrets/` ou `mqtt_secrets.h` da modalidade TLS e recusa substituir um `mqtt_demo.h` que pertença a outra configuração. Não copie `.env.demo` entre demonstrações independentes: cada instalação precisa de seu próprio prefixo.

### Iniciar a simulação gratuita

1. Abra o [circuito original no Wokwi](https://wokwi.com/projects/479504505300117505) e crie sua cópia.
2. Substitua `sketch.ino`, `diagram.json` e `libraries.txt` pelos arquivos de **`Wokwi/demo/`** gerados pelo script.
3. No editor do Wokwi, crie um arquivo/aba com o nome exato **`mqtt_demo.h`** e cole todo o conteúdo de `Wokwi/demo/mqtt_demo.h`. Salve antes de iniciar a simulação. Os quatro arquivos necessários são `sketch.ino`, `diagram.json`, `libraries.txt` e `mqtt_demo.h`; **não é necessário adicionar `mqtt_secrets.h`, `mqtt_secrets.example.h` ou `mqtt_demo.example.h`**. Não copie `wokwi.toml` para o navegador.
4. Inicie a simulação. Use o gateway público padrão; não habilite o gateway privado.
5. No monitor serial, acompanhe Wi-Fi e a mensagem MQTT conectado. No painel, aguarde o dispositivo ficar online.
6. Clique no PIR e em **Simulate Motion**. Pressione o botão AJUDA para abrir um chamado.

A rede simulada é `Wokwi-GUEST`, sem senha, e o NTP usa `pool.ntp.org`. Aguarde a sincronização antes de reconhecer/encerrar pelo painel. Para testar iluminação durante o dia, envie pelo painel agenda **00:00–00:00**, ou use o modo **Ligado**. Horários iguais significam funcionamento automático 24 h.

O ESP32 conecta a `broker.emqx.io:1883` pela internet; o backend conecta ao mesmo broker. **Não use `localhost`, `mosquitto` ou `host.wokwi.internal` como endereço MQTT no Wokwi deste roteiro.** O gateway público não acessa sua rede local. [Rede e gateway público do Wokwi](https://docs.wokwi.com/guides/esp32-wifi)

### Credenciais e parâmetros da demo

| Parâmetro | Valor / origem |
| --- | --- |
| Broker | `broker.emqx.io`, TCP `1883` |
| Usuário e senha MQTT | vazios; serviço público sem autenticação |
| Painel, API e WebSocket | sem login ou token em ambas as modalidades |
| Wi-Fi | `Wokwi-GUEST`, senha vazia |
| Prefixo MQTT | `nightcare/demo/<identificador>/nightcare-001/` |
| Identificador da instalação | 16 caracteres hexadecimais gerados em `.env.demo` |
| Client IDs | `nightcare-<identificador>-backend` e `nightcare-<identificador>-device` |
| API/dashboard | `http://localhost:3000`, apenas loopback |

Não há segredos a solicitar ou configurar no modo demo. O prefixo exclusivo evita colisões acidentais, mas qualquer pessoa pode ler ou publicar mensagens se conhecer o tópico. Nunca envie dados pessoais ou credenciais por esse broker. O EMQX disponibiliza o serviço para protótipos e testes, sem necessidade de preparar infraestrutura. [Endereço e portas do broker público](https://www.emqx.com/en/mqtt/public-mqtt5-broker)

## Arquitetura

```mermaid
flowchart LR
  PIR[PIR e botão] --> ESP[ESP32 no Wokwi gratuito]
  ESP --> OUT[Luz PWM, LED de ajuda e buzzer]
  ESP <-->|MQTT público / QoS 1| BROKER[Broker público EMQX]
  BROKER <-->|MQTT| API[Backend Node / Fastify]
  API <--> DB[(SQLite)]
  UI[Dashboard React no navegador] <-->|HTTP e WebSocket locais| API
```

O ESP32 controla iluminação, agenda, debounce e sinalização de ajuda. A rede roda em tarefa própria e entrega mensagens ao loop por fila FreeRTOS. Falha de internet não interrompe PIR, botão ou saídas locais.

O broker encaminha eventos, estado, configurações e comandos. O backend valida as mensagens, registra histórico em SQLite e confirma ações somente após resposta do dispositivo. O dashboard acessa o backend; não conecta diretamente ao ESP32 nem ao broker.

O frontend React/TypeScript é compilado com Vite e servido pelo próprio Fastify. HTTP e WebSocket usam o mesmo endereço, sem outro servidor de frontend. O backend envia snapshots iniciais e alterações por `/ws`; o painel reconecta automaticamente e recupera o histórico. O banco usa WAL e preserva configurações desejadas, pedidos e comandos antes de publicá-los.

| Parte | Arquivos principais |
| --- | --- |
| Firmware e circuito | `Wokwi/sketch.ino`, `Wokwi/diagram.json` |
| Dashboard único em `/` | `frontend/src/` (`/dashboard` e `/dashboard/` redirecionam para `/`) |
| API, MQTT e SQLite | `backend/src/` |
| Execução gratuita | `compose.demo.yml`, `scripts/demo.sh` |
| Alternativa com broker próprio/TLS | `compose.yml`, `mosquitto/`, `scripts/setup.sh` |
| Testes | `backend/test/`, `scripts/test-*.sh` |

### Estados e confirmações

Iluminação, assistência e comunicação são independentes. Desconectar MQTT não encerra um chamado nem muda o modo de luz.

O painel apresenta conexão WebSocket, broker e dispositivo separadamente. Estado retido é uma fotografia: o backend espera mensagem nova para indicar presença e considera offline após **45 s** sem atualização, ou ao receber `offline`. O ESP32 envia heartbeat a cada **15 s**.

Ao enviar configuração, o painel mostra a versão desejada e a versão aplicada pelo ESP32. Um HTTP **202** indica intenção registrada; a confirmação vem de `acks` ou de `state.appliedConfigVersion`. Mudanças locais por serial não incrementam a versão remota: confira também os valores atuais nos cartões.

O botão abre um pedido `PENDING`. **Reconhecer** muda para `ACKNOWLEDGED`; **Encerrar** só é permitido depois e retorna a `NONE`. Chamados não expiram com a luz. Novos cliques reiteram o mesmo pedido. O painel mantém o aviso, mostra o tempo desde a primeira observação da abertura e oferece som ativado pelo usuário; exige aba aberta e conectada. Para registros anteriores à migração, a abertura usa o primeiro recebimento disponível, ou a última atualização quando não há histórico.

Comandos exibem enviado, confirmado, recusado ou **não confirmado** após dez segundos sem ACK. São válidos por 60 s. O painel bloqueia ações incompatíveis e aguarda a confirmação; o backend e o firmware também validam pedido, relógio e transição. Um ACK MQTT de transporte não confirma atendimento.

## Navegação do painel

A barra lateral pode ser expandida ou recolhida. No celular, o botão de menu abre as mesmas opções. Cada tela possui endereço próprio (`#dashboard`, `#iluminacao`, `#assistencia`, `#administracao`) e funciona com voltar/avançar do navegador.

| Tela | Uso |
| --- | --- |
| Dashboard | visão geral de conexão, luz, movimento e chamado, com atalhos de acompanhamento |
| Iluminação e movimento | estado da luz e PIR; troca rápida de modo; edição de modo, brilho, agenda e prazo |
| Assistência | pedido ativo, acionamentos do botão, tempo desde abertura, reconhecer/encerrar e resultados das últimas ações |
| Administração | eventos por período/tipo; históricos paginados de chamados, comandos e configurações; parâmetros atuais e diagnósticos |

O indicador de chamado e o controle de som ficam disponíveis em todas as telas. Trocar de tela preserva o formulário em edição, os filtros, o áudio habilitado e a conexão em tempo real. Administração organiza as informações existentes; não cria um perfil de acesso separado.

Modo e brilho atuais vêm do estado do ESP32. O firmware atualizado também publica agenda, prazo e offset UTC efetivamente ativos em `runtimeSettings`, incluindo alterações pelo serial. O painel separa esses parâmetros da configuração remota confirmada e da última configuração enviada. Firmware anterior continua aceito: nesse caso o painel informa a ausência dessa telemetria. A versão confirmada é consultada diretamente no banco, mesmo fora das 30 configurações recentes. Offline, os dados são identificados como última informação recebida.

Os botões **Automático / Ligado / Desligado** enviam uma configuração completa baseada nos últimos parâmetros enviados, alterando apenas o modo dessa intenção. Sem envio anterior, usam os padrões do firmware. As demais edições ainda não enviadas permanecem no formulário e não são publicadas por esses botões. A confirmação continua dependendo do ESP32.

Administração permite **Carregar mais** em eventos, chamados, comandos e configurações, em páginas de 100 registros. Ao consultar páginas antigas, atualizações ao vivo preservam a consulta; **Atualizar consulta** retorna aos registros mais recentes. Eventos têm filtros por tipo/período e detalhes de identificação. Chamados mostram abertura e acionamentos; comandos mostram resultado, motivo e validade; configurações mostram versões e parâmetros. Boot, sequência, tempo em execução, persistência e perdas aparecem nos diagnósticos. Esses valores refletem a última telemetria recebida, não estimativas do navegador.

## Circuito e controle local

| Componente | Ligação |
| --- | --- |
| PIR OUT | GPIO 27, alimentação 5 V e GND |
| Botão AJUDA | GPIO 14 e GND, `INPUT_PULLUP` |
| LED branco, representando luminária | GPIO 25, resistor 220 Ω e GND |
| LED vermelho de assistência | GPIO 26, resistor 220 Ω e GND |
| Buzzer | GPIO 32 e GND |

Padrões: `AUTO`, brilho **30%**, prazo **30 s**, agenda **22:00–06:00**, São Paulo/UTC−3 fixo. O início da agenda é inclusivo e o fim exclusivo. `ON` mantém luz no brilho configurado; `OFF` mantém apagada. Em `AUTO`, sair da agenda apaga imediatamente. PIR ativo mantém luz ligada; o prazo começa quando fica inativo e novo movimento cancela o desligamento.

Sem relógio válido, `AUTO` aceita movimento o dia todo e informa `clockValid=false`. O botão funciona a qualquer hora, inclusive com luz desligada. Debounce: 50 ms. Pedido pendente: LED alterna a cada 500 ms e buzzer toca 100 ms a cada 5 s. Reconhecido: LED aceso e buzzer silencioso.

Monitor serial, 115200 baud:

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
rede off
rede on
```

Brilho aceita 1–100%, prazo 1–600 s, e `fuso` aceita inteiro −12..+14. A configuração remota usa `America/Sao_Paulo`, mapeado para UTC−3 sem regras de horário de verão. `hora HH:MM` congela o relógio para testar agenda; `hora invalida` simula falha. Ambos impedem comandos remotos: use `hora real` e aguarde NTP antes de atender pelo painel. Reconhecimento/encerramento seriais são controles locais de teste.

Configuração e chamado ativo são gravados em NVS. Teste primeiro com `reiniciar`; parar e reabrir o Wokwi é outro cenário, pois a persistência depende do simulador. A fila de eventos e o contador de perdas estão em RAM e desaparecem no reboot.

## Testes automatizados e compilação

```bash
bash scripts/test-backend.sh
bash scripts/test-demo.sh
bash scripts/test-integration.sh
bash -n scripts/demo.sh scripts/setup.sh scripts/test-backend.sh scripts/test-demo.sh scripts/test-integration.sh
```

Os testes usam Node 22 em Docker. `test-demo.sh` cria broker anônimo **isolado, sem publicar portas**, backend e SQLite temporários; verifica dashboard servido, WebSocket, configuração confirmada, ajuda/reconhecimento/encerramento, deduplicação, relógio inválido e recuperação de presença. `test-integration.sh` valida a alternativa TLS, autenticação, ACL, Last Will e persistência após reinício. Ambos usam clientes MQTT que representam o dispositivo; não executam o firmware. Os scripts removem seus próprios contêineres/volumes e preservam diagnóstico em `.validation/`.

Para compilar localmente, instale PlatformIO Core **6.1.18**:

```bash
bash scripts/demo.sh --prepare-only
pio run -e esp32demo
# Alternativa TLS:
pio run -e esp32dev
```

O ambiente fixa `espressif32@6.12.0`, Arduino ESP32 2.0.17 e ArduinoJson 7.4.2. O pacote gerado inclui `wokwi.toml` com o binário demo para uso opcional da extensão VS Code; o caminho principal é o navegador gratuito. A variante ESP-IDF 5 do código não está validada.

A [auditoria e o roteiro completo de validação](docs/VALIDACAO.md) relacionam capacidades, acesso, cenários normais/anormais e pendências. Cobrem comandos seriais, circuito, interface, API, MQTT, persistência, falhas e operação. Cada teste inclui resultados esperados e restauração. Compilação e cliente MQTT não substituem testes do circuito no Wokwi.

## API e tópicos MQTT

Na demo, exemplos funcionam sem token:

```bash
curl -fsS http://localhost:3000/api/status
curl -fsS 'http://localhost:3000/api/events?limit=20&type=HELP_OPENED'
curl -fsS -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"AUTO","brightnessPct":55,"offDelaySec":5,"startTime":"00:00","endTime":"00:00","timezone":"America/Sao_Paulo"}'
```

| Rota | Uso |
| --- | --- |
| `GET /health/live` | processo HTTP ativo |
| `GET /health/ready` | SQLite e conexão MQTT; 503 sem broker |
| `GET /ui-config` | informa se o modo demo está ativo |
| `GET /api/status` | dispositivo, configuração aplicada/chamado ativo consultados diretamente, listas recentes e contador de eventos |
| `GET /api/events?limit=100&type=...&from=...&to=...` | histórico em array; datas ISO UTC, limite 1–500 |
| `GET /api/events?page=true&limit=100&cursor=...` | eventos paginados; aceita os mesmos filtros |
| `GET /api/requests`, `/api/commands`, `/api/configs` | históricos paginados; `limit` e `cursor` opcionais |
| `POST /api/config` | configuração completa; backend atribui versão crescente |
| `POST /api/commands` | `commandId`, `requestId`, `action: ACK_HELP ou CLOSE_HELP` |
| `GET /api/commands/:id` | resultado da intenção |
| `GET /ws` com upgrade WebSocket | `{type:"snapshot",data:...}` inicial e ao mudar dados |

Para comandos manuais, copie o requestId ativo de `/api/status`. Use um ID novo por intenção e repita o mesmo corpo/ID apenas para repetir a mesma intenção:

```bash
curl -fsS -X POST http://localhost:3000/api/commands \
  -H 'Content-Type: application/json' \
  -d '{"commandId":"demo-ack-001","requestId":"ID_ATIVO","action":"ACK_HELP"}'
curl -fsS http://localhost:3000/api/commands/demo-ack-001
```

Aguarde `APPLIED` e `ACKNOWLEDGED` no estado; depois envie `CLOSE_HELP` com outro commandId. HTTP 400 indica entrada inválida; 409 indica conflito, offline, relógio inválido ou transição incompatível. Painel, API e WebSocket não exigem login, token nem mensagem de autenticação, inclusive na modalidade com MQTT TLS. `API_TOKEN` de uma configuração antiga é ignorado; não é necessário regenerar credenciais nem apagar volumes. A API continua publicada apenas em `127.0.0.1` pelo Compose.

Consultas paginadas retornam `{items,nextCursor}`. Quando `nextCursor` for diferente de `null`, envie-o como `cursor` preservando os filtros. A ordenação é decrescente por recebimento/ID nos eventos, abertura/ID nos chamados, criação/ID nos comandos e versão nas configurações. As coleções de chamados, comandos e configurações sempre usam esse formato; eventos sem `page=true` e sem cursor preservam o array anterior. Cursor inválido, cursor de outra coleção/filtros e período invertido retornam HTTP 400. A paginação não congela resultados: novas inserções e alterações podem ocorrer durante a leitura; use Atualizar consulta para recuperar o estado recente.

Todos os tópicos abaixo usam o prefixo da instalação. Payloads preservam `schemaVersion:1` e `deviceId:"nightcare-001"`.

| Sufixo | Direção | QoS | Retido |
| --- | --- | --- | --- |
| `events` | ESP32 → backend | 1 | não |
| `state` | ESP32 → backend | 1 | sim |
| `availability` | ESP32 → backend | 1 | sim, Last Will offline |
| `config/set` | backend → ESP32 | 1 | sim |
| `commands` | backend → ESP32 | 1 | não |
| `acks` | ESP32 → backend | 1 | não |

Eventos têm eventId exclusivo por dispositivo/boot/contador, tipo, uptime, requestId quando aplicável e horário UTC ou `null`. SQLite deduplica pelo eventId. O estado inclui boot, sequência, uptime, modo, luz, brilho, movimento, assistência, acionamentos, relógio, versão aplicada, perdas e persistência. Atualize primeiro o backend/interface e depois os arquivos Wokwi; um backend antigo pode rejeitar campos novos. O objeto opcional `runtimeSettings` inclui `offDelaySec`, `startTime`, `endTime` e `timezoneOffsetHours` (−12..+14). Configurações inválidas ou antigas são rejeitadas integralmente; repetição igual não regrava NVS. Comandos repetidos não repetem transições; pedido e resultado são gravados atomicamente na NVS com diário dos últimos 16 comandos.

## Operação, desenvolvimento e alternativa TLS

```bash
# Diagnóstico da demo
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml ps
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml logs --tail=100 backend
# Parar preservando SQLite
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml down
```

`down` preserva o volume do banco. `down -v` apaga o histórico e deve ser usado apenas para descarte intencional. A disponibilidade da demo depende do broker público. Se não conectar, confira internet, saída TCP 1883, host e igualdade do prefixo nos arquivos copiados ao Wokwi. Broker conectado com dispositivo offline indica que falta estado novo do ESP32; aguarde heartbeat. NTP inválido bloqueia comandos remotos, mas não a conexão MQTT sem TLS.

Para desenvolvimento sem Docker, use **Node >=22.13**; a imagem fixa **22.21.1**. SQLite nativo pode exigir Python/make/g++. Execute `npm ci --prefix backend`, `npm ci --prefix frontend`, os builds de ambos e inicie o backend com `DEMO_MODE=true`, `MQTT_URL`, `MQTT_PREFIX`, `MQTT_CLIENT_ID` da `.env.demo` e `STATIC_ROOT` apontando para o caminho absoluto de `frontend/dist`. `HOST` padrão é `127.0.0.1`, porta 3000, e `DB_PATH` padrão é `./data/nightcare.sqlite`. Execute `npm start --prefix backend`. Há somente uma instância do backend por instalação e banco.

A modalidade anterior com Mosquitto próprio/TLS permanece **opcional**, separada da demo. Em uma configuração nova com um host acessível pela internet:

```bash
bash scripts/setup.sh HOST_PUBLICO
docker compose up --build -d
```

Ela exige DNS/IPv4 acessível e TCP 8883; gera CA, certificado SAN para host e `mosquitto`, usuários MQTT separados. O script recusa sobrescrever `.env`, `secrets/` ou `mqtt_secrets.h`. Para o firmware TLS, use `Wokwi/sketch.ino`, circuito, bibliotecas e `mqtt_secrets.h`, com `#define NIGHTCARE_DEMO 0` na primeira linha para selecionar TLS explicitamente; esse caminho não usa o pacote `Wokwi/demo/`. TLS valida CA, hostname e data; não usa aceitação indiscriminada de certificados. A API permanece local, sem autenticação HTTP; em servidor remoto, pode ser acessada por túnel SSH. TLS e ACL aqui protegem a conexão MQTT; não acrescentam HTTPS ou login ao painel. Não publique credenciais reais em projetos Wokwi compartilhados.

Faça backup de SQLite com backend parado ou pela API de backup do SQLite; não ignore o WAL ao copiar um banco em uso. O projeto continua limitado a um dispositivo, UTC−3 fixo e eventos pendentes em RAM. Uma luminária física exige circuito de potência e alimentação apropriados; o LED representa essa saída na simulação.

## Interface única e ambiente Nix

As contribuições funcionais de Gabriel-c0Nsp foram incorporadas em `frontend/`, preservando as quatro telas e o WebSocket. Não há segundo projeto de dashboard ou formulário de login. Links antigos `/dashboard` e `/dashboard/` redirecionam com HTTP 308 para `/`.

O repositório mantém `flake.nix` e `flake.lock` para desenvolvimento Nix. O auxiliar `nc status` / `nc "events?limit=20"` consulta a API local sem token.
