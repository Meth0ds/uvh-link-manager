# Tooling image for the backup and restore scripts.
#
# It is deliberately the official PostgreSQL client image rather than the
# application image: a restore must not depend on the release being restored,
# and pg_dump's major version must match the server being dumped. `curl` is
# added because the failure hook has to be able to reach an alert endpoint,
# and the alert must fire even when everything else about the host is broken.
# Fijada por digest: una restauración tiene que ejecutarse con el mismo cliente
# que se validó, no con el que publique la etiqueta el día del incidente.
#
# Es la variante Alpine y no la de Debian, y no por tamaño: la de Debian venía
# con el reparto de Perl cuatro versiones por detrás —tres CVE CRITICAL con
# parche publicado en `deb13u1`— y el cliente es el mismo PostgreSQL 16 en las
# dos. La puerta de bases ajenas escanea la base fijada, no lo que este
# Dockerfile arregle después, así que un `apt-get upgrade` aquí habría dejado la
# puerta en rojo sobre la base y habría exigido una excepción para un hallazgo
# que sí tiene arreglo. `openssl` no viene en la imagen de Alpine y el cifrado de
# `backup.sh` lo necesita; `sha256sum` y `base64` los pone busybox.
FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

RUN apk add --no-cache curl ca-certificates openssl
