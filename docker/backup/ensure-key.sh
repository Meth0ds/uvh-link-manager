#!/bin/sh
# Explicit key custody for encrypted backups.
#
# This is a separate step on purpose. A key that is generated implicitly by
# the backup script would let a rotation mistake silently produce a backup
# nobody can decrypt, and the failure would only surface during a restore.
# `backup.sh` therefore refuses to run when the key is absent, while this
# script creates it once, in its own location, with restrictive permissions.
set -eu

KEY_DIR=${BACKUP_KEY_DIR:-/run/secrets}
KEY_FILE=${BACKUP_KEY_FILE:-$KEY_DIR/backup_key}

umask 077
mkdir -p "$KEY_DIR"

if [ -s "$KEY_FILE" ]; then
  echo "backup key already present at $KEY_FILE"
  exit 0
fi

head -c 48 /dev/urandom | base64 | tr -d '\n' > "$KEY_FILE"
chmod 600 "$KEY_FILE"
echo "generated a new backup key at $KEY_FILE"
