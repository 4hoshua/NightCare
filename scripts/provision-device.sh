#!/usr/bin/env bash
# Add a TLS identity without replacing the CA or existing passwords.
set -euo pipefail
cd "$(dirname "$0")/.."
device_id=${1:-}
if [[ ! "$device_id" =~ ^[A-Za-z0-9_-]{1,32}$ || "$device_id" == nightcare-backend || "$device_id" == nightcare-health || ( ${2:-} != '' && ${2:-} != --no-reload ) || $# -gt 2 ]]; then
  echo 'Uso: bash scripts/provision-device.sh DEVICE_ID [--no-reload]' >&2; exit 1
fi
[[ -f .env && -f secrets/mosquitto/passwords && -f secrets/mosquitto/ca.crt ]] || { echo 'Prepare a modalidade TLS com scripts/setup.sh.' >&2; exit 1; }
umask 077
mkdir secrets/.provision-lock 2>/dev/null || { echo 'Outro provisionamento está em andamento.' >&2; exit 1; }
cleanup() { rm -f secrets/mosquitto/.device-staged secrets/.device-header; rmdir secrets/.provision-lock; }
trap cleanup EXIT
python3 - "$device_id" <<'PY'
import pathlib,re,secrets,sys
root=pathlib.Path('.')
device=sys.argv[1]
passwords=(root/'secrets/mosquitto/passwords').read_text()
if any(line.split(':',1)[0]==device for line in passwords.splitlines()):
    raise SystemExit('Dispositivo já provisionado; credenciais foram preservadas.')
target=root/'Wokwi/tls'/device/'mqtt_secrets.h'
if target.exists(): raise SystemExit('Header já existe; nada foi sobrescrito.')
env=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
host=env.get('MQTT_HOST','')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*',host): raise SystemExit('MQTT_HOST inválido em .env.')
password=secrets.token_hex(32)
(root/'secrets/mosquitto/.device-staged').write_text(f'{device}:{password}\n')
ca=(root/'secrets/mosquitto/ca.crt').read_text()
(root/'secrets/.device-header').write_text(f'#pragma once\n#define NIGHTCARE_DEVICE_ID "{device}"\n#define MQTT_HOST "{host}"\n#define MQTT_USER "{device}"\n#define MQTT_PASSWORD "{password}"\nstatic const char MQTT_CA[] = R"CA({ca})CA";\n')
PY
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/secrets/mosquitto:/work" eclipse-mosquitto:2.0.22 mosquitto_passwd -U /work/.device-staged
python3 - "$device_id" <<'PY'
import os,pathlib,sys
root=pathlib.Path('.')
target=root/'Wokwi/tls'/sys.argv[1]/'mqtt_secrets.h'
target.parent.mkdir(parents=True,exist_ok=True)
# Directory bind mount makes the atomic rename visible to Mosquitto on reload.
passwords=root/'secrets/mosquitto/passwords'
staged=root/'secrets/mosquitto/.device-staged'
staged.write_text(passwords.read_text()+staged.read_text())
staged.chmod(0o644)
os.replace(staged,passwords)
os.replace(root/'secrets/.device-header',target)
PY
if [[ ${2:-} != --no-reload ]]; then
  docker compose kill -s HUP mosquitto
fi
echo "Identidade criada em Wokwi/tls/$device_id/mqtt_secrets.h. Não publique este arquivo."
