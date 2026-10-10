# Candidate preflight, 10 October 2026

The pending project changes were published before any UVH images were transferred to the VPS. The host is prepared but UVH is not deployed. This preflight does not approve production promotion.

Frontend changes `a4ee25d` fix invitation initialization when initial identity adoption advances the session generation; `1d41f63` aligns browser fixtures with the current registration witness and UI contracts. The regression fails on the prior implementation (1 failure / 21 passing), then passes (22 / 22); the full frontend passes 2048 Karma tests, lint, typecheck and production build. The full audit report is retained locally; the shared policy permits only the approved development-only braces advisory until 2026-11-09. Working-tree Gitleaks uses the 12 previously reviewed exact fixture fingerprints and reports no new secrets.

The most recent browser run before the product fix passed 30 cases and reproduced the invitation race once. A full run after the fix remains required. Backend source is unchanged from the clean full validation of 2899 tests / 33643 assertions recorded in the preceding preparation evidence. Release, boot, queues, backup and final amd64 image gates remain required.

Caddy 2.11.7, x/net 0.60.0, Alpine 3.24 and a targeted zlib upgrade pass the native disposable mTLS/proxy/host drill. The full native Trivy report has zero LOW/MEDIUM/HIGH/CRITICAL findings and one UNKNOWN advisory, GO-2026-5932 (unmaintained x/crypto/openpgp); its applicability is still being investigated. Binary govulncheck JSON is retained in full and is not treated as a passed gate merely because the tool exits zero in JSON mode. No image-scan exception has been introduced. The final amd64 images have not been built or approved. Offline digest checks validate reference syntax only.

The image bundle tool was exercised with a real amd64 Alpine archive using Docker's containerd image store: export, manifest/archive verification and import succeeded; altered source SHA, manifest hash and archive bytes were rejected. This validates transport integrity, not image security or runtime promotion.

The Madrid host has Docker 29.9.0 / Compose v5.6.0, a tested independent administrator/sudo SSH session, 2 GiB swap, capped Docker logs, unattended security updates and a dual-stack firewall. After an actual Docker restart, firewall service/rules and a new administrator SSH session passed. Root retains key-only recovery access. Independent console fingerprint confirmation is still deferred; SSH continues strict known-host verification. No app containers, UVH images/data, external storage subscription or DNS changes were created here. Public Docker exposure still needs a live probe and zone mTLS acceptance.

Mail receipt and webmail are deferred by the user. Resend transactional delivery, hCaptcha, Cloudflare origin authentication, external encrypted backups, alerting and administrator email/MFA acceptance remain launch gates. No receiving address or legal identity is included in this public evidence.

[Check exit codes and local-log hashes](checks.tsv). Reports and logs stay in ignored `.uvh-runtime/`; they may contain disposable test data and are not published wholesale.
