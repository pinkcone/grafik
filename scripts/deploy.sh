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

echo "==> PM2: restart API"
if pm2 describe grafik-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
fi
pm2 save

echo "==> Deploy zakończony pomyślnie ($(date -Iseconds))"
