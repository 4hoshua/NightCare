# NightCare

Projeto acadêmico da disciplina de Microprocessadores e Microcontroladores: assistente de deslocamento noturno para residências de idosos, instituições assistenciais e cuidados domiciliares.

O ESP32 detecta movimento, aciona iluminação de orientação e permite solicitar assistência por um botão, com sinalização por LED e buzzer.

## Estrutura de pastas

```text
NightCare/
├── Wokwi/
│   ├── sketch.ino
│   ├── diagram.json
│   └── wokwi-project.txt
├── .gitignore
└── README.md
```

| Pasta ou arquivo | Finalidade |
| --- | --- |
| `Wokwi/` | Projeto de simulação do circuito e firmware do ESP32. |
| `Wokwi/sketch.ino` | Firmware em C++/Arduino: leitura do sensor e botão, iluminação, agenda, persistência e assistência. |
| `Wokwi/diagram.json` | Componentes, posições e conexões elétricas do circuito no simulador. |
| `Wokwi/wokwi-project.txt` | Referência ao projeto original no Wokwi. |
| `.gitignore` | Define os arquivos locais que ficam fora do versionamento, incluindo `AGENTS.md` e o PDF de planejamento. |
| `README.md` | Apresentação do projeto, estrutura e instruções de simulação. |

## Estado atual

O firmware contém as etapas 1 a 4: circuito mínimo, iluminação com PWM e temporização, agenda com relógio e persistência, e solicitação de assistência local.

- Modos de iluminação `AUTO`, `ON` e `OFF`.
- Brilho padrão de 30%, temporização de 30 segundos e agenda das 22h às 6h.
- Configurações e chamado de assistência persistidos em NVS por `Preferences`.
- Chamados com estados pendente e reconhecido, além de encerramento após reconhecimento.
- Controle local independente da internet; Wi-Fi é usado para sincronizar o relógio via NTP.

A integração MQTT, o backend Node.js/TypeScript, o histórico em SQLite e o dashboard React estão planejados e ainda não possuem pastas neste repositório.

## Simulação

Abra o [projeto no Wokwi](https://wokwi.com/projects/479504505300117505) e confira se os arquivos correspondem aos desta pasta `Wokwi/`. Para simular esta versão, use o conteúdo de `sketch.ino` e `diagram.json` do repositório no simulador.

Inicie a simulação, clique no sensor PIR e selecione **Simulate Motion** para gerar movimento. Use o botão **AJUDA** para abrir ou reiterar um chamado. No monitor serial, envie `ajuda` para listar os comandos e `status` para consultar o estado atual.

| Componente | GPIO do ESP32 |
| --- | --- |
| Sensor PIR | 27 |
| Botão de ajuda (`INPUT_PULLUP`) | 14 |
| LED branco de orientação | 25 |
| LED vermelho de assistência | 26 |
| Buzzer | 32 |

A execução do firmware e a persistência após reinício ainda precisam de validação no simulador. O dispositivo é um sistema de apoio acadêmico, sem proposta de certificação médica ou prevenção garantida de quedas.
