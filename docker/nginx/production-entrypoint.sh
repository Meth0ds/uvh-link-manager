#!/bin/sh
set -eu

load_secret_file() {
    secret_name="$1"
    eval "secret_file=\${${secret_name}_FILE:-}"
    if [ -z "$secret_file" ]; then
        return
    fi
    if [ ! -r "$secret_file" ]; then
        echo "Secret file for ${secret_name} is not readable" >&2
        exit 1
    fi
    secret_value="$(cat "$secret_file")"
    if [ -z "$secret_value" ]; then
        echo "Secret file for ${secret_name} is empty" >&2
        exit 1
    fi
    export "${secret_name}=${secret_value}"
    unset secret_value
}

for secret_name in EDGE_ASK_SECRET METRICS_BEARER_TOKEN
do
    load_secret_file "$secret_name"
done
unset secret_name secret_file

exec /docker-entrypoint.sh "$@"
