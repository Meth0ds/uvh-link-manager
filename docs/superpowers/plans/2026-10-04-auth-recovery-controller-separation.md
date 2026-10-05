# Gradual separation of recovery and incident HTTP controllers

Execute sequentially in the existing shared checkout. No agents, worktree, commit, push, deploy or production data. Begin only after O45 backend/JUnit terminates and its frozen hashes are verified.

## Objective

Continue the user-requested gradual separation of backend AuthController. Extract coherent recovery and incident HTTP surfaces, preserving complete admission transactions, route/middleware/security policy and browser-identity response contracts. This is one step toward separating registration/activation, credential login, MFA, profile/credentials and session/security-center surfaces; it does not close AuthController or S01–S13.

## Evidence before mutation

- Read the four full current HTTP methods: requestAccountRecovery, confirmAccountRecovery, completeAccountRecovery, revokeCompromisedAccess, including all request parsing, errors, CAPTCHA, live lookup, hash/approvals preflight, afterCommit cleanup and CredentialChangeResponse.
- Read complete helpers captchaError, validEmail, validPassword and findUserByEmail; inspect existing AccountQueries before selecting a shared lookup. Avoid copying validator policy into two controllers or adding a general-purpose service with unrelated responsibilities. A narrow shared authentication-input trait may preserve the three existing validator bodies exactly; query lookup belongs to the query owner or a preserved equivalent helper.
- Snapshot the four full method bodies and the actual route collection before extraction. Preserve URI, verbs, names, middleware order and route constraints; only controller action class may change. Do not use facade wrappers or inherited giant controllers as evidence of separation.
- Run meaningful public-input/CSRF/CAPTCHA/expired/replayed/foreign-session/dual-approval/failed-admission/outer-commit contracts before and after extraction. Existing RecoveryOpeningAdmission/AccountRecoveryAdmission/SecurityIncidentBoundary/SecurityIncidentAuditRecovery/SecurityIntentCommitEffects supply native HTTP and SQL contracts; add missing material branch coverage after examining them, not mirror tests.

## Implementation and verification

- [x] Create AccountRecoveryController owning all three recovery actions and SecurityIncidentController owning incident revocation. Retain function names and full method bodies except explicit shared-helper substitutions.
- [x] Update only the four route action classes, remove the corresponding methods/dependencies from AuthController, and preserve every remaining complete AuthController method and relevant helper after explicit support extraction.
- [x] Compare full bodies and route collection after allowed adaptations. No changes to admissions, DTOs, status/message/current/cookies, rate limits, recovery two-admin gate, incident protection receipts or afterCommit cache/artifact policy.
- [x] Dedicated native HTTP/SQL contracts, composer quality, full backend/JUnit; one guarded uvh_test suite at a time and no PHP/tests edits while running. Snapshot tested hashes and verify after completion.
- [x] Refresh inventory/ledgers/matrix with new owner paths, unique function anchors and preserved historical evidence. Update line-count/literal verifiers only after full-body proof, never weaken a gate to hide changes. Baseline152/141 remains unchanged unless actual findings are resolved with evidence; no new ignores.
- [x] Report concrete moved responsibilities and what remains. Frontend1373O43 is prior evidence unless TS changes; no new UI/provider/SMTP/cookie-native/production claim.

## Other open findings retained

Housekeeping primary Audit::write follows the destructive account-anonymization transaction: candidate for native audit-admission fault reproduction and repair. Protective compensation must retain durable evidence without making unavailable general audit undo protection; AccountDeletionAudit currently records only account.deletion_cancelled, so it is not automatically a substitute for reason-specific lifecycle events. Registry releaseCounters writes24h while issue uses configurable TTL: candidate unproven, no new BugID until reproduction. Remaining global source/roles/retention/capacity/CI/operation gates persist.


## O46 — separación gradual de recuperación e incidentes Auth (04/10)

AccountRecoveryController posee request/confirm/complete ySecurityIncidentController posee revocación por incidente. Son acciones HTTP propias, sin wrappers ni herencia del controlador gigante. ValidatesAuthInput comparte tres cuerpos exactos de validación/CAPTCHA; AuthAccountLookup conserva el lookup active/lower(email)/deleted_at con método static, sólo preflight sin autoridad. Ocho dependencias de admisión/response/cleanup/CAPTCHA/baseline conservan hashes. Ninguna TX/receipt/dualapproval/cookie/policy/DTO se mueve o modifica. No nuevo BugID por extracción.

