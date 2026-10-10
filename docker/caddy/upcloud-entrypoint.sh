#!/bin/sh
set -eu

test -r /run/secrets/uvh_cloudflare_dns_token || { echo 'Missing Cloudflare DNS token file' >&2; exit 1; }
CLOUDFLARE_API_TOKEN=$(cat /run/secrets/uvh_cloudflare_dns_token)
test -n "$CLOUDFLARE_API_TOKEN" || { echo 'Empty Cloudflare DNS token file' >&2; exit 1; }
export CLOUDFLARE_API_TOKEN
test -n "${ACME_EMAIL:-}" || { echo 'Missing ACME email' >&2; exit 1; }
test -n "${UVH_CLOUDFLARE_CIDRS:-}" || { echo 'Missing trusted Cloudflare networks' >&2; exit 1; }
test -r /etc/uvh-origin/client-ca.pem || { echo 'Missing zone-specific origin-pull CA' >&2; exit 1; }
# This import is required even after launch. During acceptance it restricts
# visitors to the operator; after acceptance it becomes an explicitly empty
# file. Missing configuration must never silently open the service.
test -f /etc/uvh-origin/access.caddy || { echo 'Missing origin access policy' >&2; exit 1; }
case "${UVH_ACCESS_MODE:-operator}" in
    operator)
        case "${UVH_OPERATOR_CIDRS:-}" in
            ''|*0.0.0.0/0*|*::/0*|*\**)
                echo 'Acceptance requires concrete operator IPs' >&2; exit 1 ;;
        esac
        cmp -s /etc/caddy/access-operator.caddy /etc/uvh-origin/access.caddy \
            || { echo 'Acceptance requires the release operator access policy' >&2; exit 1; }
        for cidr in $UVH_OPERATOR_CIDRS; do
            case "$cidr" in
                */32|*/128) ;;
                */*) echo 'Operator access permits individual IPs only' >&2; exit 1 ;;
            esac
        done
        ;;
    open)
        test ! -s /etc/uvh-origin/access.caddy || { echo 'Open access requires an explicitly empty access policy' >&2; exit 1; }
        ;;
    *) echo 'Invalid UVH_ACCESS_MODE' >&2; exit 1 ;;
esac
exec "$@"
