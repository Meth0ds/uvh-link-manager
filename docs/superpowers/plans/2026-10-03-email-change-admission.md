# Email Change Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Ejecución inline autorizada; preservar checkout compartido, sin delegación/commits/handoff.

**Goal:** Separar las tres transacciones de email y corregir el deadlock de reservas cruzadas confirmado en PostgreSQL, conservando autoridad y rollback.

**Architecture:** EmailChangeAdmission concentra request/cancel/confirm con bloqueos y estado/mail/exact audit completos. AuthController conserva input/preflight/token/url/HTTP y mapea conflictos a los contratos existentes. Primero comparar el traslado y caracterizaciones; después introducir el rechazo de una reserva ajena vigente antes de borrar la propia.

**Tech Stack:** Laravel/PHP, PostgreSQL, PHPUnit/Symfony Process; Pint/PHPStan6.

**Spec:** Plan maestro2026-10-01-system-by-system-review.md, SECURITY_MUTATION_CONTRACT.md y separación gradual del texto pegado del usuario.

## Global Constraints

- O19 progreso verificado1649/11925. S01–S13/gates reales siguen abiertos.
- Suites destructivas sólo uvh_test y guard previo; una a la vez; ningún PHP/test editado durante ejecución.
- Sin nuevas migraciones, DBlocal, proveedor real, worker/scheduler productivo ni commit/push/deploy.
- Conservar status/cuerpo409 ante reserva ocupada, anterior reservation/recovery y rollback de freshness; no revelar ocupación antes de factor correcto.
- No nuevos ignores; retirar sólo tres missingType.return resueltos por JsonResponse.

### Task 1: Probar la frontera y caracterizar

**Files:** tests/Feature/EmailChangeConcurrencyTest.php, tests/Support/email-change-probe.php, tests/Feature/EmailChangeAdmissionTest.php; contratos existentes SecurityNoticeAtomicity/CredentialStepUpContract/EmailActionBoundary.

**Interfaces:** API real POST change-email/change-email/cancel/confirm-email-change; helpers subprocess sólo testing/uvh_test. Las dos barreras fuerzan step-ups completos y DELETE propios antes de liberar INSERTs.

- [x] Repro nativo: A reserva D/B reserva C, ambos solicitan destino opuesto; pg_blocking_pids recíprocos y40P01,409+500. Rojo definitivo1fallo/6assert (2,45s). Primer mock de timestamps elidía UPDATE; fixture10s anterior conserva freshness y demuestra autorización real.
- [x] Caracterizar expiry -1/0/+1, cancel con/sin pendiente, siete cambios tras lookup, conflictos User/Pending,6 outer rollback/commit/retry y factor inválido con/sin reserva. No llamar bug a fixtures que usaron ruta frontend como API o fechas aún sin refrescar de PostgreSQL.

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test --filter='EmailChangeAdmission|SecurityNoticeAtomicity|CredentialStepUpContract|EmailActionBoundary'
```

### Task 2: Trasladar TX completas sin cambiar comportamiento

**Files:** Create app/Support/Auth/EmailChangeAdmission.php; modify AuthController.php y phpstan-baseline.neon.

**Interfaces:** request(User,?string,string newEmail,string password,string factorCode,string tokenHash,string verificationUrl):array; cancel(User,?string,string password,string factorCode):string; confirm(EmailChangeRequest,string tokenHash):array. Shapes documentan status y campos opcionales actuales.

- [x] Copiar las tres closures de .uvh-runtime/email-change-controller-before.php y comparar cuerpos normalizados, adaptando sólo el contexto:

```php
$context = SecurityContext::lock($user, $sessionId, true);
if ($context === null) {
    return ['status' => 'stale'];
}
$locked = $context->user;
$session = $context->session;
```

- [x] Controller pasa argumentos existentes y conserva traducción de respuestas/catches; tres JsonResponse explícitos. Format y repetir mismo filtro. El repro nativo debe seguir rojo hasta la corrección separada.

### Task 3: Evitar la espera cruzada antes de destruir la reserva propia

**Files:** Create app/Support/Auth/EmailChangeReservationConflict.php; modify EmailChangeAdmission::request, AuthController::requestEmailChange y comentario EmailAddressLock.

**Interfaces:** excepción controlada `EmailChangeReservationConflict extends RuntimeException` revierte la TX completa; controller traduce exactamente al409 de23505 existente.

- [x] Tras step-up correcto y advisory del target, comprobar una reserva ajena no caducada antes de cualquier DELETE propio:

```php
if (EmailChangeRequest::where('user_id', '!=', $locked->id)
    ->whereRaw('lower(new_email) = ?', [$newEmail])
    ->where('expires_at', '>', now())->exists()) {
    throw new EmailChangeReservationConflict('Destination reservation is active');
}
```

- [x] Capturar esa excepción y responder `['error'=>'Ese email ya está en uso o pendiente de confirmación']`,409. No capturardeadlock genéricamente ni fabricar QueryException. La reserva ajena expirando se rige por la misma igualdad exclusiva; mantener SQL unique guard.
- [x] Comentario de mutex reconoce que no garantiza ausencia global de ciclos entre direcciones distintas. Nativeprobe verde exige ambas autorizadas,409+409,sin40P01 y reservas/codes originales, sin mail/notification. Factor inválido no cambia su respuesta según ocupación.

### Task 4: Verificar y registrar

- [x] Format antes de todos los gates; composer quality y filtro final incluyendo concurrency; suite completa backendserializadauvh_test.
- [x] Regenerar inventario sin bootstrap, verificar hashes/anchors después de full y registrar evidenciaB139/O20/fixturefailures y límites. Sin nuevo frontend/visual/release ni cierre global.


Evidencia intermedia:105/810 antes del traslado (21,55s) y después (21,40s), exit0; native repro después de extracción aún rojo1/6 (2,37s), ciclo real y40P01/409+500. Primera comprobación de extracción detectó8 fallos por import EmailToken ausente, corregido y repetido; no se atribuye a producto anterior. Final106/823 (27,44s), exit0, incluye rollback freshness. Pint463/PHPStan0 y baseline173/162, sin nuevos ignores. Full backend en curso; no acreditado por filtros.


O20 verificación final (03/10): full1672/1672 backend,12108 aserciones,307,24s sólo uvh_test (`s01-email-change-full-backend.log`), exit0;23 controles nuevos (22 caracterizaciones y1 native concurrency).105/810 antes (21,55s) y después del traslado (21,40s);106/823 final (27,44s), exit0. B139 deadlock cruzado40P01 reproducido con dos procesos y corregido; ambos409, sin ciclo, reservas/recovery conservados; freshness rollback comprobado. Tres TX completas comparadas antes del fix; import ausente detectado por8 fallos durante traslado, corregido antes del definitivo. AuthController1937→1782líneas. Pint463/PHPStan0 (`s01-email-change-quality.log`), exit0; baseline173/162, sólo3 ignores resueltos retirados. Inventario461 archivos/2194 funciones con nombre/1138 callbacks/3 firmas;461 hashes y199 anchorsS01/47archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. Sin PHP/tests edits durante suites, frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Siguiente MFA/lecturas y demásS01–S13/gates reales; goal abierto.
