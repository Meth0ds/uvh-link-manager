# Auth sessions transport implementation plan — O33

> **For agentic workers:** ejecución secuencial con executing-plans en esta sesión; sin delegación/worktree/commit. Preferencias del usuario prevalecen sobre recomendaciones de skills.

**Goal:** continuar la separación gradual de Auth extrayendo el transporte de cuatro operaciones de sesiones y preservar su política actual de identidad/invalidation.

**Architecture:** AccountSessionsService, igual que AccountProfileService/AccountMfaService, sólo conoce ApiService, payloads y decoders. Auth mantiene fachada pública, generación, sessionExpired, workspace cleanup y marcador entre pestañas. Nada de retries/colas/passwords/estado compartido nuevo.

**Tech Stack:** Angular22, TypeScript, HTTP testing con ApiService/interceptor/decoders reales, Karma/ChromeHeadless.

**Spec:** plan maestro `2026-10-01-system-by-system-review.md`, petición de separación gradual Auth y optimización. Los cuatro métodos completos y sus decoders se caracterizan antes de moverlos; O32 backend cerrado localmente, S01–S13 abiertos.

## Global constraints
- Preservar árbol compartido; sin PHP/DB/migración/proveedor/worker/scheduler/productivo/commit/push/deploy.
- No trasladar generación ni invalidación a transporte. No incrementar round trips, abortar writes enviados ni modificar CSRF/expected-account.
- Conservar options/signal de GET; `encodeURIComponent(id)` en revoke.
- Un ACK inválido no expira la sesión; un ACK antiguo no expira una identidad nueva. `current=true` protector sigue prevaleciendo aunque respuesta no incluya current.

### Task 1: caracterizar frontera real actual
**Files:** crear `frontend/src/app/core/services/auth-account-sessions.spec.ts`; leer `auth.service.ts`, `auth-response-decoders.ts`, `api.service.ts`, `api.interceptor.ts`, SessionContext y consumidores Settings.
**Interfaces:** Auth.listSessions(ApiReadOptions?), revokeSession(id,current=false):Promise<boolean>, revokeOtherSessions():Promise<number>, revokeAllSessions():Promise<number>.
- [x] Crear controles HTTP actuales de las cuatro rutas con decoders reales, sin depender del nuevo servicio aún inexistente.
```ts
spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
TestBed.configureTestingModule({ providers: [
  provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
  { provide: Router, useValue: { navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
] });
const auth = TestBed.inject(AuthService);
const http = TestBed.inject(HttpTestingController);
// Execute this example inside fakeAsync; ApiService awaits CSRF before dispatch.
let result: number | undefined;
void auth.revokeOtherSessions().then((value) => { result = value; });
flushMicrotasks();
http.expectOne("/api/v1/auth/sessions/revoke-others").flush({ ok: true, revoked: 0 });
flushMicrotasks();
expect(result).toBe(0);
```
- [x] Casos: lista vacía/truncated; AbortSignal; ackfalse/missing/invalidcount y404/503/0 sin fake logout; otra sesión conserva actor; currenttrue/currentsvrtrue yall provocan sólo invalidación propia; cero aceptado; epoch reemplazado antes de settlement no borra nueva identidad; CSRF/expected-account/preparación y no replay preservados. Consumidor Settings own-confirmación/read/busy se mantiene por suites existentes.
- [x] Ejecutar caracterizaciones antes de producto con `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless --include=src/app/core/services/auth-account-sessions.spec.ts`; registrar resultado baseline. Extracción no exige rojo de bug inexistente: si aparece fallo nuevo, reproducir/registrar causa antes de decidir fix.

### Task 2: extraer sólo transporte
**Files:** crear `frontend/src/app/core/services/account-sessions.service.ts`, modificar AuthService.
**Interfaces:** list(options?), revoke(id), revokeOthers(), revokeAll(); DTOs validados originales.
- [x] Implementar:
```ts
import { Injectable, inject } from "@angular/core";
import type { SessionList } from "../models";
import { ApiService, type ApiReadOptions } from "./api.service";
import { decodeSessionsResponse, decodeSessionRevocation, decodeSessionsBulkRevocation } from "./auth-response-decoders";

@Injectable({ providedIn: "root" })
export class AccountSessionsService {
  private readonly api = inject(ApiService);
  list(options?: ApiReadOptions): Promise<SessionList> {
    return this.api.get("/api/v1/auth/sessions", undefined, decodeSessionsResponse, options);
  }
  revoke(id: string): Promise<{ ok: true; current?: boolean }> {
    return this.api.post(`/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`, undefined, decodeSessionRevocation);
  }
  revokeOthers(): Promise<{ ok: true; revoked: number }> {
    return this.api.post("/api/v1/auth/sessions/revoke-others", undefined, decodeSessionsBulkRevocation);
  }
  revokeAll(): Promise<{ ok: true; revoked: number }> {
    return this.api.post("/api/v1/auth/sessions/revoke-all", undefined, decodeSessionsBulkRevocation);
  }
}
```
- [x] Auth inyecta AccountSessionsService y cambia sólo cuatro expressions de API. Las líneas anteriores/posteriores —captura generation, assertCurrent, current protector, sessionExpired, return— se conservan literalmente. Quitar tres imports decoder si ya no se usan en Auth; importar tipos desde models/API como módulos previos.
- [x] Comparar antes/después y ejecutar contrato + Settings + Auth/proyección/interceptor. No mejora de SQL/latencia atribuida; optimización de responsabilidad y política compartida.

### Task 3: verificar y documentar
**Files:** inventario/ledgerS01/matriz/master/reportes/planning vigentes.
- [x] Full frontend/lint/tipos/build; backend1930/14523/O32 se conserva como evidencia anterior porque PHP sin cambio.
- [x] Reusar snapshot PHP sólo si PHP no cambió, regenerar AST/hashes y rebasar anchors; Node--check/diff. Funciones nuevas deben tener ownerS01 y cobertura explícita, enum≠review.
- [x] Registrar conteos/errores/limites, no nuevo bugID sin defecto reproducido. Sin nuevo QA visual si DOM/CSS intactos; sí evidencia de comportamiento real por HTTP. Objetivo global activo.

## Next Step
Task1: escribir/ejecutar caracterizaciones reales de los cuatro métodos actuales antes de crear AccountSessionsService. Luego revisar candidato URI/secret MFA y error exportstatus según plan maestro.

## Resultado local verificado
51nuevos controles:46characterizations antes/después y5Settingsreal,174dedicado/1125full, lintfinal/tipos/build10,512s. Comparación conserva cuatrofacademethods; AccountSessionsService4transportspuros, Auth659líneas.473hashes/352S01/16S03/63S10/61S02anchors, Node/diffcorrectos. La única expectativa errónea intermedia fue duraciónToast, ajustada a contrato relevante sin cambio de producción. Backend/PHP/DB/proveedor/DOM/CSS sin cambio;1930/14523O32 evidenciaanterior. Sin nuevoBugID. Goal/S01–S13 activos yhandles propios cerrados.

## Next Step
Ejecutar `2026-10-04-mfa-setup-response-contract.md`: reproducción de manualsecret/URI incoherentes ycontrato del emisor/caller antes de implementar validación.
