#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f backend/Dockerfile --target test -t nightcare-backend-test .
