# NightCare

NightCare é um projeto acadêmico de Microprocessadores e Microcontroladores para apoiar deslocamentos noturnos de idosos em ambientes com vários leitos. Cada leito utiliza um ESP32 independente, sensor de movimento, iluminação ajustável e botão de ajuda. Uma interface web reúne acompanhamento, configuração e atendimento dos chamados.

O controle de luz e a sinalização de assistência funcionam localmente no dispositivo. Backend e interface acrescentam supervisão, histórico e comandos com confirmação do ESP32. O sistema é de apoio: não possui certificação médica nem garante prevenção de quedas.

## Etapas do projeto

1. **Prototipação atual:** Wokwi no navegador, broker público EMQX e backend/interface locais em Docker. Não exige broker próprio, domínio ou gateway privado. Utilize somente dados fictícios.
2. **Segunda etapa — dispositivo físico:** ESP32 real e Mosquitto próprio, com TLS, credenciais individuais e ACL. A infraestrutura de software está disponível; adaptação de Wi-Fi, montagem elétrica e validação em hardware continuam necessárias.

## Documentação

| Documento | O que você encontra |
| --- | --- |
| [Instalação e execução](docs/manual.md) | Docker, Git Bash no Windows, geração dos pacotes, Wokwi, registro dos leitos e operação dos serviços. **Comece aqui.** |
| [Arquitetura](docs/arquitetura.md) | Diagramas Mermaid dos dois ambientes, circuito, MQTT, persistência e confirmação de ações. |
| [Interface e API](docs/interface.md) | Dashboard, Iluminação e movimento, Assistência, Administração, Histórico, notificações e exemplos HTTP/WS. |
| [Comandos seriais](docs/serial.md) | Terminal do ESP32, sintaxe, exemplos, limites e ensaios locais. |
| [Pitch](docs/pitch.md) | Apresentação de 5–7 minutos, demonstração normal, condição anormal e recuperação. |
| [Testes e evidências](docs/testes.md) | Verificações automatizadas, cenários manuais/técnicos, evidências anteriores e pendências reais. |

## Estrutura das pastas

```text
NightCare/
├── Wokwi/                    # Firmware, circuito e bibliotecas
│   ├── demo/<deviceId>/      # Pacotes gerados para cada simulação (ignorados)
│   └── tls/<deviceId>/       # Headers privados de dispositivos adicionais (ignorados)
├── backend/                  # API Fastify, MQTT, SQLite e testes
├── frontend/                 # Interface React/TypeScript e Vite
├── mosquitto/                # Configuração e ACL do broker da segunda etapa
├── scripts/                  # Preparação, execução, provisionamento e testes
├── docs/                     # Guias de arquitetura, uso, apresentação e testes
├── compose.demo.yml          # Backend/interface com broker público
├── compose.frontend-dev.yml  # Interface com atualização automática
├── compose.yml               # Backend + Mosquitto próprio com TLS
├── platformio.ini            # Builds reproduzíveis do firmware
└── flake.nix / flake.lock    # Ambiente opcional de desenvolvimento Nix
```

A execução gera configurações e dados locais, como `.env.demo`, pacotes Wokwi e volumes SQLite. Credenciais TLS ficam em `.env`, `secrets/` e headers privados; esses arquivos não integram o repositório. Para iniciar sem perder uma sessão existente, consulte a diferença entre início normal e `--resume` no [manual](docs/manual.md#sessões-novas-e-retomada).
