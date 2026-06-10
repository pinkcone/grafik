#!/usr/bin/env bash
# Uruchom na serwerze — sprawdza parę kluczy deploy.
set -euo pipefail

KEY="${HOME}/.ssh/grafik-deploy"
PUB="${KEY}.pub"

echo "=== Fingerprint klucza na serwerze (wpisz w GitHub Actions log i porównaj) ==="
ssh-keygen -lf "$PUB"

echo ""
echo "=== Czy publiczny jest w authorized_keys? ==="
grep -F "$(cat "$PUB")" "${HOME}/.ssh/authorized_keys" && echo "OK: jest w authorized_keys" || echo "BRAK w authorized_keys!"

echo ""
echo "=== Uprawnienia ==="
ls -la "${HOME}/.ssh" "${KEY}" "${PUB}" "${HOME}/.ssh/authorized_keys"

echo ""
echo "=== B64 do GitHub (zapisz do pliku, nie kopiuj z terminala) ==="
base64 -w 0 < "$KEY" > /tmp/key.b64
echo "Plik: /tmp/key.b64"
echo "Znaki: $(wc -c < /tmp/key.b64)"
echo "MD5: $(md5sum /tmp/key.b64)"
