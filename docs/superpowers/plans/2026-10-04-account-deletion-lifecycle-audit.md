# Durable audit of native account-deletion lifecycle

Sequential shared-tree execution after O46 full/JUnit is terminal and tested hashes are verified. No agents/worktree/commit/push/deploy or uvh_local/users/mail/providers/production workers/schedulers. Guarded uvh_test only; one DB suite at a time and no PHP/tests edits during suites.

## Objective and current evidence

Inspect and repair any proven primary-audit admission gap in UvhHousekeeping::executeAccountDeletions. Pre-edit source applied SQL business transaction, then external cleanup afterCommit, then Audit::write outside businessTX. Successful execution, mail-unconfirmed protection and owned-workspace protection have distinct event names. The pre-edit active-account/blocked transition returned null after changing the request, without that final event. Native guarded reproduction confirms B183/P1 (required destructive audit admission outside the commit) and B184/P2 (automatic protective reasons are lost; active-account blocking has no event). Red: seven failures /143 assertions /2.34s; original source snapshots and logs are retained in .uvh-runtime/o47-before and s02-deletion-lifecycle-audit-red.log.

AccountDeletionAudit currently preserves only protective account.deletion_cancelled using cancellation_audit_pending and cancelled_at; reconcile selects cancelled only. Do not reuse it to erase distinct lifecycle reasons or gate protective compensation on a general audit outage. Required destructive execution should not commit without durable evidence; protective changes must commit with recoverable evidence when general audit fails.

## Source and regression work

- [x] Read complete execution/retention command stage contracts, Audit, AccountDeletionAudit, AccountDeletionRequest/schema/retention/readiness, AccountDeletionSecurity and native deletion lifecycle tests. Snapshot complete caller/admission bodies before edits. No coverage from truncated output.
- [x] Create native-command fixtures from HTTP-issued/claimed A/B handoffs, fake managed export files, due scheduled request and exact-generation SENT receipt. Document manual receipt/due-now fixture limitations. Queuefake/Httpfake/mailarray/Storagefake, no productive command/provider.
- [x] Inject exact-action PHP audit-admission failure and actual SQL admission failure, history materialization failure, receipt-clear failure and broken diagnostics where relevant. Exercise normal/outercommit/rollback/savepoint and exactly-once recovery by a later native pass. Verify state/version/session/bearer/export/cache/counters/outbox/history/receipt and truthful command/checkpoint status.
- [x] Preserve last-admin, owned-workspace, mail-confirmation, cancellation/grace, afterCommit cleanup and current identity contracts. Demonstrate destructive rollback and independently demonstrate protection persists with a recoverable reason-specific receipt; do not substitute generic event or count log/metrics as durable audit evidence.

## Implementation choices after reproduction

- [x] Required destructive Audit admission belongs inside its business TX; materialization remains after commit. External file/cache cleanup must remain after outer commit and must never run after failed admission.
- [x] For protective outcomes, reuse an existing receipt only if it preserves exact original action/reason and timestamp under lock. If no existing durable structure can represent them, implement the smallest explicit lifecycle receipt/schema change with guardrails and test-only migration. No uvh_local or external migrations. Keep generic cancellation semantics and old records compatible; no new baseline ignores.
- [x] Make pending evidence discoverable and bounded/retryable with user-before-request lock order; clear receipt only in the same savepoint as durable outbox admission. Keep event identity/attribution stable and avoid bearer/destination/PII metadata. Do not return healthy housekeeping if required evidence remains pending.
- [x] Dedicated native security/deletion/audit/cleanup gates, composer quality, full backend/JUnit; freeze sources/tests throughout. Refresh inventory/anchors/matrix/report/plans after exact body adaptations. Frontend1373O43 andbackend2149O46 are prior evidence until new gates, not blanket closure.

## Scope that remains active

AuthController is only partly separated: recovery/incident now have owners, but registration/activation/login/logout/MFA/profile/password/email/session/security-center remain. Continue coherent registration/activation and password-recovery extraction after security-critical shared admission work, preserving complete bodies/routes and validated shared input policy. Registry counterTTL24h versus configured handoff TTL remains an unproven candidate. Broad S01–S13/function/role/retention/capacity/CI/production gates remain open.

## Current gate status

Initial seven reproductions pass after the repair (231 assertions /2.45s). Expanded contracts before final bounded-backlog adjustment:170/2891 /30.42s; Pint493 and PHPStan0 after removing precisely one obsolete nullCoalesce.offset baseline entry (152/141→151/140), no new ignore. Auth1227/648 untouched.

A complete backend run was deliberately stopped (own one-shot container only, exit137, log s02-deletion-lifecycle-audit-full-backend-aborted-137.log) before any further PHP edits. It is not a successful gate. Self-review exposed a new bounded-pass heartbeat flaw in the implementation:101 receipts→100 consumed but command success; native red1/9 /1.23s (s02-deletion-lifecycle-audit-batch-red.log). Reconcile now fails visibly if receipts remain after its100 limit, so later passes recover the remainder without raising the bound. This is an implementation correction within O47, not a new historic BugID. Revised gates completed:171/2919dedicated/31.27s;Pint493/PHPStan0;full2205/18889/378.548s/137MB,exit0;JUnit2205/errors0/failures0/skipped0 (376.120217s). Final hashes15 preserved. The deliberately aborted first run remains historical and is never counted as a passing gate.

Migration2026_10_04_000001 applied only to uvh_test by a testing/*_test guarded wrapper; schema and ledger verified by tests. uvh_local/external databases remain unchanged. Required release column/ledger checks fail closed; down refuses pending receipts. Generation/physical request removal/user deletion keep immutable affected ID, action and original lifecycle timestamp with nullable actor attribution. General audit outages preserve protection plus receipt; failure to admit the receipt itself rolls back protection because there is no durable recovery evidence. History outage preserves outbox separately. Recovery never erases evidence before atomic outbox admission.


## Local phase closure and next step

O47/B183/P1 andB184/P2 corrected locally with authentic native red/green evidence. Tests:45lifecycle/1397assertions +8schema/22, three additional readiness contracts;56new cases versus O46. Source inventory480/2273named/1171anonymous/3signatures/0provisional and480hashes checked;198S02anchors/31files,354S01/72,16S03/2,63S10/9. Whole housekeeping/readiness preserved after explicit adaptations, unchanged business policy/cleanup dependencies/Auth1227/AuthService648 and old transport/three session TX comparers. Baseline151/140 after exactly one obsolete suppression removal; no new ignore. runPurges was read only in relevant identity/export sections; no whole-method review anchor or system closure attributed.

All own handles terminal, shared postgres/mailpit remain healthy. No real accounts/mail/providers/uvh_local/productive commands/migrations external/commit/push/deploy. Proceed with docs/superpowers/plans/2026-10-04-auth-registration-password-controller-separation.md. Global goal/S01–S13 remains active, including roles/functions/retention/capacity/CI/production evidence and remaining Auth responsibilities. No completion audit passed for the global project.
