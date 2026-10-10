> Historical attempt, superseded by the deployment implementation approved on 2026-10-10. The current candidate includes pending local changes, archive delivery over SSH and the explicitly approved temporary dev-only braces audit exception. Historical failure evidence below is retained.

# UpCloud Production Deployment — Implementation Plan

**Goal:** Deploy UVH Link Manager from GitHub to Debian VPS `87.58.157.156` using real production safeguards, tested artifacts, protected data, external backups and real-domain acceptance tests.

**Approved source:** `https://github.com/Meth0ds/uvh-link-manager`, detached commit `ac760d0d16ad32fc7a61ef157488f0746adee0fe`. Do not include or modify existing uncommitted local changes. If the candidate fails a release gate, stop promotion and obtain approval of a repaired candidate.

**Architecture:** Cloudflare Free → Caddy → Nginx → Laravel 13/PHP-FPM 8.4; Angular 22 SPA. PostgreSQL 16 and Redis run privately on the VPS. Independent workers and scheduler. Single-node deployment, not high availability.

**Decisions:** new empty database; `uvh.es` public landing/links, `app.uvh.es` panel/API; OVH remains registrar, Cloudflare authoritative DNS; configure real Resend and hCaptcha credentials; external encrypted backups in UpCloud EU Object Storage, proposed Frankfurt, approx. €5/month subject to account/cost confirmation.

## Global constraints

- Never expose PostgreSQL, Redis, PHP-FPM, internal metrics, secrets or development tooling publicly.
- Keep `APP_ENV=production`, `APP_DEBUG=false`, PostgreSQL `verify-full`, captcha verification, real mail transport, precise proxy trust and legal identity gates.
- Never put passwords/passphrases/API tokens in command arguments, logs, committed files, images or chat. Do not reuse earlier askpass scripts that embedded the SSH passphrase.
- Build and validate immutable linux/amd64 artifacts away from production. Production never builds on a mutable branch.
- Tests that reset databases run only in isolated Compose projects/databases ending `_test`. Do not use `migrate:fresh` or demo seeders on production.
- Approval does not waive the consent checkpoints below. No push/commit/PR or public package release without explicit authorization.
- Read-only tool refusals must be respected; do not use alternate tools to retrieve refused file content.

## Current phase

Phase 1: **blocked at the release audit gate**. Approved source downloaded; `npm ci` passed, `npm audit --audit-level=moderate` failed (exit 1; 7 high-severity affected dependency entries). Nothing changed on the VPS in this execution.

## Next step

Obtain approval to repair the dependency findings in a separate release candidate, then rerun the release gates in a new evidence directory. Do not deploy the rejected SHA or overwrite failure evidence.

## Task 1 — Source and evidence

- [x] Download a separate clone from GitHub.
- [x] Confirm detached HEAD matches the full approved SHA and the initial checkout is clean.
- [x] Preserve the approved decisions/checkpoints in this document.
- [ ] Execute audits, lint, typecheck, unit/integration tests and build for the approved candidate.
- [ ] Execute browser, release-smoke, production-boot, async and backup drills in isolated projects.
- [ ] Build API/web/backup tooling for linux/amd64, scan artifacts, generate SBOM and record digests.
- [ ] Deliver through private GHCR with explicit publication consent and pull-only server credentials; if blocked, offer an approved hashed archive transfer rather than silently changing the delivery method.

**Acceptance:** fresh evidence from this exact candidate and architecture, with no ignored failing gates. Historical results are not current evidence.

## Task 2 — VPS and access

- [ ] Contrast SSH host fingerprint with UpCloud console; unlock local key through secure user interaction.
- [ ] Inventory services, listeners, IPv4/IPv6 firewall, disks and recovery route.
- [ ] Create nominal administrator, verify login/elevation in a second session before disabling root/password SSH.
- [ ] Install reviewed Docker/Compose packages, security updates and log limits.
- [ ] Enforce host and Docker forwarding firewall in both address families, preserving console recovery and authorized SSH. Disable unneeded LLMNR.

## Task 3 — Data and private services

- [ ] Add production PostgreSQL 16 persistent private service: SCRAM, TLS private CA, SAN matching internal hostname, TCP plaintext rejected.
- [ ] Separate migrator/owner, runtime and backup roles with necessary limited GRANTs, including tables/sequences and future migrations.
- [ ] Prove incorrect CA/hostname fail and runtime lacks superuser/createdb/createrole.
- [ ] Authenticated Redis, no published ports, AOF everysec, noeviction and memory cap; preserve security limiter on database and queue timeout invariants.
- [ ] Generate independent random runtime secrets outside source/images; test mounted file permissions with actual service UIDs.
- [ ] Restrict filesystem/capabilities and resource/log usage to fit 4vCPU/8GB with OS reserve.

## Task 4 — External services and legal prerequisites

- [ ] Resend: verified `notify.uvh.es`, proposed `no-reply@notify.uvh.es`, minimum-scope sending key, tracking disabled for security mail; exact DNS values from dashboard.
- [ ] hCaptcha: distinct sitekeys bound to panel and public host with valid secrets; no development bypass.
- [ ] Real legal name, tax identifier, address, registry status/details, hosting provider/region and approved retention values.
- [ ] Operator email for TLS/alerts and administrator onboarding.
- [ ] Deliver secrets by protected files or secure credential mechanism, not chat. Obtain consent before creating external accounts.

## Task 5 — Cloudflare/DNS/TLS

