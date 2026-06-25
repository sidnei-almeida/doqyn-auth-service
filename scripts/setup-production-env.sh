#!/usr/bin/env bash
# Gera .env de produção de forma interativa e segura.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { echo -e "${GREEN}→${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

check_dependencies() {
  if ! command -v openssl >/dev/null 2>&1; then
    error "openssl não encontrado. Instale openssl antes de continuar."
    exit 1
  fi

  if ! command -v bash >/dev/null 2>&1; then
    error "bash não encontrado."
    exit 1
  fi

  if command -v docker >/dev/null 2>&1; then
    info "docker encontrado."
  else
    warn "docker não encontrado (opcional nesta etapa)."
  fi

  if docker compose version >/dev/null 2>&1; then
    info "docker compose encontrado."
  elif command -v docker-compose >/dev/null 2>&1; then
    info "docker-compose encontrado."
  else
    warn "docker compose não encontrado (opcional nesta etapa)."
  fi
}

prompt_default() {
  local prompt_text="$1"
  local default="$2"
  local value=""

  read -r -p "${prompt_text} [${default}]: " value
  if [[ -z "$value" ]]; then
    echo "$default"
  else
    echo "$value"
  fi
}

urlencode() {
  local raw="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.parse; print(urllib.parse.quote('''${raw}''', safe=''))"
  else
    # Senhas geradas em hex são URL-safe; para entrada manual, evite caracteres especiais.
    echo "$raw"
  fi
}

generate_hex_secret() {
  openssl rand -hex 32
}

generate_base64_32() {
  openssl rand -base64 32
}

if [[ -f "$ENV_FILE" ]]; then
  read -r -p "Já existe um .env. Deseja sobrescrever? [y/N] " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    info "Operação cancelada. .env existente preservado."
    exit 0
  fi
fi

check_dependencies

echo ""
info "Configuração do .env de produção — doqyn-auth-service"
echo ""

POSTGRES_DB="$(prompt_default "Nome do banco" "doqyn_auth")"
POSTGRES_USER="$(prompt_default "Usuário do banco" "doqyn_auth")"

echo -n "Senha do Postgres (deixe vazio para gerar automaticamente): "
read -r -s POSTGRES_PASSWORD
echo ""

if [[ -z "$POSTGRES_PASSWORD" ]]; then
  POSTGRES_PASSWORD="$(generate_hex_secret)"
  info "Senha do Postgres gerada automaticamente (não será exibida)."
else
  info "Senha do Postgres definida manualmente (não será exibida)."
fi

PORT="$(prompt_default "Porta da API" "4100")"
NODE_ENV="$(prompt_default "NODE_ENV" "production")"
SESSION_COOKIE_NAME="$(prompt_default "Nome do cookie de sessão" "doqyn_session")"
SESSION_TTL_DAYS="$(prompt_default "TTL da sessão em dias" "7")"
COOKIE_DOMAIN="$(prompt_default "Domínio do cookie (ex: .doqyn.com.br)" ".doqyn.com.br")"
COOKIE_SECURE="$(prompt_default "COOKIE_SECURE (true/false)" "true")"
COOKIE_SAME_SITE="$(prompt_default "COOKIE_SAME_SITE (lax/strict/none)" "lax")"
ALLOWED_ORIGINS="$(prompt_default "Origem permitida CORS" "https://app.doqyn.com.br")"
PASSWORD_RESET_TTL_MINUTES="$(prompt_default "PASSWORD_RESET_TTL_MINUTES" "30")"
EMAIL_VERIFICATION_TTL_HOURS="$(prompt_default "EMAIL_VERIFICATION_TTL_HOURS" "24")"

echo ""
info "Gerando secrets automaticamente..."

DOQYN_INTERNAL_API_KEY="$(generate_base64_32)"
DATA_ENCRYPTION_KEY="$(generate_base64_32)"
LOOKUP_HASH_SECRET="$(generate_base64_32)"
SESSION_TOKEN_HASH_SECRET="$(generate_base64_32)"
PASSWORD_RESET_TOKEN_HASH_SECRET="$(generate_base64_32)"
PASSWORD_PEPPER="$(generate_hex_secret)"

ENCODED_PASSWORD="$(urlencode "$POSTGRES_PASSWORD")"
DATABASE_URL="postgresql://${POSTGRES_USER}:${ENCODED_PASSWORD}@postgres-auth:5432/${POSTGRES_DB}"

cat > "$ENV_FILE" <<EOF
# Gerado por scripts/setup-production-env.sh — NÃO commitar este arquivo.

POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

PORT=${PORT}
NODE_ENV=${NODE_ENV}

DATABASE_URL=${DATABASE_URL}

SESSION_COOKIE_NAME=${SESSION_COOKIE_NAME}
SESSION_TTL_DAYS=${SESSION_TTL_DAYS}
COOKIE_DOMAIN=${COOKIE_DOMAIN}
COOKIE_SECURE=${COOKIE_SECURE}
COOKIE_SAME_SITE=${COOKIE_SAME_SITE}

ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

DOQYN_INTERNAL_API_KEY=${DOQYN_INTERNAL_API_KEY}
DATA_ENCRYPTION_KEY=${DATA_ENCRYPTION_KEY}
LOOKUP_HASH_SECRET=${LOOKUP_HASH_SECRET}
SESSION_TOKEN_HASH_SECRET=${SESSION_TOKEN_HASH_SECRET}
PASSWORD_RESET_TOKEN_HASH_SECRET=${PASSWORD_RESET_TOKEN_HASH_SECRET}
PASSWORD_PEPPER=${PASSWORD_PEPPER}

PASSWORD_RESET_TTL_MINUTES=${PASSWORD_RESET_TTL_MINUTES}
EMAIL_VERIFICATION_TTL_HOURS=${EMAIL_VERIFICATION_TTL_HOURS}
EOF

chmod 600 "$ENV_FILE"

echo ""
warn "ATENÇÃO: guarde DATA_ENCRYPTION_KEY em local seguro."
warn "Se perder esta chave, dados criptografados podem ficar irrecuperáveis."
echo ""
info "Arquivo criado: ${ENV_FILE} (chmod 600)"
info "Variáveis não sensíveis configuradas:"
echo "  POSTGRES_DB=${POSTGRES_DB}"
echo "  POSTGRES_USER=${POSTGRES_USER}"
echo "  PORT=${PORT}"
echo "  NODE_ENV=${NODE_ENV}"
echo "  COOKIE_DOMAIN=${COOKIE_DOMAIN}"
echo "  COOKIE_SECURE=${COOKIE_SECURE}"
echo "  ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
echo ""
info "Próximos passos:"
echo "  1. Faça backup seguro do .env (incluindo DATA_ENCRYPTION_KEY)"
echo "  2. Execute: ./scripts/deploy-production.sh"
echo "  3. Configure o Nginx para proxy /auth → localhost:${PORT}"
