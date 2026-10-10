#!/usr/bin/env bash
set -euo pipefail
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
SOURCE="$ROOT/.uvh-runtime/upcloud-ac760d0"
EXPECTED=ac760d0d16ad32fc7a61ef157488f0746adee0fe
COMPOSE="$HERE/compose.validation.yml"
[ "$(git -C "$SOURCE" rev-parse HEAD)" = "$EXPECTED" ] || { echo 'Wrong release commit'; exit 64; }
[ -z "$(git -C "$SOURCE" status --porcelain --untracked-files=no)" ] || { echo 'Tracked release source has changed'; exit 64; }
STATUS="$HERE/validation-status.tsv"
[ ! -e "$STATUS" ] || { echo 'Existing evidence: do not overwrite; use a separate run directory'; exit 64; }
printf 'step\texit_code\n' > "$STATUS"
cleanup() {
  local code=$?
  trap - EXIT
  set +e
  docker compose -f "$COMPOSE" down --volumes --remove-orphans > "$HERE/validation-cleanup.log" 2>&1
  local cleanup_code=$?
  printf 'isolated-compose-cleanup\t%s\n' "$cleanup_code" >> "$STATUS"
  if [ "$code" -eq 0 ] && [ "$cleanup_code" -ne 0 ]; then code=$cleanup_code; fi
  printf '%s\n' "$code" > "$HERE/validation.exit"
  exit "$code"
}
trap cleanup EXIT
run_step() {
  local name=$1
  shift
  local code=0
  printf '\n=== %s ===\n' "$name"
  "$@" > "$HERE/$name.log" 2>&1 || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$STATUS"
  tail -n 25 "$HERE/$name.log"
  if [ "$code" -ne 0 ]; then
    printf '\nSTOPPED: %s (exit %s); no release promotion.\n' "$name" "$code"
    return "$code"
  fi
}
cd "$SOURCE"
run_step frontend node scripts/verify-local.mjs --only=frontend
run_step backend node scripts/verify-local.mjs --only=backend --compose-file="$COMPOSE" --env-file=/dev/null
printf '\nSource frontend/backend checks complete; runtime/image/provider gates remain separate.\n'
