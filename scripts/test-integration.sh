#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
mkdir -p .validation
work=$(mktemp -d "$root/.validation/run-XXXXXX")
project="nightcare-test-$(basename "$work" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  docker compose -p "$project" -f "$work/compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  # Preserve generated files for diagnostics; all are inside ignored .validation/.
}
trap cleanup EXIT
python3 - "$root" "$work" <<'PY'
from pathlib import Path
import shutil,sys,json
root,work=map(Path,sys.argv[1:])
for name in ['scripts/setup.sh','mosquitto/mosquitto.conf','mosquitto/acl']:
 target=work/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,target)
(work/'Wokwi').mkdir()
s=(root/'compose.yml').read_text().replace('context: .','context: '+json.dumps(str(root)))
s=s.replace('    ports:\n      - "8883:8883"\n','').replace('    ports:\n      - "127.0.0.1:3000:3000"\n','')
(work/'compose.yml').write_text(s)
PY
bash "$work/scripts/setup.sh" mqtt.nightcare.test
bash scripts/test-backend.sh
docker compose -p "$project" -f "$work/compose.yml" up --build -d --wait --wait-timeout 120
docker run --rm --network "${project}_default" -v "$work:/run/validation:ro" nightcare-backend-test node /app/integration.mjs
docker compose -p "$project" -f "$work/compose.yml" restart mosquitto backend
docker compose -p "$project" -f "$work/compose.yml" up -d --wait --wait-timeout 120
docker run --rm --network "${project}_default" -v "$work:/run/validation:ro" nightcare-backend-test node /app/integration.mjs persistence
