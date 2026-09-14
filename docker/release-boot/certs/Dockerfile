# Builds a self-contained certificate generator for the production boot
# contract. It is a separate image so the fixture never depends on the host
# having openssl, on Windows or in CI.
FROM alpine:3.21

RUN apk add --no-cache openssl

COPY --chmod=755 docker/release-boot/certs/generate-certs.sh /usr/local/bin/generate-certs

ENTRYPOINT ["/usr/local/bin/generate-certs"]
