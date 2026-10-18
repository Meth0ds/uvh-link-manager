# Builds a self-contained certificate generator for the production boot
# contract. It is a separate image so the fixture never depends on the host
# having openssl, on Windows or in CI.
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

RUN apk add --no-cache openssl

COPY --chmod=755 docker/release-boot/certs/generate-certs.sh /usr/local/bin/generate-certs

# Motivo: este generador escribe la clave privada del
# ensayo con permisos 600 y la lee el contenedor de Nginx, que corre como uid
# 101. Bajar aquí de usuario obligaría a compartir uid y el ensayo dejaría de
# representar un reparto real de permisos. No forma parte del despliegue.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/generate-certs"]
