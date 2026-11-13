# Instalação e execução — NightCare

[Índice](../README.md) · [Interface e API](interface.md) · [Arquitetura](arquitetura.md) · [Pitch](pitch.md)

Este guia prepara a primeira etapa: Wokwi no navegador, broker público e backend/interface locais. Para operar as telas após o cadastro, siga o [guia da interface](interface.md). Todos os comandos abaixo partem da raiz do repositório, em um terminal Bash.

## 1. Instalar os requisitos

**Docker com Compose v2 é essencial para o caminho descrito neste guia.** Ele executa backend e interface compilada, sem exigir Node local. Instale também Python 3, Bash e um navegador; mantenha acesso à internet para downloads, MQTT e NTP.

### Windows: Docker Desktop e Git Bash

1. Instale o [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/), usando backend WSL 2 e contêineres Linux. Se precisar instalar WSL, execute `wsl --install` no PowerShell como administrador e reinicie. Confira os requisitos de virtualização e sistema na página oficial.
2. Abra Docker Desktop e aguarde o mecanismo iniciar. Mantenha-o em execução durante o uso do projeto; o Compose v2 está incluído.
3. Instale [Git for Windows](https://git-scm.com/install/windows), que inclui **Git Bash**. É esse terminal que executará os scripts `.sh`; GitLab é uma plataforma de hospedagem e não substitui o Bash. Abra Git Bash pelo menu Iniciar ou pelo menu de contexto da pasta.
4. Instale [Python 3 para Windows](https://www.python.org/downloads/windows/). No instalador tradicional, habilite a inclusão no PATH. Reabra o Git Bash após instalar.
5. Entre na cópia local do projeto e verifique o ambiente:

   ```bash
   cd "/c/Users/SeuNome/Downloads/NightCare"
   docker info
   docker compose version
   python3 --version
   bash --version
   ```

Ajuste o caminho ao seu computador. `docker info` precisa mostrar a seção Server sem erro. Docker Desktop precisa ter acesso à pasta do projeto.

Se `python3` não existir ou abrir a Microsoft Store, mas `python --version` identificar Python 3, use no Git Bash:

```bash
python3() { python "$@"; }
export -f python3
python3 --version
```

A função vale para essa sessão e é herdada pelos scripts Bash iniciados nela.

### Linux e macOS

No Linux, instale [Docker Engine](https://docs.docker.com/engine/install/) e o [plugin Compose](https://docs.docker.com/compose/install/linux/), Python 3 e Bash. No macOS, instale [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/), Python 3 e use Bash. Verifique os mesmos comandos acima. No Linux, configure acesso ao daemon conforme a documentação do Docker; os scripts precisam conseguir executar `docker`.

## 2. Iniciar a aplicação

Na raiz do projeto:

```bash
bash scripts/demo.sh
```

O script gera uma sessão, prepara os arquivos do Wokwi e constrói/inicia a aplicação. Abra **http://localhost:3000**. Não há login nem token. Uma sessão nova começa sem leitos: o script não cadastra dispositivos no banco.

Se a porta estiver ocupada:

```bash
DEMO_HTTP_PORT=3001 bash scripts/demo.sh
```

Abra http://localhost:3001 e mantenha essa variável nos comandos que recriam a instalação. Ainda é necessário iniciar o ESP32 no Wokwi e associá-lo na Administração.

## Sessões novas e retomada

**Executar `bash scripts/demo.sh` sem `--resume` cria namespace MQTT e banco novos.** Os volumes anteriores são preservados, mas não passam a ser o banco da nova sessão. A configuração/pacotes anteriores são arquivados em `.validation/demo-sessions/<identificador>/`.

| Objetivo | Comando |
| --- | --- |
| Começar demonstração vazia | `bash scripts/demo.sh` |
| Continuar sessão atual, com leitos e histórico | `bash scripts/demo.sh --resume` |
| Preparar arquivos sem iniciar Docker ou rotacionar sessão | `bash scripts/demo.sh --prepare-only` |
| Começar sessão com dois pacotes disponíveis | `bash scripts/demo.sh --devices nightcare-001,nightcare-002` |
| Acrescentar/preparar pacotes na sessão atual | `bash scripts/demo.sh --prepare-only --devices nightcare-001,nightcare-002` |
| Retomar com interface de desenvolvimento | `bash scripts/demo.sh --resume --dev` |

`--devices` seleciona os pacotes gerados; não cria leitos nem restringe a descoberta a esses IDs. `--prepare-only` cria a configuração se ainda não houver uma. Para retomar, preserve `.env.demo` e o volume a que ele aponta. Não copie a configuração entre instalações independentes.

Após criar uma sessão nova, **copie novamente `mqtt_demo.h` para o Wokwi**. Um simulador com namespace antigo não será descoberto na sessão nova.

## 3. Preparar o projeto no Wokwi

1. Abra o [circuito NightCare no Wokwi](https://wokwi.com/projects/479504505300117505) e crie uma cópia própria.
2. Localize no computador a pasta gerada **`Wokwi/demo/nightcare-001/`**.
3. Substitua os arquivos/abas `sketch.ino`, `diagram.json` e `libraries.txt` pelos conteúdos desse pacote.
4. Crie uma aba com o nome exato **`mqtt_demo.h`** e copie todo o arquivo correspondente do mesmo pacote. Salve os quatro arquivos.
5. Inicie a simulação com o gateway público padrão. Não habilite gateway privado.

| Arquivo | Função | O que conferir |
| --- | --- | --- |
| `diagram.json` | Descreve ESP32, PIR, botão, LEDs, buzzer e conexões do circuito | Usar o circuito do pacote para manter os GPIOs corretos |
| `libraries.txt` | Declara bibliotecas necessárias à compilação no navegador | Copiar também esse arquivo; o sketch utiliza ArduinoJson |
| `sketch.ino` | Firmware: controle local, serial, Wi-Fi, MQTT, agenda e persistência | Usar a versão gerada, que seleciona explicitamente a demo |
| `mqtt_demo.h` | Configura broker, identidade, client ID e tópicos da sessão | Nome exato, conteúdo completo, sessão e dispositivo corretos |

**`mqtt_demo.h` é essencial para a interface detectar o dispositivo correto.** Backend e ESP32 precisam compartilhar a mesma raiz de tópicos; a identidade precisa ser única. O arquivo não associa o leito: ele permite comunicação e descoberta para posterior confirmação do operador. Não o substitua pelo `.example.h`.

Os arquivos diretos de `Wokwi/demo/` são aliases de `nightcare-001`; prefira a pasta com ID explícito. Não adicione headers TLS (`mqtt_secrets.h` ou exemplos) nem `wokwi.toml` ao projeto no navegador. O último é destinado ao uso opcional da extensão local.

A demo usa `Wokwi-GUEST` sem senha, `broker.emqx.io:1883` e NTP `pool.ntp.org`. Não use `localhost` como broker: o ESP32 simulado acessa a internet pelo gateway do Wokwi, não a rede privada do computador. [Rede do Wokwi](https://docs.wokwi.com/guides/esp32-wifi).

## 4. Registrar o dispositivo e concluir o setup

1. No monitor serial, a 115200 baud, aguarde conexão Wi-Fi/MQTT e sincronização NTP. `status` permite conferir o `deviceId`.
2. Na interface, abra **Administração → Dispositivos e leitos**. Aguarde o dispositivo descoberto receber estado novo e ficar online.
3. Confira o ID, escolha um nome, por exemplo **Leito 1**, e confirme a associação.
4. Verifique o cartão no Dashboard e selecione o leito nas telas operacionais.

**Com o dispositivo comunicando e associado ao nome do leito, o setup está pronto para uso.** Para reconhecer/encerrar chamados remotamente, aguarde também relógio real válido. O boot sincroniza automaticamente; não é necessário digitar comandos de relógio no início normal.

A associação exige presença recente e nome único, com 1–64 caracteres após remover espaços das pontas. A unicidade considera normalização Unicode e caixa. O vínculo é permanente nesta versão: é possível corrigir o nome, mas não transferir, remover ou substituir o dispositivo. O nome não é gravado no ESP32.

Para confirmar o funcionamento inicial, use **Simulate Motion** no PIR e o botão AJUDA. Para testar luz automática durante o dia, envie pelo painel modo AUTO, agenda **00:00–00:00** e prazo de 5 s. Aguarde confirmação antes de acionar o PIR. O [guia da interface](interface.md#interações-com-o-esp32) explica respostas normais e falhas.

## 5. Usar dois ou mais leitos

Prepare os IDs na mesma sessão com `--devices`. Abra projetos/cópias Wokwi separados e copie os quatro arquivos da pasta de cada ID. Cada simulação utiliza um ESP32, client ID e tópicos próprios. Nunca execute duas simulações usando o mesmo pacote.

Inicie os simuladores e associe cada ID na Administração. Mantenha janelas ativas quando possível. O Dashboard mostra os leitos juntos, mas movimento, parâmetros, assistência, configurações e comandos permanecem independentes. Não há comunicação direta entre simuladores.

## 6. Acompanhar, parar e retomar

```bash
# Consultar serviços e últimos logs da demo
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml ps
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml logs --tail=100 backend
# Parar serviços, preservando o volume SQLite
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml down
# Retomar a mesma sessão
bash scripts/demo.sh --resume
```

Se ativou desenvolvimento, inclua `-f compose.frontend-dev.yml` no comando `down` para parar também Vite. **`down -v` remove volumes**; não o use para uma parada normal. Não execute o início normal para retomar dados antigos: ele cria outra sessão.

A saúde do contêiner demo verifica o processo HTTP, não garante conexão ao broker. Consulte `GET /health/ready` ou os indicadores do painel para diagnosticar MQTT.

## 7. Editar a interface com atualização automática

```bash
bash scripts/demo.sh --resume --dev
```

Abra **http://localhost:5173** e edite `frontend/`. Vite observa alterações com polling e atualiza CSS/React; algumas mudanças recarregam a página e podem perder rascunhos/ativação do áudio. A porta 3000 continua com a versão compilada na imagem.

Para ativar somente Vite com backend já iniciado, sem recriá-lo:

```bash
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml -f compose.frontend-dev.yml up --build --no-deps --renew-anon-volumes -d --wait frontend-dev
```

Repita após alterações em `frontend/package.json` ou no lock para reinstalar dependências. Para parar somente Vite, use os mesmos arquivos Compose com `stop frontend-dev`. Portas alternativas podem ser informadas com `DEMO_HTTP_PORT=3001 DEV_HTTP_PORT=5174 bash scripts/demo.sh --resume --dev`.

Vite encaminha API/WS ao mesmo backend. Auxiliares temporários usados em validações antigas não fazem parte da instalação padrão.

### Desenvolvimento opcional sem Docker

O caminho de instalação acima continua sendo Docker. Para desenvolvimento nativo, use Node **>=22.13** e instale dependências com `npm ci --prefix backend` e `npm ci --prefix frontend`. A dependência SQLite nativa pode exigir Python, make e g++. Compile com `npm run build --prefix frontend` e `npm run build --prefix backend`.

Antes de `npm start --prefix backend`, configure `DEMO_MODE=true`, `MQTT_URL`, `MQTT_PREFIX` e `MQTT_CLIENT_ID` com os valores da sessão preparada em `.env.demo`. Defina `STATIC_ROOT` com o caminho absoluto de `frontend/dist`; o backend não carrega `.env.demo` automaticamente. Os padrões locais são `HOST=127.0.0.1`, porta 3000 e `DB_PATH=./data/nightcare.sqlite`. Não execute dois backends sobre o mesmo banco/instalação.

Para usar `npm run dev --prefix frontend` fora do Docker, ajuste os destinos de proxy de `frontend/vite.config.ts` de `backend:3000` para `127.0.0.1:3000`. O repositório também mantém `flake.nix`/`flake.lock`: `nix develop` oferece ferramentas e os auxiliares `nc status` e `nc "events?scope=all&limit=20"` consultam a API local. A execução desse ambiente Nix permanece pendente nas evidências consolidadas.

## Segunda etapa: preparar Mosquitto próprio

Esta seção prepara a infraestrutura de software para a segunda etapa descrita na [arquitetura](arquitetura.md#segunda-etapa-do-projeto-esp32-real-e-mosquitto-próprio). Não transforma o pacote demo em firmware pronto para hardware.

Em uma cópia sem configuração TLS anterior, tenha Docker, Python 3, Bash, OpenSSL e DNS/IPv4 público alcançável na porta 8883. Não inclua protocolo nem porta no argumento:

```bash
bash scripts/setup.sh HOST_PUBLICO
docker compose up --build -d
```

Substitua `HOST_PUBLICO` pelo endereço real. O script gera CA privada, certificado, usuários MQTT separados, `.env` e `Wokwi/mqtt_secrets.h`. Recusa sobrescrever configuração existente. Preserve esses arquivos e não publique segredos. O painel continua em loopback na porta 3000; evite conflito com a demo antes de iniciar essa modalidade.

Para o primeiro dispositivo, compile `Wokwi/sketch.ino` com `NIGHTCARE_DEMO=0`, circuito/bibliotecas originais e `mqtt_secrets.h`. O ambiente PlatformIO `esp32dev` já fixa essa seleção. Em edição manual Arduino, coloque `#define NIGHTCARE_DEMO 0` antes dos includes. Não use o pacote `Wokwi/demo/` para TLS.

**No ESP32 físico, adapte a chamada Wi-Fi ainda fixa para `Wokwi-GUEST` à rede real antes de gravar.** Os scripts não provisionam SSID/senha Wi-Fi. Verifique alimentação, compatibilidade elétrica e estágio de potência; o LED simulado representa a luminária. Compilação e testes com clientes MQTT não comprovam execução em hardware.

Para adicionar credencial de outro dispositivo:

```bash
bash scripts/provision-device.sh nightcare-002
```

O script preserva CA/senhas existentes, gera `Wokwi/tls/nightcare-002/mqtt_secrets.h` e solicita reload do Mosquitto. Use o header individual na pasta de build desse dispositivo, com identidade correspondente e seleção TLS. Se o broker estiver parado, acrescente `--no-reload` e inicie/recarregue depois. Instalações antigas precisam ter a ACL atualizada. Provisionar MQTT não associa leito: confirme o vínculo na Administração após comunicação recente.

TLS valida CA, hostname e data; aguarde NTP. Não publique headers privados em projetos Wokwi compartilhados. HTTP/WS permanecem sem autenticação: TLS MQTT não acrescenta HTTPS ou login. Para host remoto, use acesso local ou túnel SSH.

### Backup e restauração

Antes de atualização/migração, faça backup consistente do SQLite: use a API de backup SQLite com banco ativo, ou pare o backend antes de copiar. Copiar apenas o arquivo principal com banco em uso pode perder dados do WAL. Na demo, identifique o volume correto pela configuração `.env.demo`; TLS usa `sqlite_data`. Preserve também configuração da sessão e, no TLS, material privado e volume Mosquitto.

Restaure primeiro em cópia/volume separado, com mesma versão de software e banco parado; confira integridade, vínculos e coleções antes de substituir a instalação. Não execute início de sessão nova como procedimento de restauração. Os [cenários técnicos](testes.md) distinguem ensaio de migração já realizado de restauração completa ainda pendente.

## Solução de problemas

| Sintoma | Conferir / resposta |
| --- | --- |
| Docker indisponível | Iniciar Docker Desktop/daemon, modo Linux, compartilhamento da pasta e `docker info` |
| `python3` ausente no Windows | Instalação/PATH ou função Bash apresentada no início |
| Porta ocupada | Usar `DEMO_HTTP_PORT`; Vite usa `DEV_HTTP_PORT` |
| Wokwi pede header TLS na demo | Copiar os quatro arquivos gerados, sobretudo sketch e `mqtt_demo.h`; remover seleção TLS indevida |
| Broker conectado, dispositivo ausente | Header da sessão atual, ID, prefixo, Wi-Fi e saída TCP 1883; iniciar a simulação |
| Dispositivo aparece offline após reinício | Aguardar estado novo; retido não estabelece presença |
| Associação recusada | Presença recente, dispositivo ainda sem vínculo e nome único |
| Cadastros parecem ter desaparecido | Conferir se iniciou sessão nova; `--resume` retoma a configuração atual, não escolhe automaticamente sessão arquivada |
| Reconhecimento não confirma | Conferir estado do chamado, NTP, validade e motivo do comando; aguardar ACK, sem repetir cliques indiscriminadamente |
| 5173 e 3000 exibem versões diferentes | 5173 acompanha fontes; reconstruir backend com `--resume` atualiza a versão compilada |
| Broker público indisponível | Conferir conectividade e aguardar recuperação; luz/botão locais continuam independentes da rede |

O broker da demo não oferece privacidade ou autenticação de autores. Use dados fictícios. Consulte [testes](testes.md) para falhas instrumentadas e [serial](serial.md) para comandos locais.