- [ ] Inventory/export all OVH records including mail/TXT/CAA and DNSSEC DS before nameserver change; preserve unrelated records.
- [ ] Cloudflare Free zone; use its actual assigned nameservers in OVH after review.
- [ ] Proxied `A @ 87.58.157.156`, `A app 87.58.157.156`, `CNAME www uvh.es`, TTL Auto. No wildcard, no `www.app`, no AAAA until IPv6 works end to end.
- [ ] First-party Caddy config/certificates and canonical www redirect; check CAA/HSTS against existing subdomains; safe ACME bootstrap and renewal after origin restrictions.
- [ ] Full (strict), basic free WAF/DDoS, precise official proxy IP trust with controlled updates, prove forwarding spoof rejection.
- [ ] Prevent unauthorized origin bypass; a shared Cloudflare IP allowlist alone is not authentication of this zone. Test authenticated origin protection or equivalent before closing this gate.
- [ ] No shared caching of auth/API, session HTML or short-link redirects; only safe static caching.
- [ ] Mail DNS stays unproxied; preserve existing MX/SPF and add provider-specific DKIM/return-path/DMARC without invented values.

**Custom domains:** not offered at first launch. Reserve `edge.uvh.es` configuration hostname but do not expose an unprotected direct custom-domain edge on the protected origin IP. Reject unapproved Host/SNI. Later phase requires separate architecture and real DNS/ACME/tenant tests.

## Task 6 — Controlled deployment

- [ ] Clone/download the pinned source/manifests to `/opt/uvh/releases/<full-commit>/`; stable private config in `/etc/uvh/`, persistent data in `/var/lib/uvh/`.
- [ ] Bring up private dependencies and run approved migrations once with migrator credentials; no defaults/demo accounts.
- [ ] Start immutable artifacts with original PHP-FPM entrypoint, `uvh:release-check`, per-pool healthchecks and scheduler.
- [ ] Keep public registration paused during controlled operator registration, real email verification and MFA. Promote with `uvh:admin:promote` only once these prerequisites hold.

## Task 7 — Backups and monitoring

- [ ] Confirm Object Storage account/price/region and private versioned bucket with restricted credentials.
- [ ] Serialized encrypted PostgreSQL backups every 6h and pre-release, private Laravel storage and recovery metadata; separate recoverable encryption key and protected secret backup outside VPS.
- [ ] Retention proposal: 7 days of frequent backups and 30 daily copies, subject to legal/usage approval.
- [ ] Download and restore an external copy into an isolated target, verify contents/schema and measure RPO/RTO. Never claim recovery guarantees from a local copy alone.
- [ ] External Better Stack HTTPS/SSL and backup dead-man checks with account consent; actual operator receipt of failure/recovery alerts.
- [ ] Private metrics supervision for every worker pool, scheduler, resources and errors; no public monitoring port or untrusted Docker socket mount.
- [ ] Preserve public status `unknown` if no external feed satisfies the existing contract; do not substitute an incompatible monitoring API.

## Task 8 — Acceptance and handoff

- [ ] Real-domain browser checks: DNS/TLS, HTTPS redirect, landing/panel, CSP/Trusted Types, captcha wrapper, secure host-only cookies, CSRF.
- [ ] Real email signup/verification/login/MFA/recovery; create/edit link → resolve → analytics with no cache interference (including single-use links).
- [ ] Internal port denial, host isolation, spoofing/origin checks, controlled rate limits and persistence after service restart.
- [ ] External restore and received alerts; only then open public registration with operator approval.
- [ ] Deliver runbook, source SHA, image identities/SBOM, exact DNS/nameservers/mail records, commands, measured results and explicit outstanding limitations.

## Rollback

Take and verify an external pre-release backup, record manifest and classify migration compatibility. Revert to previous immutable images only for compatible/expansive migrations and recheck release/health. Incompatible migration recovery requires a verified restore and approved recovery window; no blind `migrate:rollback`. Initial-release failure: stop exposure/pause registration without deleting volumes/data or recovery access.

## Consent/checkpoint ledger

Pending: safe SSH unlock + contrasted host fingerprint; real service keys/legal identity; private image publication/delivery choice; reviewed DNS/nameserver change; storage and monitoring account/cost confirmation; operator email/MFA and public registration opening.

## Findings and errors

- GitHub Actions is billing-locked; zero-step failures are not passing tests.
- Local Docker is available (29.8.2); local Node v22.23.2. Server architecture was reported amd64 previously and must be reconfirmed on login.
- Isolated source: `.uvh-runtime/upcloud-ac760d0`, downloaded directly from GitHub; initial SHA and cleanliness checked successfully.
- Planning-with-files initialized a task-specific directory only inside that clone; no other task's planning state changed.
- File-reading tool returned `[BLOCKED]` for paths inside `.uvh-runtime`; contents were not recovered through another reader. Validation commands can run in the authorized checkout without exposing refused file contents. Relevant source scripts were inspected in matching unchanged tracked files in the shared checkout.
- Validation runner and isolated Compose syntax/config passed. `npm ci` installed 586 packages. Audit failed with `braces` GHSA-vfj7-8cjw-p6xm and `source-map-js` GHSA-68fv-2mgg-jv7q plus inherited affected toolchain entries (7 high total). Audit JSON and real exit 1 saved; no suppressions or dependency changes made. Later tests/builds not executed.
- Dedicated validation project cleanup returned 0; no containers remain for its label. Other running local stacks were untouched.
- SSH agent empty; no remote authentication/unlock attempted in this execution and no passphrase reprinted or embedded. Saved host ED25519 fingerprint for console comparison: `SHA256:oOWKioBP+Exp0euY/vA4O9S/P7+7LoA/MTOtbAs6mps`.
- Runbook and DNS/checkpoint handoff saved to `docs/upcloud-production-runbook.md`. No deployment configuration is claimed complete, no images published, no remote state/DNS changed.
