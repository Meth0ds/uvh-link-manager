# Account Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline; sin delegación/worktree/commit/handoff, autorización vigente.

**Goal:** Separar las cuatro consultas de cuenta y su contexto de lectura, preservando payloads/SQL/401/cookies y evitando confundir lectura con autoridad bajo lock.

**Architecture:** AccountReadContext readonly contiene User/UvhSession del mismo resolve(?User,?string):?self sin locks. AccountQueries construye me/mfaSession/sessions/securityCenter desde ese contexto. Controller resuelve input HTTP y mantiene rechazo401/JsonResponse; SecurityContext sigue siendo exclusivo de commits de mutación.

**Tech Stack:** Laravel/PHP/PostgreSQL uvh_test, PHPUnit, Pint/PHPStan6.

**Spec:** Separación reads/mutations del texto pegado; SECURITY_MUTATION_CONTRACT.md y revisiónS01–S13 por función. O22 transacciones separadas y filtro55/386/calidad467 verdes; full final compartido O22/O23 con fuente estable, no hay full previo O22 acreditado.

## Global Constraints

- No cambiar policies/payload/SQL/order/limits/fecha/401/cookies. No locks pesados de GET ni presentar AccountReadContext como autoridad de commands; modelos readonly no son inmutables.
- Una suite DB a la vez, sólo uvh_test y guard testing/*_test previo. Ninguna edición PHP/tests mientras corre; sin frontend/migración/DBlocal/provider/worker/scheduler real/commit/push/deploy.
- Cuatro JsonResponse explícitos permiten retirar sólo sus cuatro ignores missingType.return; no añadir supresiones. No prometer ganancia de latencia/SQL por organización.

### Task 1: Caracterizar lecturas antes del traslado

**Files:** Read AuthController::me/mfaSessionStatus/sessions/securityCenter/liveAccountReadContext, UvhRequest::publicUser/IsoDate/MfaFreshness/modelos y AccountReadContextTest/SecurityCenterTest.

- [x] Guardar fuente previa .uvh-runtime/account-queries-controller-before.php y leer todas las funciones/dependencias.
- [x] Añadir cuatro casos API GET reales para /auth/me,mfa/session,sessions,security-center: respuesta200,sin secrets/cookie,sin FOR UPDATE ni BEGIN de negocio; cuenta/SV/contador de sesiones sin mutar. QueryExecuted observa SQL sólo durante la petición. Ejemplo:

```php
DB::listen(static function (QueryExecuted $query) use (&$locks): void {
    if (str_contains(strtolower($query->sql), 'for update')) { $locks[] = $query->sql; }
});
$this->getJson('/api/v1/auth/me')->assertOk();
$this->assertSame([], $locks);
```

- [x] Ejecutar `--filter='AccountReadContext|SecurityCenter|MfaFreshness|MfaStepUpBudget'` antes de editar producto. Mantener controles previos de32 contextos invalidados, perfiles/timestamps vivos, límites100/20 y secretos.

### Task 2: Traslado de contexto y payloads sin cambio funcional

**Files:** Create app/Support/Auth/AccountReadContext.php, AccountQueries.php; modify AuthController.php y phpstan-baseline.neon.

**Interfaces:** AccountReadContext::resolve(?User $snapshot,?string $sessionId):?self; constructor privado(public User $user,public UvhSession $session). AccountQueries::me/mfaSession/sessions/securityCenter(AccountReadContext):array<string,mixed>.

- [x] Resolver mismo SQL y guards del helper, cambiando sólo devolución array a objeto:

```php
return new self($user, $session);
```

- [x] Mover cuatro payloads completos. Adaptaciones mecánicas: $context['user'/'session']→propiedad; $this->iso→IsoDate::format; $currentId=$context->session->id (mismo id exacto validado por resolve). Preservar Collection serializable, SQL/orden/limit101→100 y21→20, allowlist sin metadatos/IP.
- [x] Controller conserva401 y response()->json(AccountQueries::method($context)), con cuatro JsonResponse; eliminar helper privado anterior y sólo cuatro ignores resueltos. Comparar cuerpos normalizados revirtiendo adaptaciones y HTTP envolvente; revisar imports.
- [x] Format, filtro idéntico después y composer quality. Resolver sólo fallos concretos; no nuevo bug por refactor.

### Task 3: Verificación compartida O22/O23

- [x] Repetir también filtro55/386 O22 ante cambios del controller. Ejecutar full backenduvh_test una vez con ambos bloques estables; no source/tests edits durante suite.
- [x] Inventario sin bootstrap, hashes/anchors actualizados y verificados tras full; ledger/matriz/reportes/planes/Next Step hacia revocación y demásS01–S13. Sin gate nuevo frontend ni cierre global.


O22/O23 progreso (03/10): reautenticación/perfil trasladados como dos TX completas; cuatro lecturas separadas en AccountReadContext/AccountQueries. Comparación mecánica completa conserva SQL/policies/payloads. AuthController1604→1469líneas; baseline168/157→162 findings/151entradas, sólo6 retornos resueltos retirados, sin nuevos ignores. Seis casos outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio:55/386 antes/después O22,60/292 antes O23 y105/596 conjunto final20,08s, todos exit0. Pint469/PHPStan0 verificados. Full19314 en curso exclusivamenteuvh_test, sin edición PHP/tests. Inventario466/2206/1138/3 regenerado sin bootstrap; hashes/anchors se verificarán después del full. Primer filtro O23 falló sólo por fixture sin cookieCSRF: middleware correcto; corregida fixture, sin bug nuevo. Script baseline abortó por match accidental WorkspaceController::rename sin escribir baseline; retiro exacto de cuatro AuthController entries conserva rename. Hipótesis failover TOTP descartada para configuración producción permitida: ProductionSecurity ya rechaza CACHE_STORE=failover; lectura parcial de reglas/config no acredita todo S13. Sin frontend/migraciones/uvh_local/proveedores reales/worker/scheduler productivo/commit/push/deploy ni ahorro de latencia/SQL medido. Objetivo/S01–S13 y gates externos permanecen abiertos.


O22/O23 verificados (03/10): full backend 1724/1724, 12910 aserciones, 334.17s exclusivamente uvh_test, exit0 (`s01-account-separation-full-backend.log`). Diez casos nuevos frente a O21: seis outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio. Filtros O22 55/386 antes/después, O23 60/292 antes y conjunto final105/596 (20,08s), todos exit0. Pint469/PHPStan0; baseline168/157→162 findings/151entradas, sólo seis ignores resueltos retirados. AuthController1604→1469líneas; cuatro módulos nuevos con dos TX completas y cuatro proyecciones/contexto de lectura. Comparación mecánica tras format conserva SQL/policy/payload. Inventario466 archivos/2206 funciones con nombre/1138 callbacks/3firmas;466 hashes y224 anchorsS01/52archivos más16S03/2 comprobados después del full. Node--check y gitdiff--check correctos. No PHP/tests editados durante suite ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Sin nuevo bug ni ahorro de SQL/latencia medido. Objetivo/S01–S13 abiertos; siguiente bloque revocación de sesiones según plan, con política de logout preservada.
