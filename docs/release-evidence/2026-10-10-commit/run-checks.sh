#!/usr/bin/env bash
set -euo pipefail
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
SNAP="$ROOT/.uvh-runtime/commit-push-20261010"
SOURCE="$SNAP/source"
OUT="$SNAP/evidence"
COMPOSE="$HERE/compose.validation.yml"
GROUP=${1:?Use frontend or backend}
run_step() {
  local name=$1 code=0
  shift
  "$@" > "$OUT/$name.log" 2>&1 || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$OUT/$GROUP-status.tsv"
  tail -n 15 "$OUT/$name.log"
  return "$code"
}
finish() {
  local code=$?
  trap - EXIT
  if [ "$GROUP" = backend ]; then
    local cleanup=0
    docker compose -f "$COMPOSE" down --volumes --remove-orphans > "$OUT/backend-cleanup.log" 2>&1 || cleanup=$?
    printf 'cleanup\t%s\n' "$cleanup" >> "$OUT/$GROUP-status.tsv"
    if [ "$code" -eq 0 ] && [ "$cleanup" -ne 0 ]; then code=$cleanup; fi
  fi
  printf '%s\n' "$code" > "$OUT/$GROUP.exit"
  exit "$code"
}
trap finish EXIT
[ ! -e "$OUT/$GROUP-status.tsv" ] || { echo 'Refusing to overwrite evidence'; exit 64; }
printf 'step\texit_code\n' > "$OUT/$GROUP-status.tsv"
if [ "$GROUP" = frontend ]; then
  cd "$SOURCE/frontend"
  run_step frontend-install npm ci
  # Report the full audit without interpreting functional-test success as release readiness.
  # This is a commit QA runner, not a replacement for the production release gate.
  audit_code=0
  npm audit --audit-level=moderate --json > "$OUT/frontend-audit.json" 2> "$OUT/frontend-audit.stderr.log" || audit_code=$?
  printf 'frontend-audit\t%s\n' "$audit_code" >> "$OUT/$GROUP-status.tsv"
  if [ "$audit_code" -gt 1 ]; then exit "$audit_code"; fi
  run_step frontend-lint npm run lint
  run_step frontend-typecheck npm run typecheck
  export CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  run_step frontend-tests npm test -- --watch=false --browsers=ChromeHeadless
  run_step frontend-build npm run build
elif [ "$GROUP" = backend ]; then
  cd "$SOURCE"
  dc() { docker compose -f "$COMPOSE" "$@"; }
  [ -e backend-laravel/.env ] || cp backend-laravel/.env.example backend-laravel/.env
  run_step backend-install dc run --rm php composer install --no-interaction --prefer-dist --no-progress
  run_step backend-validate dc run --rm php composer validate --strict --no-check-publish
  run_step backend-audit dc run --rm php composer audit --locked
  run_step backend-quality dc run --rm php composer quality
  run_step backend-schema dc run --rm php php artisan migrate:fresh --force --no-interaction
  run_step backend-tests dc run --rm php composer test
else
  echo 'Invalid check group'; exit 64
fi
