# Reauthentication and Profile Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task inline; autorización vigente de continuar, sin delegación/worktree nuevo/commit/handoff.

**Goal:** Separar las TX completas de reautenticación y perfil, completando los controles de commit exterior antes del traslado.

**Architecture:** ReauthenticationAdmission::admit(User,?string,string password,string factorCode,?string ip):array y ProfileAdmission::update(User,?string,string name):?User conservan mutación/authority/exact audit en una TX. Controller valida/resuelve IP HTTP y traduce respuesta. Queries y cierres de sesiones siguen para bloque propio.

**Tech Stack:** Laravel/PHP/PostgreSQL uvh_test, PHPUnit, Pint/PHPStan6.

**Spec:** SECURITY_MUTATION_CONTRACT.md;2026-10-01-system-by-system-review.md; separación gradual autorizada del texto pegado, sin mezclar traslado y cambio funcional.

## Global Constraints

- O21 progreso verificado1714/12722/calidad; Auth/S01–S13 y gates reales siguen abiertos.
- Una suite DB destructiva a la vez sólo uvh_test, guard env testing/DB *_test previo. No PHP/test editado durante suites.
- Sin migración/frontend/uvh_local/provider/worker/scheduler productivo/commit/push/deploy.
- Reauth crea ventana fresca aun con timestamp null/antiguo; no rotar sesión/SV. Profile sólo nombre válido, no gasto de factor. Mutación/exact audit juntos; replay TOTP en cache no revertido por SQL.
- Retirar sólo dos ignores missingType.return resueltos; no añadir baseline.

### Task 1: Caracterizar el commit exterior

**Files:** Modify tests/Feature/ReauthenticationProfileAdmissionTest.php; read AuthController::mfaReauthenticate/profile, SecurityContext/MfaStepUp/Audit/UvhRequest::ip y contratos existentes.

**Interfaces:** POST /api/v1/auth/mfa/reauthenticate, PATCH /api/v1/auth/profile. Seis nuevos casos:profile/recovery/TOTP ×commit/rollback; fixtures sin providers reales.

- [x] Guardar controller previo en .uvh-runtime/reauth-profile-controller-before.php y leer funciones/dependencias completas.
- [x] Añadir seis casos a la suite existente: iniciar DB::beginTransaction, llamar API real, exigir1outbox exacto/0history; después commit o rollback. Verificar recovery/freshness/nombre, mismas sesiones/SV, no mail. Recovery/profile retry tras rollback; TOTPspent persiste y replay403, sin borrar cache ni esperar reloj. Comprobar ip_hash y metadatos factor sin secretos en evento final. Ejemplo:

```php
DB::beginTransaction();
$response = $this->postJson('/api/v1/auth/mfa/reauthenticate', ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY]);
$response->assertOk();
$this->assertDatabaseCount('audit_outbox', 1);
DB::rollBack();
$this->assertSame($before, $user->refresh()->getRawOriginal());
```

- [x] Ejecutar previo `--filter='ReauthenticationProfileAdmission|MfaStepUpBudget|CredentialStepUpContract|SecurityContextQuery'` con Docker y DB_DATABASE=uvh_test. No atribuir nuevo defecto si ya pasa.

### Task 2: Trasladar autoridad y auditar imports

**Files:** Create app/Support/Auth/ReauthenticationAdmission.php y ProfileAdmission.php; modify AuthController.php/phpstan-baseline.neon.

**Interfaces:** admit retorna shape {status:string,factor?:string,verified_at?:Carbon}; update retorna el User vivo o null. IP nullable resuelto una vez por UvhRequest::ip($request) fuera de la TX; no cambia datos ni confianza de proxies.

- [x] Copiar ambos cuerpos completos adaptando sólo SecurityContext/property e IP pura:

```php
$context = SecurityContext::lock($user, $sessionId, true);
if ($context === null) { return ['status' => 'stale']; }
$locked = $context->user;
$session = $context->session;
```

Profile devuelve null en su guard original y usa sólo $context->user. Audit::write(...,$ip) mantiene IP hasheada y metadata de factor; resolución HTTP no concede autoridad.

- [x] Controller delega argumentos originales, JsonResponse explícito y conserva input/prechecks/respuestas/audit de rechazo. Retirar sólo dos entradas missingType.return resueltas.
- [x] Format y comparar ambos cuerpos normalizados revirtiendo adaptación SecurityContext e IP; verificar imports. Repetir el mismo filtro y composer quality.

### Task 3: Verificar y registrar sin cerrar objetivo global

- [x] Full backend serializado exclusivamenteuvh_test con fuente estable; registrar resultado real.
- [x] Regenerar inventario sin bootstrap, rebasar/verificar hashes y anchors después del full; actualizar ledger/matriz/informe/planes/Next Step hacia queries y cierres. No cierre S01–S13 por extracción.


O22/O23 progreso (03/10): reautenticación/perfil trasladados como dos TX completas; cuatro lecturas separadas en AccountReadContext/AccountQueries. Comparación mecánica completa conserva SQL/policies/payloads. AuthController1604→1469líneas; baseline168/157→162 findings/151entradas, sólo6 retornos resueltos retirados, sin nuevos ignores. Seis casos outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio:55/386 antes/después O22,60/292 antes O23 y105/596 conjunto final20,08s, todos exit0. Pint469/PHPStan0 verificados. Full19314 en curso exclusivamenteuvh_test, sin edición PHP/tests. Inventario466/2206/1138/3 regenerado sin bootstrap; hashes/anchors se verificarán después del full. Primer filtro O23 falló sólo por fixture sin cookieCSRF: middleware correcto; corregida fixture, sin bug nuevo. Script baseline abortó por match accidental WorkspaceController::rename sin escribir baseline; retiro exacto de cuatro AuthController entries conserva rename. Hipótesis failover TOTP descartada para configuración producción permitida: ProductionSecurity ya rechaza CACHE_STORE=failover; lectura parcial de reglas/config no acredita todo S13. Sin frontend/migraciones/uvh_local/proveedores reales/worker/scheduler productivo/commit/push/deploy ni ahorro de latencia/SQL medido. Objetivo/S01–S13 y gates externos permanecen abiertos.


O22/O23 verificados (03/10): full backend 1724/1724, 12910 aserciones, 334.17s exclusivamente uvh_test, exit0 (`s01-account-separation-full-backend.log`). Diez casos nuevos frente a O21: seis outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio. Filtros O22 55/386 antes/después, O23 60/292 antes y conjunto final105/596 (20,08s), todos exit0. Pint469/PHPStan0; baseline168/157→162 findings/151entradas, sólo seis ignores resueltos retirados. AuthController1604→1469líneas; cuatro módulos nuevos con dos TX completas y cuatro proyecciones/contexto de lectura. Comparación mecánica tras format conserva SQL/policy/payload. Inventario466 archivos/2206 funciones con nombre/1138 callbacks/3firmas;466 hashes y224 anchorsS01/52archivos más16S03/2 comprobados después del full. Node--check y gitdiff--check correctos. No PHP/tests editados durante suite ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Sin nuevo bug ni ahorro de SQL/latencia medido. Objetivo/S01–S13 abiertos; siguiente bloque revocación de sesiones según plan, con política de logout preservada.
