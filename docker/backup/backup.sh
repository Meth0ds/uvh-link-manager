#!/bin/sh
# Encrypted PostgreSQL backup with a verified ciphertext, a manifest and
# count-based retention.
#
# Contract:
#   * a backup is only reported as successful when the ciphertext has been
#     decrypted again and matches the plaintext digest;
#   * every failure writes an alert record and, when ALERT_HOOK_URL is set,
#     posts it, then exits non-zero;
#   * retention never deletes the newest backup;
#   * the encryption key is never generated here. Run ensure-key.sh first;
#     a missing key is a hard failure, not a new key.
#
# Environment: PGHOST PGUSER PGPASSWORD PGDATABASE, BACKUP_DIR,
# BACKUP_KEY_FILE, BACKUP_RETENTION, BACKUP_TAG, ALERT_HOOK_URL.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_KEY_FILE=${BACKUP_KEY_FILE:-/run/secrets/backup_key}
BACKUP_RETENTION=${BACKUP_RETENTION:-7}
BACKUP_TAG=${BACKUP_TAG:-manual}
ALERT_HOOK_URL=${ALERT_HOOK_URL:-}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE_RAW="uvh-${STAMP}-${BACKUP_TAG}"
PLAIN="/tmp/${BASE_RAW}.dump"
ENC="${BACKUP_DIR}/${BASE_RAW}.dump.enc"
MANIFEST="${BACKUP_DIR}/${BASE_RAW}.manifest.json"
ALERTED=0

alert() {
  reason=$1
  [ "$ALERTED" -eq 1 ] && return 0
  ALERTED=1
  mkdir -p "$BACKUP_DIR"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BASE_RAW" "$reason" >> "$BACKUP_DIR/alerts.log"
  if [ -n "$ALERT_HOOK_URL" ]; then
    curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "{\"alert\":\"backup_failed\",\"backup\":\"${BASE_RAW}\",\"reason\":\"${reason}\"}" \
      "$ALERT_HOOK_URL" >/dev/null 2>&1 \
      || echo "alert hook unreachable; the local alert record was still written" >&2
  fi
}

finish() {
  code=$?
  rm -f "$PLAIN"
  if [ "$code" -ne 0 ]; then
    alert "exit_status_${code}"
    echo "BACKUP FAILED (${BASE_RAW}); see ${BACKUP_DIR}/alerts.log" >&2
  fi
  exit "$code"
}
trap finish EXIT

[ -s "$BACKUP_KEY_FILE" ] || { echo "backup key missing at $BACKUP_KEY_FILE; run ensure-key.sh" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

echo "dumping ${PGDATABASE}@${PGHOST}"
pg_dump --format=custom --no-owner --no-privileges --file="$PLAIN"

PLAIN_SHA=$(sha256sum "$PLAIN" | cut -d' ' -f1)
PLAIN_BYTES=$(wc -c < "$PLAIN" | tr -d ' ')

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$PLAIN" -out "$ENC" -pass "file:${BACKUP_KEY_FILE}"

# Fail closed: a backup that cannot be read back is not a backup.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC" -pass "file:${BACKUP_KEY_FILE}" | sha256sum | cut -d' ' -f1 > /tmp/verify.sha
DECRYPTED_SHA=$(cat /tmp/verify.sha)
rm -f /tmp/verify.sha
[ "$DECRYPTED_SHA" = "$PLAIN_SHA" ] || { echo "ciphertext does not decrypt back to the dump" >&2; exit 1; }

ENC_SHA=$(sha256sum "$ENC" | cut -d' ' -f1)
ENC_BYTES=$(wc -c < "$ENC" | tr -d ' ')
SERVER_VERSION=$(psql -Atqc 'show server_version' 2>/dev/null || echo unknown)
MIGRATION_BATCH=$(psql -Atqc 'select coalesce(max(batch), 0) from migrations' 2>/dev/null || echo 0)
MIGRATION_COUNT=$(psql -Atqc 'select count(*) from migrations' 2>/dev/null || echo 0)
TABLES=$(psql -Atqc "select count(*) from pg_tables where schemaname='public'" 2>/dev/null || echo 0)

cat > "$MANIFEST" <<EOF
{
  "backup": "${BASE_RAW}",
  "tag": "${BACKUP_TAG}",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "${PGDATABASE}",
  "server_version": "${SERVER_VERSION}",
  "tables": ${TABLES},
  "migration_batch": ${MIGRATION_BATCH},
  "migration_count": ${MIGRATION_COUNT},
  "plaintext_bytes": ${PLAIN_BYTES},
  "plaintext_sha256": "${PLAIN_SHA}",
  "ciphertext_bytes": ${ENC_BYTES},
  "ciphertext_sha256": "${ENC_SHA}",
  "file": "$(basename "$ENC")",
  "retention": ${BACKUP_RETENTION}
}
EOF

# Retention by count. The newest backup is never a candidate: `tail -n +N`
# only ever starts at the second entry of the newest-first listing.
REMOVED=0
if [ "$BACKUP_RETENTION" -gt 0 ]; then
  OLD=$(ls -1t "$BACKUP_DIR"/*.dump.enc 2>/dev/null | tail -n +$((BACKUP_RETENTION + 1)) || true)
  for file in $OLD; do
    rm -f "$file" "$(echo "$file" | sed 's/\.dump\.enc$/.manifest.json/')"
    REMOVED=$((REMOVED + 1))
  done
fi

echo "backup ok: $(basename "$ENC") (${ENC_BYTES} bytes, ${TABLES} tables, migration batch ${MIGRATION_BATCH})"
echo "retention: kept ${BACKUP_RETENTION}, removed ${REMOVED}"
echo "$MANIFEST"
