#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
prepare_only=false
dev=false
resume=false
prepare_args=()
while (($#)); do
  case "$1" in
    --prepare-only) prepare_only=true; shift ;;
    --dev) dev=true; shift ;;
    --resume) resume=true; shift ;;
    --devices) [[ $# -ge 2 ]] || { echo 'Informe os IDs após --devices.' >&2; exit 1; }; prepare_args+=(--devices "$2"); shift 2 ;;
    *) echo 'Uso: bash scripts/demo.sh [--dev] [--resume] [--prepare-only] [--devices nightcare-001,nightcare-002]' >&2; exit 1 ;;
  esac
done
command -v python3 >/dev/null || { echo 'Instale Python 3.' >&2; exit 1; }
if ! "$resume" && ! "$prepare_only"; then prepare_args+=(--new-session); fi
python3 scripts/prepare-demo.py "${prepare_args[@]}"
if "$prepare_only"; then exit 0; fi
docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml up --build -d --wait --wait-timeout 180
echo "Painel: http://localhost:${DEMO_HTTP_PORT:-3000} — inicie uma simulação por pacote/dispositivo."
echo 'Para continuar esta sessão sem zerar os cadastros: acrescente --resume.'
if "$dev"; then
  docker compose --env-file .env.demo -p nightcare-demo -f compose.demo.yml -f compose.frontend-dev.yml up --build --no-deps --renew-anon-volumes -d --wait --wait-timeout 180 frontend-dev
  echo "Interface com atualização automática: http://localhost:${DEV_HTTP_PORT:-5173} — edite frontend/ e salve."
fi
