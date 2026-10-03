# MFA Configuration Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task inline. Autorización vigente de continuar; sin delegación, nuevo worktree, commit ni handoff.

**Goal:** Separar gradualmente las cinco transacciones de configuración MFA conservando todos sus contratos, y añadir evidencia de autoridad viva/rollback antes del traslado.

**Architecture:** MfaConfigurationAdmission posee setup/enable/cancel/regenerate/disable y sus commits completos. AuthController conserva validación, generación aleatoria/cifrado fuera de locks, formato de credenciales y respuestas HTTP/catches. Reautenticación, lecturas y revocaciones permanecen para bloques propios.

**Tech Stack:** Laravel/PHP, PostgreSQL uvh_test, PHPUnit, Pint/PHPStan6.

**Spec:** SECURITY_MUTATION_CONTRACT.md;2026-10-01-system-by-system-review.md; separación gradual autorizada por el usuario. No inventar defectos donde una caracterización ya pase.

## Global Constraints

- O20/B139 verificado: full1672/12108, calidad463/PHPStan0. Objetivo S01–S13/gates reales abierto.
- Una suite DB destructiva a la vez, guard APP_ENV=testing y DB *_test previo, DB seleccionada uvh_test; no PHP/tests editados durante suites.
- No migraciones ni DBlocal/proveedor real/worker/scheduler productivo/commit/push/deploy.
- MFA pending vence en igualdad; presupuesto/freshness/TOTP replay externo y rollback SQL conservados. Administración no puede desactivar MFA. Cancel sin step-up es protección del factor pendiente, no autorización para reemplazar activo.
- Sólo retirar cinco ignores missingType.return resueltos por JsonResponse; ninguna supresión nueva.

### Task 1: Caracterización de autoridad y commits

**Files:** Create tests/Feature/MfaConfigurationAdmissionTest.php; read MfaConfigurationBoundaryTest/MfaStepUpBudgetTest/SecurityNoticeAtomicityTest/CredentialStepUpContractTest, bootstrap/app.php y helpers.

**Interfaces:** API real POST mfa/setup,enable,cancel-setup,recovery-codes/regenerate,disable. Fixtures enable y reconfigure comparten endpoint.

- [x] Guardar AuthController previo en .uvh-runtime/mfa-configuration-controller-before.php, leer las cinco funciones y helpers/imports completos.
- [x] Añadir30 interleavings tras UPDATE last_used_at de hydrate:6 acciones×blocked/revoked/exact expiry/session version/foreign owner. Cada uno exige409 y conserva SQL/factor/mail/notification/exact success audit. Ejemplo de hook:

```php
if (!$changed && str_starts_with($query->sql, 'update "sessions"') && str_contains($query->sql, '"last_used_at"')) {
    $changed = true;
    DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]);
}
```

- [x] Añadir12 controles6 acciones×outer commit/rollback: pending/active factor/codes/generación/current/otras sesiones/caso y mail/exact audit pertenecen al commit exterior. Rollback conserva originales y retry recovery/cancel/setup; enable/reconfigure conserva consumo TOTP fuera SQL y rechaza replay (sin reset manual ni espera de reloj).
- [x] Ejecutar antes del traslado:

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test --filter='MfaConfigurationAdmission|MfaConfigurationBoundary|MfaStepUpBudget|SecurityNoticeAtomicity|CredentialStepUpContract'
```

### Task 2: Traslado de las cinco TX completas

**Files:** Create app/Support/Auth/MfaConfigurationAdmission.php; modify AuthController.php y phpstan-baseline.neon.

**Interfaces:** static setup(User,?string,string password,?string code,string encryptedSecret):string; enable(User,?string,string code,array recoveryCodes):string; cancel(User,?string):bool; regenerate(User,?string,string password,string factorCode,array recoveryCodes):array; disable(User,?string,string password,string code):string. Regenerate shape {status:string,factor?:string}; recoveryCodes list<string>.

- [x] Copiar closures completas, incluyendo budget/replay/mail/exact audit/cancel recovery cases. Adaptar sólo SecurityContext::lock y propiedades readonly:

```php
$context = SecurityContext::lock($user, $sessionId, true);
if ($context === null) { return 'stale'; }
$locked = $context->user;
$session = $context->session;
```

Cancel adapta lockActiveSecurityActor a SecurityContext::lock(...)?->user; regenerate usa $context->user en guard. Ninguna fragmentación de commits.

- [x] Controller pasa argumentos originales y añade JsonResponse a cinco callers. Retirar sólo sus cinco entradas baseline resueltas. Comparar cuerpos normalizados contra snapshot, revirtiendo únicamente esas adaptaciones; verificar imports de todas las clases trasladadas.
- [x] Format fuente/tests, luego repetir exactamente filtro previo y composer quality. Sólo si hay un defecto confirmado por repro, abrir reparación separada con rojo/verde; excepción global MfaInfrastructureUnavailable503 ya existe, ausencia de catch local no es bug.

### Task 3: Gate completo y evidencia

- [x] Full backend serial uvh_test con fuente estable; registrar resultados reales y distinguir errores de fixture/traslado.
- [x] Regenerar source inventory sin bootstrap, rebasar/verificar hashes/anchors tras full; actualizar ledger/matriz/reportes/planes y Next Step. No medir éxito global por verde de este bloque.


Evidencia intermedia:42 controles nuevos sin fallos de fixture,146/1430 antes31,00s/después36,04s; cuerpos completos comparados después de format, única adaptación de contexto. AuthController1782→1604líneas. Pint465/PHPStan0 y baseline168/157; full en curso, no acreditado por filtros.


O21 verificación final (03/10): full1714/1714 backend,12722 aserciones,325,82s sólo uvh_test (`s01-mfa-configuration-full-backend.log`),exit0.42 caracterizaciones nuevas;146/1430 antes31,00s y después36,04s,exit0, sin fallos de fixture. Cinco TX completas comparadas después de format; sólo adaptación SecurityContext. AuthController1782→1604líneas. Pint465/PHPStan0 (`s01-mfa-configuration-quality.log`),exit0; baseline168/157, sólo5 ignores resueltos retirados, sin nuevos. Inventario462 archivos/2199 funciones con nombre/1138 callbacks/3 firmas;462 hashes y211 anchorsS01/48archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. No PHP/tests edits durante suites ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. No nuevo bug ni ganancia de latencia/SQL medida en O21. O20+B139 y O21 suman65 controles nuevos. Continúa reautenticación/perfil/reads/revocaciones y restoS01–S13/gates externos; objetivo activo.
