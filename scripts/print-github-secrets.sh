#!/usr/bin/env bash
# Uruchom NA SERWERZE — podaje IP i klucz w base64 do sekretów GitHub (bez schowka).
set -euo pipefail

KEY="${HOME}/.ssh/grafik-deploy"

echo "========== SSH_HOST (wpisz jako sekret) =========="
curl -4 -s ifconfig.me || hostname -I | awk '{print $1}'
echo ""

if [ ! -f "$KEY" ]; then
  echo "Brak pliku $KEY" >&2
  exit 1
fi

if ! ssh-keygen -y -f "$KEY" > /dev/null 2>&1; then
  echo "Klucz $KEY jest niepoprawny" >&2
  exit 1
fi

echo "========== SSH_PRIVATE_KEY_B64 (wpisz jako sekret) =========="
B64="$(base64 -w 0 < "$KEY")"
echo "$B64"
echo ""
echo "Długość B64 (znaki): ${#B64}  — ta sama liczba musi być w logu Actions przy B64 length"
echo ""
echo "========== SSH_USER =========="
echo "root"
echo ""
echo "========== APP_DIR =========="
echo "/var/www/grafik"
echo ""
echo "Gotowe. Skopiuj wartości do GitHub → Settings → Secrets → Actions."
