#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host=${1:-}
if [[ ! "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || [[ "$host" == localhost || "$host" == mosquitto ]]; then
  echo 'Uso: bash scripts/setup.sh HOST_PUBLICO (DNS ou IPv4 público, sem protocolo/porta)' >&2; exit 1
fi
for command in openssl docker python3; do command -v "$command" >/dev/null || { echo "Instale $command" >&2; exit 1; }; done
if [[ -e .env || -e secrets || -e Wokwi/mqtt_secrets.h ]]; then
  echo 'Configuração já existe. Preserve CA, credenciais e dados; use outra cópia para uma implantação nova.' >&2; exit 1
fi
umask 077
mkdir -p secrets/ca secrets/mosquitto
openssl genrsa -out secrets/ca/ca.key 3072
openssl req -x509 -new -sha256 -days 3650 -key secrets/ca/ca.key -out secrets/mosquitto/ca.crt -subj '/CN=NightCare Private CA'
openssl genrsa -out secrets/mosquitto/server.key 2048
openssl req -new -key secrets/mosquitto/server.key -out secrets/ca/server.csr -subj "/CN=$host"
if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then san="IP:$host,DNS:mosquitto"; else san="DNS:$host,DNS:mosquitto"; fi
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" > secrets/ca/server.ext
openssl x509 -req -in secrets/ca/server.csr -CA secrets/mosquitto/ca.crt -CAkey secrets/ca/ca.key -CAcreateserial -out secrets/mosquitto/server.crt -days 365 -sha256 -extfile secrets/ca/server.ext
# Build hashes without passwords in command-line arguments or Docker logs.
python3 - "$host" <<'PYSETUP'
import pathlib,secrets,sys
root=pathlib.Path('.')
device,backend,health,api=[secrets.token_hex(32) for _ in range(4)]
(root/'secrets/mosquitto/passwords').write_text(f'nightcare-001:{device}\nnightcare-backend:{backend}\nnightcare-health:{health}\n')
(root/'secrets/mosquitto/health-password').write_text(health)
(root/'.env').write_text(f'MQTT_HOST={sys.argv[1]}\nMQTT_BACKEND_PASSWORD={backend}\nAPI_TOKEN={api}\n')
ca=(root/'secrets/mosquitto/ca.crt').read_text()
(root/'Wokwi/mqtt_secrets.h').write_text('#pragma once\n#define MQTT_HOST "'+sys.argv[1]+'"\n#define MQTT_USER "nightcare-001"\n#define MQTT_PASSWORD "'+device+'"\nstatic const char MQTT_CA[] = R"CA('+ca+')CA";\n')
PYSETUP
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/secrets/mosquitto:/work" eclipse-mosquitto:2.0.22 mosquitto_passwd -U /work/passwords
# Only server runtime material is readable by the unprivileged broker container.
chmod 755 secrets/mosquitto
chmod 644 secrets/mosquitto/{ca.crt,server.crt,server.key,passwords,health-password}
chmod 700 secrets
# Bind mounts resolve on host before broker starts; parent remains private on host.
echo 'Configuração criada. Execute docker compose up --build -d. Não publique .env, secrets/ nem mqtt_secrets.h.'
