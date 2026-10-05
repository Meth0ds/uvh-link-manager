# Privacy rights admission implementation plan — O32

> **For agentic workers:** ejecución secuencial en esta sesión con executing-plans; sin delegación, commits ni worktrees. Las preferencias vigentes del usuario prevalecen sobre recomendaciones de skills.

**Goal:** revalidar la autoridad de cuenta/sesión de las solicitudes de privacidad y admitir su evento exacto de auditoría en el mismo commit que el expediente y sus avisos.

**Architecture:** reutilizar `SecurityContext::lock` / `lockWithUsers` para commands y `AccountReadContext::resolve` para lectores. Mantener bloqueo usuarios por ID ascendente → sesión → expediente, payloads y políticas actuales. `Audit::write` dentro de cada TX admite el evento durable; materialización posterior recuperable sigue siendo `Audit::drain`.

**Tech Stack:** Laravel/PHP, PostgreSQL, PHPUnit, Docker local.

**Spec:** `docs/superpowers/plans/2026-10-01-system-by-system-review.md`, cobertura S02 y S01/S12 de dependencias; no certificación de sistemas completos.

## Global constraints
- Preservar el árbol compartido. No modificar cuentas/DB `uvh_local`, enviar correo real, ejecutar workers/scheduler productivos ni aplicar migraciones fuera de `uvh_test`.
- Suites PostgreSQL secuenciales; no editar PHP/tests mientras una suite esté ejecutándose.
- No nuevo endpoint, header obligatorio, retry de writes, nueva política MFA ni respuesta con información sensible.
- Lectura sin locks de mutación; commands con prueba fresca dentro de su TX. La sesión debe caducar estrictamente después de `now()`.
- La información libre sigue cifrada; avisos y audit sólo contienen metadata mínima.

### Task 1: autoridad privada y administrativa
**Files:** `backend-laravel/tests/Feature/PrivacyRightsAdmissionTest.php`, `backend-laravel/app/Http/Controllers/PrivacyRightsController.php`.
**Interfaces:** AccountReadContext.resolve(User, ?sessionId); SecurityContext.lock(User, ?sessionId, true); SecurityContext.lockWithUsers(User, ?sessionId, relatedUserIds, true); MfaFreshness.isFresh(session.mfa_verified_at).
- [x] Crear fixture HTTP aislada y reproducir revocación/caducidad exacta/versión/propietario/borrado/verificación después de hydration, en index/store/respond/cancel; controles de rol/MFA en adminIndex/adminAction.
```php
DB::listen(function (QueryExecuted $query) use (&$injected, $sessionId): void {
    if (!$injected && str_starts_with(strtolower($query->sql), 'select * from "users"') && !str_contains($query->sql, 'for update')) {
        $injected = true;
        DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]);
    }
});
$this->postJson('/api/v1/auth/privacy-requests', ['type' => 'access'])->assertStatus(409);
```
- [x] Ejecutar rojo con `docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test --filter=PrivacyRightsAdmissionTest` y registrar fallos/controles exactos.
- [x] Reutilizar contextos en las cinco rutas; adminIndex comprueba verified/admin/MFA fresh actual; adminAction usa contexto + usuarios relacionados manteniendo jerarquía y estados.
```php
$context = SecurityContext::lock($user, $sessionId, true);
if (!$context) { return ['status' => 'stale']; }
$locked = $context->user;
```
- [x] Reejecutar regresiones y controles de payload/cifrado/pertenencia/estado/límites, sin saltar casos fallidos.

### Task 2: commit exacto expediente/auditoría/avisos
**Files:** mismo controller/test; Audit y UvhMail existentes, sin nuevo transporte.
**Interfaces:** Audit.write(actorId, action, privacy_right, requestId, metadata, IP), ejecución en TX; Audit.drain para historial recuperable.
- [x] Reproducir fallo audit_outbox ausente e interrupción después de INSERT real, en store/respond/cancel/adminAction. Snapshot de expedientes/mensajes/notificaciones/mail/audit idéntico al anterior y Queue vacío tras rollback.
- [x] Mover los cuatro Audit.write dentro de sus TX, sin repetir el evento después del commit.
```php
Audit::write($locked->id, 'privacy.request_submitted', 'privacy_right', $id, ['type' => $type], $ip);
return ['status' => 'created', 'id' => $id];
```
- [x] Probar outer rollback/commit, fallo de mail después de insert y ausencia de audit_events: evento exacto recuperable y drain idempotente, sin copiar texto personal.

### Task 3: gates y evidencia
**Files:** inventario/ledgers/reportes y `.planning/2026-09-30-completion-audit-remediation/{task_plan,findings,progress}.md`.
- [x] Pint y PHPStan sin nuevos ignores; suites afectadas y full backend raw PHPUnit con JUnit en `/app/storage/logs/s02-privacy-rights-junit.xml`, únicamente `uvh_test`.
- [x] Regenerar inventario PHP sin bootstrap y rebasar/verificar hashes y anchors de ledgers; git diff --check.
- [x] Registrar IDs sólo para fallos reproducidos, resultados y límites; frontend sin cambios conserva evidencia previa, objetivo global sigue abierto. Siguiente revisión por código pendiente en plan maestro.

## Resultado local verificado

B160/P1, B161/P1 y B162/P2 reproducidos/corregidos. Rojo49/76; dedicado final266/1832/53,68s, full1930/14523/358,030s exclusivamenteuvh_test y JUnit1930/14523/0errors/0failures/0skips.110controles nuevos/753aserciones. Pint473/PHPStan0, baseline153/142;472hashes/339S01/16S03/63S10/61S02anchors, Node--check/diff correctos. Capturas de gates en `.uvh-runtime/s02-privacy-rights-*`; todos handles cerrados.

Un fallo intermedio era fixture legacyplaintext sin prefijo; corregido a ciphertextmalformado sin cambiar política global. Datos manuales por encima de20mensajes/caso y matrices negativas completas de payload/paginación, retención/operación real/provider/UI adicional permanecen pendientes; no se certifica lifecycle/sistema entero. Fuente frontend intacta, gates1074/O31 anteriores. Objetivo global activo.

## Next Step
Ejecutar `2026-10-04-auth-sessions-transport.md`: primero controles HTTP/facade antes de separar los cuatro transportes de sesiones. No nueva policy ni bugID por extracción mecánica.