**44 métodos completos comparados:**36quedan enAuth,4accionesHTTP+3helpers+1lookup cambian deowner; sólo sustituciónfindUserByEmail→AuthAccountLookup::activeByEmail en callers. Toda clase Auth restante incluida constante/hash/comments comparada tras adaptaciones explícitas. Toda fuente routes/api.php preservada tras imports+4actionclasses; **185 contratos de ruta runtime idénticos** enverbos/URI/nombres/domains/middleware-order/constraints/defaults/fallback, salvo las4clases. AuthController1399→1227líneas, AuthService648sin cambio; reducción no prueba cierre Auth/S01. Comparador `.uvh-runtime/verify-auth-recovery-controllers.py`.

36contratos nuevos de parsing/CSRF/CAPTCHA ylookup:5emailsmalformed,4verifieroutcomes,4CSRF,16bearersmalformed,6completionpayloads y1trim/case lookup. Pruebas HTTP/API/SQL realesguardados conHttpfake/Queuefake; **191/191 antes/después,1923aserciones,32,27s/32,68s;Pint489/PHPStan0**,exit0. Antesdeatribuirpositivos se normalizaron fixtures SQL mediante refresh yse sustituyó HttpFactory para retirar fake genérico; un transporte que arroja excepción se comprueba por callback-count yno por lista de respuestas grabadas. Esos ajustes no son fallos producto ni rojos de extracción. Full/JUnit2149 en curso, PHP/tests congelados; backend2113/17018O45/frontend1373O43 son gates previos.

Inventario479/2269named/1168anonymous/3signatures/0provisional;479hashes,354S01anchors/72files,16S03/2,63S10/9 y194S02/30 verificados. Anchors relocados conservan evidencia histórica; captchaError es un anchor nuevo completo, no una nueva función global ni gate de proveedor/timing.15hashes congelados para full; baseline152/141 sin cambios/ignores. Histórico O45Auth1399 se valida con snapshot cuyo hash es el del manifiesto congelado O45; comparador O46 valida el árbol actual ytodos los44cuerpos, sin debilitar el gate.

**Objetivo global/S01–S13 activo.** Falta terminar full/JUnit, yAuth aún reúne registro/activación/login/logout/MFA/perfil/password/email/sessions/security-center. SourcecandidatesprimaryhousekeepingAuditfueraTX yTTL24/configurable siguen sinrojo/ID; resto de funciones/roles/retención/capacidad/CI/operación real abiertos. No TS/DOM/QA/provider/SMTP/Redis/nativecookie nuevo; no uvh_local/cuentas/mail/workers/scheduler/migraciones externas/commit/push/deploy. Continuación previa O45 fue progreso probado:2fixes/30tests/full2113.


O46 final verificado (04/10): **2149/2149 backend,17449aserciones,395,866s/139MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s01-auth-recovery-controllers-full-backend.log`). JUnit2149/17449/errors0/failures0/skipped0,36PublicRecoveryHttpContractTest/431aserciones,393,309949sJUnit en `backend-laravel/storage/logs/s01-auth-recovery-controllers-junit.xml`; summary `.uvh-runtime/s01-auth-recovery-controllers-junit-summary.json`.191/1923dedicado antes32,27s/después32,68s;Pint489/PHPStan0 exit0.15hashes de fuente/test/baseline conservados y479sourcehashes/354S01/16S03/63S10/194S02anchors comprobados después. FullAuth restante/44methodbodies/185runtime-routes/8dependencies y2deletion+6export+4sessions+3TX anteriores preservados tras las adaptaciones declaradas.

AccountRecoveryController3actions ySecurityIncidentController1action son los propietarios reales; shared3validators yactive-email preflight evitan duplicación. AuthController1227líneas/AuthService648,baseline152/141 sin nuevoignore. Sin nuevoBugID/TS/DOM/QA/provider/SMTP/Redis/nativecookie/latency/capacity claim;frontend1373O43 previo. Suites DB secuenciales ysin PHP/tests editados durante full. Handles propios terminales;sharedpostgres/mailpit operativos, sin worker/scheduler/appserver. No uvh_local/users/mail/providers/productioncommands/migraciones externas/commit/push/deploy.

PlanO46 cerrado sólo como extracción local. **Objetivo global/S01–S13 activos; Auth no está totalmente separado.** NextStep vigente: `docs/superpowers/plans/2026-10-04-account-deletion-lifecycle-audit.md`, reproducir admisión primaria deanonimización ycompensaciones protectoras por comando nativo guardado;sourcecandidates sin ID hasta rojo. Después continuar extracción coherente registro/activación ypasswordrecovery. RestoAuth/MFA/profile/sessions,registryTTL/configurable,funciones/roles/retención/capacidad/CI/operación real permanecen pendientes. No redefinir cierre como suites verdes/extracción parcial.
