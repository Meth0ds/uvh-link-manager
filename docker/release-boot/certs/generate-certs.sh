#!/bin/sh
# Generates the ephemeral trust material the production boot contract needs.
#
# Production refuses to start unless PostgreSQL is reached with
# sslmode=verify-full over a readable CA chain, so a stack without TLS can
# never exercise the real startup branch. This material is deliberately
# throwaway and is trusted only inside this isolated stack; it never protects
# anything and must never be reused outside it.
#
# The certificate is written where the deployment expects one and nowhere else:
# the CA alone goes to /ca, while the server key pair goes to /tls, so the
# application container can mount a CA without ever seeing a private key.
set -eu

ca_directory="${UVH_CA_DIRECTORY:-/ca}"
tls_directory="${UVH_TLS_DIRECTORY:-/tls}"
server_hostname="${UVH_CERT_HOSTNAME:-postgres}"
# Must match the uid the database image runs as, or PostgreSQL refuses the key.
# postgres:16-alpine uses 70; the Debian-based images use 999.
owner_uid="${UVH_CERT_OWNER_UID:-70}"
owner_gid="${UVH_CERT_OWNER_GID:-70}"
# Short-lived on purpose: any copy that outlives the run is worthless anyway.
validity_days="${UVH_CERT_VALIDITY_DAYS:-2}"

mkdir -p "$ca_directory" "$tls_directory"

# Reuse existing material instead of replacing it. PostgreSQL loads its key pair
# once at startup, so a freshly regenerated CA that the running database has
# never seen turns every later connection into an opaque
# "certificate verify failed". The runner starts from a wiped stack, so reuse
# only ever happens within one run.
reusable=1
for required in "$ca_directory/ca.crt" "$tls_directory/server.crt" "$tls_directory/server.key"; do
    [ -s "$required" ] || reusable=0
done
# Material that outlives its validity is worse than no material: refresh it.
if [ "$reusable" -eq 1 ] && ! openssl x509 -checkend 3600 -noout -in "$tls_directory/server.crt" >/dev/null 2>&1; then
    reusable=0
fi
if [ "$reusable" -eq 1 ]; then
    echo "Reusing ephemeral trust material already present"
    exit 0
fi

# Keys are private from creation; umask only makes the window smaller.
umask 077

openssl req -x509 -newkey rsa:2048 -sha256 -days "$validity_days" -nodes \
    -keyout "$tls_directory/ca.key" -out "$ca_directory/ca.crt" \
    -subj "/CN=uvh-release-boot-ephemeral-ca" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$tls_directory/server.key" -out "$tls_directory/server.csr" \
    -subj "/CN=${server_hostname}" 2>/dev/null

# verify-full matches the hostname the client actually dials, so the SAN has to
# carry the service name; the loopback aliases only help local debugging.
cat > "$tls_directory/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:${server_hostname},DNS:localhost,IP:127.0.0.1
EOF

openssl x509 -req -in "$tls_directory/server.csr" \
    -CA "$ca_directory/ca.crt" -CAkey "$tls_directory/ca.key" -CAcreateserial \
    -out "$tls_directory/server.crt" -days "$validity_days" -sha256 \
    -extfile "$tls_directory/server.ext" 2>/dev/null

rm -f "$tls_directory/server.csr" "$tls_directory/server.ext" \
    "$ca_directory/ca.srl"

chmod 644 "$ca_directory/ca.crt" "$tls_directory/server.crt"
chmod 600 "$tls_directory/server.key" "$tls_directory/ca.key"

# PostgreSQL rejects a server key that any other user can read, so the fixture
# must hand it over already owned by the database process.
if chown -R "${owner_uid}:${owner_gid}" "$ca_directory" "$tls_directory" 2>/dev/null; then
    chmod 755 "$ca_directory" "$tls_directory"
    chmod 644 "$ca_directory/ca.crt" "$tls_directory/server.crt"
    chmod 600 "$tls_directory/server.key" "$tls_directory/ca.key"
fi

echo "Generated ephemeral CA and PostgreSQL server certificate for ${server_hostname}"
