> Historical attempt, superseded by the deployment implementation approved on 2026-10-10. The current candidate includes pending local changes, archive delivery over SSH and the explicitly approved temporary dev-only braces audit exception. Historical failure evidence below is retained.

# UVH — UpCloud deployment runbook

## Actual status — 2026-10-10

**NOT DEPLOYED. Production promotion is blocked.**

The approved GitHub source was downloaded into a separate clone at `.uvh-runtime/upcloud-ac760d0`. The exact detached commit is `ac760d0d16ad32fc7a61ef157488f0746adee0fe`. Tracked files remain unchanged; existing uncommitted work in the original checkout was not included or overwritten.

`npm ci` installed 586 packages from the lockfile. The next gate, `npm audit --audit-level=moderate`, failed with exit **1**, reporting **7 high-severity affected dependency entries**. These are two root advisories plus their dependency chains, not seven independent root vulnerabilities:

- `braces`: GHSA-vfj7-8cjw-p6xm, stack-exhaustion denial of service; affects the Karma/Chokidar test toolchain and its consumers.
- `source-map-js`: GHSA-68fv-2mgg-jv7q, event-loop denial of service; installed vulnerable range below 1.2.2.

The project's verifier stopped immediately, as designed. Lint, typecheck, Karma, build, backend tests, browser/runtime drills and image scans **did not run**. No image was published or deployed. It is unsafe to turn this into a pass by ignoring audit, applying blanket suppressions, or accepting `npm audit fix --force` downgrades (npm suggests incompatible Karma/Angular changes).

## Evidence

- [Approved plan](superpowers/plans/2026-10-10-upcloud-production-deployment.md)
- [Full frontend verification log](release-evidence/2026-10-10-upcloud/frontend.log)
- [Audit JSON](release-evidence/2026-10-10-upcloud/npm-audit.json)
- [Gate exit statuses](release-evidence/2026-10-10-upcloud/validation-status.tsv)
- [Final exit code](release-evidence/2026-10-10-upcloud/validation.exit)
- [Validation runner](release-evidence/2026-10-10-upcloud/run-validation.sh)
- [Isolated validation Compose](release-evidence/2026-10-10-upcloud/compose.validation.yml)

Runner syntax (`bash -n`) and Compose configuration (`docker compose config --quiet`) passed. The validation Compose has no published ports and uses only `uvh_test`. Its cleanup returned 0, and no containers remained under its unique project label. Other local stacks were left alone.

## SSH access prerequisite

The user's standard SSH agent had no identities loaded at execution start. No insecure passphrase/askpass script was recreated and no SSH configuration, host keys or remote state was modified.

Load the key locally using an interactive prompt, never put its passphrase in a command or chat:

```bash
ssh-add ~/.ssh/id_ed25519_server
```

The saved ED25519 **server host** fingerprint is:

```text
SHA256:oOWKioBP+Exp0euY/vA4O9S/P7+7LoA/MTOtbAs6mps
```

Contrast it in the UpCloud console using `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` before server administration. This is not the user's public-key fingerprint. Do not use automatic host-key acceptance to bypass this check.

After unlocking and contrasting, test with existing host trust:

```bash
ssh -o StrictHostKeyChecking=yes -o UpdateHostKeys=no \
  -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_server root@87.58.157.156
```

The VPS has NOT been hardened/configured in this execution. Keep its console recovery available and test a second administrator session before changing SSH/firewall policies.

## Required before public launch

1. Approve a repaired release candidate and rerun all release gates; preserve old failure evidence in a distinct run directory.
2. Safe SSH access and contrasted host fingerprint.
3. Resend sending credentials for a verified domain; distinct panel/public hCaptcha sitekeys and valid secrets delivered through protected files, not chat.
4. Complete real legal identity and operator email; public legal information must be intentionally approved.
5. Private image delivery/publication consent and minimum-scope credentials (or approved hashed archive transfer).
6. Cloudflare account/zone access and reviewed OVH DNS export/DNSSEC migration.
7. Confirm Object Storage account/cost and monitoring account/channel; no external service has been provisioned in this execution.
8. Tested TLS, real mail receipt, admin email verification/MFA, per-pool health, external backup restore and received alerts.

## DNS to create after zone review

The domain remains registered at OVH. Once the reviewed zone is created in Cloudflare Free, set the nameservers **actually assigned to this zone** in OVH. Do not use guessed nameserver values or remove existing records.

| Type | Name | Value | Cloudflare proxy | TTL |
|---|---|---|---|---|
| A | `@` | `87.58.157.156` | Enabled | Auto |
| A | `app` | `87.58.157.156` | Enabled | Auto |
| CNAME | `www` | `uvh.es` | Enabled | Auto |

No nameservers or records were changed. No AAAA/wildcard/`www.app` for the initial deployment. Caddy origin certificates must be valid before enabling Full (strict) and must continue renewing after origin restrictions. Preserve existing MX/TXT/CAA and review DNSSEC before cutover.

Proposed mail sender: `no-reply@notify.uvh.es`. Add the exact DKIM/SPF/return-path records shown by Resend and an approved DMARC policy, all unproxied. Values are not known yet and must not be invented.

Keep custom domains unavailable for initial launch. Do not expose `edge.uvh.es` as an unprotected direct origin alongside the Cloudflare-protected app.

## Intended operation after deployment (not installed yet)

- Code/manifests: `/opt/uvh/releases/<full-commit>/`.
- Private configuration/secrets/TLS: `/etc/uvh/`.
- Durable data: `/var/lib/uvh/`.
- Encrypted backup staging: `/var/backups/uvh/`, followed by upload to separate EU storage.
- PostgreSQL private with SCRAM and TLS `verify-full`; separate runtime/migrator/backup roles.
- Redis authenticated, private, persistent and noeviction.
- Cloudflare → Caddy → Nginx → PHP-FPM; each worker pool and scheduler supervised.
- Actual image digests, certificate identity, migration status, backup destination and alert receiver will be recorded only after verification. There are none to report yet.

## Recovery policy

Do not run `migrate:rollback` blindly. Before each release, obtain a verified external backup and classify migrations. Return to previous immutable images only if the schema remains compatible; otherwise restore a verified external copy after testing it in isolation and approving the recovery window. Never claim a measured RPO/RTO without an actual restore measurement. On initial-launch failure, stop exposure or pause registration without deleting durable volumes or recovery access.
