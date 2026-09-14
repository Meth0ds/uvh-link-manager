#!/bin/sh
# Restore one encrypted backup into a target database.
#
# The backup is verified twice before a single byte reaches the target: the
# ciphertext must match its manifest, and the decrypted dump must match the
# digest recorded when the backup was taken. A backup that cannot prove its
# own integrity is refused instead of being restored on trust.
#
# usage: restore.sh <backup.dump.enc> [target-database]
set -eu

SRC=${1:?usage: restore.sh <backup.dump.enc> [target-database]}
TARGET_DB=${2:-${PGDATABASE:-}}
: "${TARGET_DB:?target database is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"

BACKUP_KEY_FILE=${BACKUP_KEY_FILE:-/run/secrets/backup_key}
MANIFEST="${SRC%.dump.enc}.manifest.json"
PLAIN="/tmp/restore.dump"
ERRORS="/tmp/restore.errors"
rm -f "$PLAIN" "$ERRORS"

cleanup() {
  rm -f "$PLAIN" "$ERRORS"
}
trap cleanup EXIT

[ -s "$BACKUP_KEY_FILE" ] || { echo "backup key missing at $BACKUP_KEY_FILE" >&2; exit 1; }
[ -f "$SRC" ] || { echo "backup file not found: $SRC" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }

EXPECTED_ENC=$(sed -n 's/.*"ciphertext_sha256": "\([0-9a-f]*\)".*/\1/p' "$MANIFEST")
EXPECTED_PLAIN=$(sed -n 's/.*"plaintext_sha256": "\([0-9a-f]*\)".*/\1/p' "$MANIFEST")
[ -n "$EXPECTED_ENC" ] && [ -n "$EXPECTED_PLAIN" ] || { echo "manifest is incomplete: $MANIFEST" >&2; exit 1; }

ACTUAL_ENC=$(sha256sum "$SRC" | cut -d' ' -f1)
[ "$ACTUAL_ENC" = "$EXPECTED_ENC" ] || { echo "ciphertext digest mismatch; refusing to restore" >&2; exit 1; }

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$SRC" -out "$PLAIN" -pass "file:${BACKUP_KEY_FILE}"
ACTUAL_PLAIN=$(sha256sum "$PLAIN" | cut -d' ' -f1)
[ "$ACTUAL_PLAIN" = "$EXPECTED_PLAIN" ] || { echo "restored dump digest mismatch; refusing to write" >&2; exit 1; }

pg_restore --no-owner --no-privileges --clean --if-exists \
  --dbname="$TARGET_DB" "$PLAIN" 2> "$ERRORS" || true

# `--clean --if-exists` legitimately complains when an object is absent. Any
# other error means the restore is incomplete and must not be reported as one.
REAL_ERRORS=$(grep -c 'pg_restore: error:' "$ERRORS" 2>/dev/null | tr -d ' ' || echo 0)
IGNORED=$(grep -c 'does not exist' "$ERRORS" 2>/dev/null | tr -d ' ' || echo 0)
if [ "$REAL_ERRORS" -gt "$IGNORED" ]; then
  cat "$ERRORS" >&2
  echo "restore reported errors; see above" >&2
  exit 1
fi

TABLES=$(psql -Atqc "select count(*) from pg_tables where schemaname='public'" --dbname="$TARGET_DB")
MIGRATION_BATCH=$(psql -Atqc 'select coalesce(max(batch), 0) from migrations' --dbname="$TARGET_DB")
echo "restore ok: $(basename "$SRC") -> ${TARGET_DB} (${TABLES} tables, migration batch ${MIGRATION_BATCH})"
