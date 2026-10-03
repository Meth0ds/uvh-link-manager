# Authenticated Password Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Ejecución inline ya autorizada; no crear agentes, checkout, commits ni handoff adicionales.

**Goal:** Separar la transacción completa del cambio de contraseña autenticado preservando autoridad, rollback y contrato HTTP.

**Architecture:** AuthController conserva validación, hash costoso, limitación preflight y respuestas/catches. AuthenticatedPasswordChange posee una única transacción que bloquea cuenta→sesión y agrupa PasswordStrength vivo, MfaStepUp, credencial/generación, revocación, recuperación, aviso y auditoría exacta. La extracción precede cualquier cambio de comportamiento.

**Tech Stack:** Laravel/PHP, PostgreSQL, PHPUnit y Pint/PHPStan6 con baseline existente.

**Spec:** Texto pegado del usuario /Users/roberto/.codex/attachments/4c23f2eb-8123-4b91-99eb-bdaba70d74e1/Texto pegado.txt; SECURITY_MUTATION_CONTRACT.md; plan maestro2026-10-01-system-by-system-review.md.

## Global Constraints

- Conservar cambios existentes y alcance S01–S13 abierto; O18 es progreso verificado1631/11741.
- Una suite destructiva a la vez, sólo uvh_test con guard del TestCase; ninguna migración/DBlocal/proveedor real/worker/scheduler productivo.
- No editar PHP/tests mientras corre una suite; format antes de gates finales.
- No cambiar API, política de MFA/TTL/cookies, ni autoridad; no afirmar ahorro de SQL/latencia.
- Sin commits/push/deploy ni nuevos ignores de PHPStan; retirar sólo return type resuelto.

### Task 1: Caracterizar la transacción existente

**Files:** Create backend-laravel/tests/Feature/AuthenticatedPasswordChangeAdmissionTest.php; read CredentialStepUpContractTest.php, PasswordNoticeAtomicityTest.php y SecurityNoticeAtomicityTest.php.

**Interfaces:** Consume POST /api/v1/auth/change-password con current/newPassword/factorCode. Produce regresiones de snapshot→lock y outer rollback/commit que ejecutan la API real.

- [x] Registrar cambios deterministas después de hidratar user/session y antes del lock, usando el UPDATE last_used_at existente; no llamarlos concurrencia multiproceso.

```php
DB::listen(static function (QueryExecuted $query) use (&$changed, $owner): void {
    if (! $changed && str_starts_with($query->sql, 'update "sessions"') && str_contains($query->sql, '"last_used_at"')) {
        $changed = true;
        DB::table('users')->where('id', $owner->id)->update(['security_version' => 2]);
    }
});
$this->postJson('/api/v1/auth/change-password', ['current' => 'tiovivo-cobrizo-astilla-42', 'newPassword' => 'brujula-limonero-zafiro-93', 'factorCode' => 'ABCD2345EFGH6789'])->assertStatus(409);
```

- [x] Cubrir cuenta blocked/version/password/name/email y sesión revoked/expired/equality/version/foreign/freshness; MFA/recovery cambiado no usa snapshot para autorizar. Rechazos conservan contraseña y recovery y no admiten aviso/evento de éxito.
- [x] Cubrir outer rollback/commit con recovery, notice/outbox/audit/bearer/case/sesiones; retry tras rollback produce una generación y aviso, queue sólo al commit. Comprobar hash fuera de locks y account antes de session en éxito password_only/recovery.
- [x] Ejecutar el filtro dedicado antes de modificar código; caracterización puede pasar ya, no inventar rojo ni atribuir bug.

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test --filter='AuthenticatedPasswordChangeAdmission|PasswordNoticeAtomicity|SecurityNoticeAtomicity|CredentialStepUpContract'
```

### Task 2: Extraer y verificar sin cambio de policy

**Files:** Create backend-laravel/app/Support/Auth/AuthenticatedPasswordChange.php; modify AuthController.php::changePassword y phpstan-baseline.neon; actualizar SECURITY_MUTATION_CONTRACT, inventario/ledgers y documentos de progreso.

**Interfaces:** Produce `AuthenticatedPasswordChange::admit(User $user, ?string $sessionId, string $current, string $newPasswordHash, string $newPassword, string $factorCode): string`; conserva resultados stale/weak/locked/reauth/password/factor/ok:<factor> y excepciones existentes.

- [x] Trasladar la TX exacta guardada en .uvh-runtime/password-change-before.php. Sustituir sólo el wrapper lockActiveSecurityContext por SecurityContext::lock y sus propiedades user/session; comparar mecánicamente cuerpo normalizado.

```php
$changed = AuthenticatedPasswordChange::admit($user, $sessionId, $current, $newPasswordHash, $newPassword, $factorCode);
// Dentro de la TX trasladada:
$context = SecurityContext::lock($user, $sessionId);
if ($context === null) {
    return 'stale';
}
$locked = $context->user;
$session = $context->session;
```

- [x] Añadir JsonResponse a changePassword, retirar su única supresión no-return-type resuelta; no tocar otros ignores.
- [x] Format; repetir mismo filtro, composer quality y después suite completa serializada uvh_test. Si falla, reparar con fuente estable entre ejecuciones; no dar por terminada por filtro parcial.

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm --no-deps app composer quality
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test
```

- [x] Regenerar inventario sin bootstrap DB, verificar todos los hashes/anchors, documentar cifras y límites reales. Frontend no cambia; siguientes email/MFA y S01–S13 conservan gates.


O19 verificación final (03/10): full1649/1649 backend,11925 aserciones,310,68s sólo uvh_test (`s01-password-change-full-backend.log`), exit0;18 controles nuevos.93/873 antes (19,32s) y después (22,95s), exit0. Comparación del cuerpo trasladado repetida tras format conserva orden/policy; AuthController1985→1937líneas. Pint458/PHPStan0 (`s01-password-change-quality.log`), exit0; baseline176 findings/165 entradas, sólo1 ignore resuelto retirado. Inventario459 archivos/2191 funciones con nombre/1138 callbacks/3 firmas;459 hashes y196 anchors S01/46 archivos más16 S03/2 archivos verificados después de full. Node--check/gitdiff--check correctos. No PHP/tests editados durante suites, ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Fuente de los tres flows email releída para siguiente fase; posible deadlock al intercambiar reservas sigue candidato sin B/prueba, se reproducirá con dos procesos antes de corregir. Auth/S01–S13 y gates globales continúan abiertos.
