# Gradual Auth separation: registration/activation and public password recovery

Execute sequentially only after O47 full backend/JUnit is terminal and frozen hashes are checked. This continues the user's requested Auth separation; it does not close Auth/S01 or the project. No agents/worktree/commit/push/deploy, live accounts/mail/providers, uvh_local migrations or productive commands. Guarded uvh_test only; one DB suite at a time and no PHP/test changes while a suite is live.

## Source evidence and intended owners

Current AuthController1227 lines still owns register, changeRegistrationEmail, verifyEmail, resendVerification, forgotPassword and resetPassword. All six complete action bodies, their private pending lookup/name/timing helpers, shared validation trait and current routes have been read. Registration stores only a proposal; activation decides identity, credentials and legal acceptance. AuthAccountLookup remains a preflight lookup, never authority. Mail admission, credential/session responses and service locks must remain in their current services.

- RegistrationController owns the four registration/activation/verification actions. Its private findPendingRegistrationByEmail can move intact: the only caller is resendVerification.
- PasswordRecoveryController owns forgotPassword and resetPassword. AccountRecoveryController continues to own the separate support-reviewed MFA recovery workflow.
- validName moves with its complete body into existing ValidatesAuthInput, shared by RegistrationController and AuthController.profile. Do not duplicate the Unicode/control-character/name bounds.
- The complete equalizePublicMailDuration method and its comments move to a narrow shared concern used by RegistrationController and PasswordRecoveryController. Auth no longer needs it. Keep the exact hrtime/usleep floor behavior and known DB variance limit; extraction is not a timing guarantee under real load.
- Keep AuthAccountLookup/RegistrationAdmission/RegistrationEmailCorrection/RegistrationAttemptContext/VerificationResend/PasswordRecovery/CredentialChangeResponse/Audit/cookie/mail/CAPTCHA admission bodies unchanged. No wrapper delegation back to AuthController and no inheritance from the giant controller.

## Work and evidence

- [x] Snapshot entire current Auth source, routes source, PHP method inventory and runtime185 route contracts; freeze critical service/source/baseline hashes. Check all method callers and direct class references before moving owners.
- [x] Read relevant registration, privacy/context/correction/deadline/concurrency, mail-delivery and password-recovery test contracts. Run their existing meaningful regressions before extraction. Add HTTP contract cases only for genuine coverage gaps, and run them before and after; do not call fixture mistakes product bugs.
- [x] Move all six HTTP bodies and the two private helpers intact; validName becomes the shared trait method. Preserve comments, constants needed elsewhere, input/error/status/JSON/cookies, CSRF/limiters and public reachability. Remove only imports no longer consumed.
- [x] Update exactly six action classes and required imports in routes/api.php. Compare all185 runtime contracts including verbs/URI/domain/name/constraints/defaults/middleware order/fallback; only the six class owners may differ.
- [x] Compare every original Auth method and the entire remaining class after explicit ownership/import adaptations. Preserve all existing methods in the shared input trait and add only the original validName. Compare the complete moved timing helper and its comments. No facade or duplicate helper remains in Auth.
- [x] Run dedicated regressions after extraction, Pint/PHPStan, full backend/JUnit; freeze sources throughout. Keep O47 and historical O45/O46 preservation gates chained to hash-verified snapshots instead of weakening their old proof to accommodate new owners.
- [x] Refresh inventory, relocated per-function anchors, route matrix, canonical planning and reports with current evidence and explicit limits. Record actual remaining Auth responsibilities; fewer lines do not prove completion or performance improvement.

## Remaining global requirements

Login/logout, MFA/login challenges/reauthentication/configuration, profile/email/password mutations, session/security-center readers/revocations still need coherent ownership after this block. Global S01–S13/function/roles/retention/capacity/CI/production evidence remains open. Registry counter lifetime versus configured handoff lifetime remains an unproven source candidate; do not assign a BugID without reproduction. Frontend1373O43 is prior evidence until frontend changes justify new gates. Do not mark the full goal complete from this extraction.

