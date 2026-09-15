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

# ---------------------------------------------------------------------------
# Edge limiter tuning.
#
# The template cannot express a default of its own: `envsubst` only replaces a
# variable name it was told about, and it is told about the names present in the
# environment. Supplying the defaults here — before `/docker-entrypoint.sh`
# renders the template — means the container starts with the documented values
# even when a deployment file sets none of them, and that a value set there wins
# instead of being overwritten by a compose default.
#
# The rates are ceilings well above the Laravel limits covering the same
# surface (EDGE_PUBLIC_RATE is 2x `RESOLVE_LIMIT` per minute);
# `EdgeLimitContractTest` asserts that relationship so a future edit cannot
# quietly make this layer the first to reject a legitimate client.
# ---------------------------------------------------------------------------
: "${EDGE_PUBLIC_RATE:=20r/s}"
: "${EDGE_APP_RATE:=20r/s}"
: "${EDGE_BURST:=100}"
: "${EDGE_CONN:=64}"
: "${EDGE_DRY_RUN:=off}"
export EDGE_PUBLIC_RATE EDGE_APP_RATE EDGE_BURST EDGE_CONN EDGE_DRY_RUN

# ---------------------------------------------------------------------------
# Restore the real client address before the edge limiter looks at it.
#
# The limiter keys its zones on $binary_remote_addr. Behind the TLS edge that
# address is the proxy container, so without this every client would share one
# bucket — a limiter that looks configured and limits nothing. `envsubst`
# cannot emit one `set_real_ip_from` per entry, so the directive list is
# generated here instead.
#
# TRUSTED_PROXIES is deliberately the same list Laravel already requires to
# trust the forwarding headers: one contract, two consumers, and the production
# gate already refuses a wildcard or a universal range. `real_ip_recursive` is
# what makes a spoofed client header useless — nginx walks the chain from the
# trusted end, so a forged leading address buys no allowance.
#
# An empty value is reported loudly but does not stop the container: the same
# deployment cannot boot Laravel without it (the production gate rejects it),
# so refusing here would only hide that error behind a proxy that never starts.
# ---------------------------------------------------------------------------
REALIP_CONF=/etc/nginx/conf.d/zz-uvh-realip.conf

write_realip_conf() {
    cidrs="${TRUSTED_PROXIES:-}"
    if [ -z "$cidrs" ]; then
        echo "TRUSTED_PROXIES is empty: the edge limiter would key every client on the proxy address. Set it to the edge's concrete IP/CIDR list." >&2
        printf '# TRUSTED_PROXIES was empty when this container started: no address is trusted.\n' > "$REALIP_CONF"
        return
    fi

    tmp="$REALIP_CONF.tmp"
    {
        printf '# Generated at start-up from TRUSTED_PROXIES. Do not edit.\n'
        printf 'real_ip_header X-Forwarded-For;\n'
        printf 'real_ip_recursive on;\n'
    } > "$tmp"

    old_ifs="$IFS"
    IFS=','
    for entry in $cidrs; do
        # Only a concrete address or CIDR. Anything else, including the
        # wildcards the application gate rejects, would silently widen the set
        # of peers allowed to set the client address.
        case "$entry" in
            ''|*[!0-9a-fA-F:./]*)
                echo "TRUSTED_PROXIES entry is not a concrete address or CIDR: ${entry}" >&2
                exit 1
                ;;
        esac
        case "$entry" in
            */0|0.0.0.0/0|::/0)
                echo "TRUSTED_PROXIES must not contain a universal range: ${entry}" >&2
                exit 1
                ;;
        esac
        printf 'set_real_ip_from %s;\n' "$entry" >> "$tmp"
    done
    IFS="$old_ifs"
    unset entry old_ifs

    mv "$tmp" "$REALIP_CONF"
}

write_realip_conf

exec /docker-entrypoint.sh "$@"
