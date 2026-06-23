#!/usr/bin/env bash
# Kopia zapasowa MySQL przed deployem — tylko odczyt (mysqldump), baza produkcyjna nietknięta.
# Zostawia jeden plik kopii: usuwa poprzedni backup po udanym zrzucie nowego.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/back/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/grafik}"
BACKUP_FILE="${BACKUP_FILE:-$BACKUP_DIR/pre-deploy.sql.gz}"

if [ ! -f "$ENV_FILE" ]; then
  echo "::error::Brak pliku $ENV_FILE — nie można wykonać backupu"
  exit 1
fi

# Wczytaj DB_* z .env (bez source całego pliku)
read_env() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  if [ -z "$line" ]; then
    echo ""
    return
  fi
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

DB_HOST="$(read_env DB_HOST)"
DB_NAME="$(read_env DB_NAME)"
DB_USER="$(read_env DB_USER)"
DB_PASSWORD="$(read_env DB_PASSWORD)"

DB_HOST="${DB_HOST:-localhost}"
DB_NAME="${DB_NAME:-graf}"
DB_USER="${DB_USER:-root}"

if [ -z "$DB_NAME" ]; then
  echo "::error::DB_NAME jest puste w $ENV_FILE"
  exit 1
fi

if ! command -v mysqldump >/dev/null 2>&1; then
  echo "::error::mysqldump nie jest zainstalowany (sudo apt install mysql-client)"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TMP_FILE="${BACKUP_FILE}.tmp.$$"
OLD_FILE="${BACKUP_FILE}.old"

echo "==> Backup bazy: $DB_NAME @ ${DB_HOST:-localhost}"
echo "    Cel: $BACKUP_FILE"

MYSQLDUMP_ARGS=(
  --single-transaction
  --routines
  --triggers
  --no-tablespaces
  -h "$DB_HOST"
  -u "$DB_USER"
)

if [ -n "$DB_PASSWORD" ]; then
  export MYSQL_PWD="$DB_PASSWORD"
fi

mysqldump "${MYSQLDUMP_ARGS[@]}" "$DB_NAME" | gzip -9 > "$TMP_FILE"
unset MYSQL_PWD

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE"
  echo "::error::Backup pusty lub nieudany"
  exit 1
fi

# Zamiana kopii: stary → usunięty dopiero po udanym nowym zrzucie
if [ -f "$BACKUP_FILE" ]; then
  mv -f "$BACKUP_FILE" "$OLD_FILE"
fi
mv -f "$TMP_FILE" "$BACKUP_FILE"
rm -f "$OLD_FILE"

BYTES="$(wc -c < "$BACKUP_FILE" | tr -d ' ')"
echo "==> Backup OK ($(numfmt --to=iec-i --suffix=B "$BYTES" 2>/dev/null || echo "${BYTES} B"))"
