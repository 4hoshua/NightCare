#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ${1:-} != '' && ${1:-} != --prepare-only ]]; then
  echo 'Uso: bash scripts/demo.sh [--prepare-only]' >&2; exit 1
fi
command -v python3 >/dev/null || { echo 'Instale Python 3.' >&2; exit 1; }
python3 - <<'PY'
from pathlib import Path
import secrets,shutil,re
root=Path('.')
env=root/'.env.demo'
if not env.exists():
    ident=secrets.token_hex(8)
    env.write_text(f'MQTT_URL=mqtt://broker.emqx.io:1883\nMQTT_PREFIX=nightcare/demo/{ident}/nightcare-001/\nMQTT_CLIENT_ID=nightcare-{ident}-backend\n')
values=dict(line.split('=',1) for line in env.read_text().splitlines() if line and not line.startswith('#'))
prefix=values['MQTT_PREFIX']
if not re.fullmatch(r'nightcare/demo/[a-f0-9]{16}/nightcare-001/',prefix):
    raise SystemExit('MQTT_PREFIX inválido em .env.demo; preserve o identificador gerado.')
if values['MQTT_URL']!='mqtt://broker.emqx.io:1883':
    raise SystemExit('O modo demo usa mqtt://broker.emqx.io:1883.')
ident=prefix.split('/')[2]
if values['MQTT_CLIENT_ID']!=f'nightcare-{ident}-backend': raise SystemExit('MQTT_CLIENT_ID não corresponde à instalação.')
header=f'''#pragma once
// Configuração pública de demonstração; não contém segredos.
#define MQTT_HOST "broker.emqx.io"
#define MQTT_PORT 1883
#define MQTT_USE_TLS 0
#define MQTT_USER ""
#define MQTT_PASSWORD ""
#define MQTT_TOPIC_PREFIX "{prefix}"
#define MQTT_CLIENT_ID "nightcare-{ident}-device"
static const char MQTT_CA[] = "";
'''
target=root/'Wokwi/mqtt_demo.h'
if target.exists() and target.read_text()!=header:
    raise SystemExit('mqtt_demo.h existente difere da configuração: preserve-o antes de gerar outra instalação.')
target.write_text(header)
bundle=root/'Wokwi/demo';bundle.mkdir(exist_ok=True)
(bundle/'sketch.ino').write_text('#define NIGHTCARE_DEMO 1\n'+(root/'Wokwi/sketch.ino').read_text())
for name in ['diagram.json','libraries.txt','mqtt_demo.h']:
    shutil.copyfile(root/'Wokwi'/name,bundle/name)
(bundle/'wokwi.toml').write_text("[wokwi]\nversion = 1\nfirmware = '../../.pio/build/esp32demo/firmware.bin'\nelf = '../../.pio/build/esp32demo/firmware.elf'\n")
print('Configuração demo pronta. Copie os quatro arquivos de Wokwi/demo/ para o Wokwi no navegador (sem wokwi.toml).')
PY
if [[ ${1:-} == --prepare-only ]]; then exit 0; fi
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml up --build -d --wait --wait-timeout 180
echo "Painel: http://localhost:${DEMO_HTTP_PORT:-3000} — inicie a simulação Wokwi para conectar o dispositivo."