## Started after O47 gates

O47 full/JUnit2205/18889 and source hashes are terminal/verified. Current Auth1227/36 methods, shared input trait and routes source captured in .uvh-runtime/o48-before; eleven admission/mail/lookup/CAPTCHA/baseline dependency hashes frozen. Fresh native runtime185 route contracts match O46 completely. No Auth extraction applied yet; caller-reference checks and before/after dedicated characterization remain required.


## O48 implementation evidence; local gates complete

RegistrationController owns four HTTP actions plus the original private pending lookup (260lines); PasswordRecoveryController owns forgot/reset (84lines). Auth1227→899/27remaining methods. validName moves intact to ValidatesAuthInput (three previous methods unchanged); EqualizesPublicMailDuration preserves the entire original helper and comments, consumed by both new controllers. No forwarder/inheritance, policy/TX/mail/cookie/bearer/response change or new BugID. Namespace function search found no custom Controller hrtime/usleep/config overrides; global fallback retained. Seven unused imports removed, all remaining Auth source including constants/comments preserved.

All36complete method bodies/comments compared literally, entire remaining Auth and both complete concerns compared after only declared ownership/import adaptations,185fresh runtime route contracts preserve verbs/URI/domain/name/middleware order/constraints/defaults/fallback except6class owners.11admission/mail/lookup/CAPTCHA/baseline dependencies retain hashes. Current comparison .uvh-runtime/verify-auth-registration-password-controllers.py; O45/O46/O47 use hash-verified historical snapshots and current O48 proof rather than weakening assertions. AuthService648 and2deletion+6export+4sessions+3sessionTX intact.

Meaningful existing regressions cover registration proposal/activation/legal/mailbox authority, free/occupied/legacy/reserved destinations, anti-enumeration/browser context/CSRF/CAPTCHA, cooldown/deadline/replay, mail/audit/SQL faults, reset live identity/bearer/current-cookie rules, working verification link in ArrayTransport and real multi-process correction/activation overlap on guarded PostgreSQL. **301/301 before and after,2852assertions,93.37s/95.46s**. No uncovered material contract identified for the extraction, so no mirrored tests or fake product-red added. Source preservation plus existing regressions is the evidence; not a new external-provider/load/latency claim.

Pint496/PHPStan0,exit0; baseline151/140 unchanged. Inventory483files/2273named/1171anonymous/3signatures/0provisional,483hashes;356S01anchors/75files,16S03/2,63S10/9,198S02/31 rebased. Seven existing anchors relocated with their historical evidence; two complete helpers newly anchored. Enumeration is not complete review. **Full2205/18889/398.526s/137MB,exit0**,guarded uvh_test;JUnit2205/18889/errors0/failures0/skipped0 (396.160934s).213source/dependency/all PHP test+support/config hashes frozen andchecked after terminal; no PHP/test edits during full. No new test cases added for extraction. O47 full2205/18889 andfrontend1373O43 remain prior gates until current completion.

All real-account/provider/uvh_local/productive process/migration/commit/push/deploy restrictions remain. Broad global goal/S01–S13 is active; next coherent block is authenticated account profile/credentials/sessions, followed by MFA. Auth login/logout remain a legitimate cohesive owner; Auth separation is not complete yet.


## Local closure and next block

All current source/body/route/inventory/ledger/transport/session-TX/hash gates checked after full. Auth899 andAuthService648 remain partially separated; global goal/S01–S13/functions/roles/retention/capacity/CI/production evidence stays active. Current tests do not certify SMTP/real providers/production latency/native browser cookies or the whole application as bug-free. All own handles terminal; shared postgres/mailpit healthy. No commit/push/deploy/uvh_local/users/mail/providers/productive process/migration actions. Next: docs/superpowers/plans/2026-10-04-auth-account-controller-separation.md, then remaining MFA owners.
