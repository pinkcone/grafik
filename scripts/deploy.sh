#!/usr/bin/env bash
# Uruchamiany na serwerze po pushu na main (przez GitHub Actions lub ręcznie).
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"

echo "==> Deploy grafik w $APP_DIR"
echo "==> Git pull"
git fetch origin main
git reset --hard origin/main

echo "==> Backup bazy danych (przed zmianami w aplikacji)"
bash scripts/backup-db.sh

echo "==> Backend: npm ci"
cd back
npm ci --omit=dev
cd ..

echo "==> Frontend: npm ci + build"
cd front
npm ci
npm run build
cd ..

echo "==> PM2: twardy restart API (usuń stare procesy + zwolnij port 5000)"
# Usuń wszystkie procesy pm2 (także stare/inne nazwy trzymające :5000)
pm2 delete all >/dev/null 2>&1 || true

# Dobij każdy proces nadal nasłuchujący na :5000 (np. ręcznie odpalony `node server.js`)
if command -v fuser >/dev/null 2>&1; then
  fuser -k 5000/tcp >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:5000 | xargs -r kill -9 >/dev/null 2>&1 || true
fi
sleep 1

pm2 start ecosystem.config.cjs --env production
pm2 save

echo "==> Weryfikacja: nowy backend musi znać trasę /api/employees"
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/employees || echo 000)"
echo "GET /api/employees -> HTTP $CODE (oczekiwane 401 = nowy kod działa; 404 = nadal stary)"
if [ "$CODE" = "404" ]; then
  echo "::error::Backend nadal serwuje STARY kod (trasa /api/employees zwraca 404)"
  pm2 logs grafik-api --lines 30 --nostream || true
  exit 1
fi

echo "==> Deploy zakończony pomyślnie ($(date -Iseconds))"
