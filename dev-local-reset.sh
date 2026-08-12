#!/usr/bin/env bash
# Substituído por ./doqyn, na raiz do doqyn-alpha-document-intelligence.
#
# O ambiente de dev sobe os dois repos na ordem certa — o seed demo do alpha
# depende do manifest que este serviço gera, então rodar só este lado deixava o
# alpha pela metade.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOQYN="$SCRIPT_DIR/../doqyn-alpha-document-intelligence/doqyn"

echo "dev-local-reset.sh foi substituído por ./doqyn (na raiz do alpha)"
echo
echo "  cd ../doqyn-alpha-document-intelligence"
echo "  ./doqyn up      sobe os dois repos preservando os dados"
echo "  ./doqyn reset   apaga os bancos e semeia do zero"
echo
if [[ -x "$DOQYN" ]]; then
  exec "$DOQYN" --help
fi
echo "Não achei $DOQYN — confira se os dois repos são vizinhos no mesmo diretório."
exit 1
