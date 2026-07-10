#!/usr/bin/env bash
# Deploy de produção via Docker Compose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}→${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

COMPOSE_FILE="$PROJECT_ROOT/docker-compose.production.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    error "docker compose não encontrado."
    exit 1
  fi
}

cd "$PROJECT_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  error "Arquivo .env não encontrado."
  echo ""
  echo "Execute primeiro:"
  echo "  ./scripts/setup-production-env.sh"
  exit 1
fi

if [[ ! -r "$ENV_FILE" ]]; then
  error ".env existe mas não é legível."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

PORT="${PORT:-4100}"

info "Subindo PostgreSQL..."
compose up -d postgres-auth

info "Aplicando migrations..."
compose run --rm auth-migrate

info "Subindo auth-api..."
compose up -d --wait auth-api

info "Verificando health check..."
if curl -sf "http://localhost:${PORT}/health" >/dev/null; then
  info "Health check OK: http://localhost:${PORT}/health"
  curl -s "http://localhost:${PORT}/health"
  echo ""
else
  error "Health check falhou em http://localhost:${PORT}/health"
  warn "Verifique os logs: docker compose logs -f auth-api"
  exit 1
fi

echo ""
info "Status dos containers:"
compose ps

echo ""
info "Deploy concluído."
echo "  Logs API:      docker compose logs -f auth-api"
echo "  Logs Postgres: docker compose logs -f postgres-auth"
