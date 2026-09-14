# Tooling image for the backup and restore scripts.
#
# It is deliberately the official PostgreSQL client image rather than the
# application image: a restore must not depend on the release being restored,
# and pg_dump's major version must match the server being dumped. `curl` is
# added because the failure hook has to be able to reach an alert endpoint,
# and the alert must fire even when everything else about the host is broken.
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
