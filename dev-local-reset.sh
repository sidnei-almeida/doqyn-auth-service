#!/usr/bin/env bash
# Dev local do auth-service: sobe o Postgres (Docker), reseta o banco,
# aplica o seed demo e inicia o servidor — tudo em um comando.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STARTED_DB=false

cleanup() {
  if [[ "$STARTED_DB" == true ]]; then
    echo "→ Parando postgres-auth (subido por este script)..."
    docker compose stop postgres-auth || true
  fi
}
trap cleanup EXIT INT TERM

echo "→ Verificando postgres-auth..."
RUNNING="$(docker compose ps --status running -q postgres-auth 2>/dev/null || true)"
if [[ -z "$RUNNING" ]]; then
  echo "→ Subindo postgres-auth..."
  docker compose up -d --wait postgres-auth
  STARTED_DB=true
else
  echo "→ postgres-auth já está rodando."
fi

echo "→ Reset do Postgres (destrutivo, ambiente dev)..."
npm run dev:reset:postgres -- --confirm-reset-doqyn-dev

echo "→ Seed demo..."
npm run dev:seed:demo

echo "→ Subindo auth-service (porta 4100)..."
exec npm run dev:server
