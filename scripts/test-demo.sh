#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
mkdir -p .validation
work=$(mktemp -d "$root/.validation/demo-XXXXXX")
project="nightcare-test-$(basename "$work" | tr '[:upper:]' '[:lower:]')"
cleanup() { docker compose -p "$project" -f "$work/compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
python3 - "$root" "$work" <<'PY'
from pathlib import Path
import json,sys
root,work=map(Path,sys.argv[1:])
(work/'mosquitto.conf').write_text('listener 1883\nallow_anonymous true\n')
(work/'compose.yml').write_text(f'''services:
  broker:
    image: eclipse-mosquitto:2.0.22
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
  backend:
    build:
      context: {json.dumps(str(root))}
      dockerfile: backend/Dockerfile
    environment:
      DEMO_MODE: 'true'
      MQTT_URL: mqtt://broker:1883
      MQTT_PREFIX: nightcare/demo/test/nightcare-001/
      MQTT_CLIENT_ID: nightcare-test-backend
    volumes:
      - demo_data:/data
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1))"]
      interval: 2s
      timeout: 3s
      retries: 30
volumes:
  demo_data:
''')
PY
bash scripts/test-backend.sh
docker compose -p "$project" -f "$work/compose.yml" up --build -d --wait --wait-timeout 120
docker run --rm --network "${project}_default" -e MQTT_URL=mqtt://broker:1883 -e MQTT_PREFIX=nightcare/demo/test/nightcare-001/ nightcare-backend-test node /app/demo-integration.mjs

docker run --rm --network "${project}_default" -e MQTT_URL=mqtt://broker:1883 -e MQTT_PREFIX=nightcare/demo/test/ nightcare-backend-test node /app/multi-device-integration.mjs
