# Revisión parcial S07 — autoridad y caducidad de tokens API

O58: lectura íntegra de TokenController, RequireApiToken, ApiToken, WorkspaceAccess, SecurityContext, IsoDate y MfaStepUp; rutas y contratos de consumidores nativos comprobados. La revisión de esta frontera no cierra S07, autenticación, UI ni el objetivo S01–S13.

Rojo inicial nativo antes de editar producto: 39 fallos/45 controles, 252 aserciones, 25.12s. B192/P1: 18 accesos de middleware y cinco escrituras bloqueadas aceptaban el instante exacto de caducidad. B193/P1: 12 mutaciones permitían una sesión inválida en emisión/revocación. B194/P2: tres emisiones aceptaban una fecha igual a ahora o vencida antes de crear la credencial. B195/P2: Eloquent truncaba fracciones y PostgreSQL timestamp(0) las redondeaba, pudiendo extender la autoridad. B196/P1, confirmado al ampliar: ISO +02:00 se almacenaba dos horas más tarde por perder su offset. Un rojo adicional de readiness demuestra que un ledger completo ocultaba precisión incompatible.

Verde ampliado: 98 casos/456 aserciones, 26.00s, exit0. Tres controles positivos miden un único bloqueo de cuenta y sesión por operación; se elimina el segundo bloqueo de cuenta en emisión y se añade la comprobación de sesión que faltaba en revocación. No se afirma una ganancia de latencia. Roles editor/viewer, consumo de recovery, rollback SQL de prueba MFA, TOTP conservador, aviso/audit y precisión de seis dígitos con offset comprobados. Regresión final462/3221, Pint511/PHPStan0 y full2599/22000 con JUnit0errores/fallos/omitidos,exit0;813hashes y18comparadores verificados post-terminal. No nueva suitefrontend/QA visual atribuida.

## backend-laravel/app/Http/Controllers/TokenController.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `index` | 32 | Cuerpo/callback completo leído; acota 100 y orden estable creado/id, DTO sin hash. O58 no modifica esta lectura ni certifica toda su autoridad concurrente, UI o retención. |
| `store` | 45 | B193/B194: cuenta y sesión exactas verificadas, parent workspace y rol vigente en la TX original; caducidad estrictamente futura antes y después de factor. El rechazo tardío revierte prueba MFA SQL, recovery, credencial y avisos. Cuota, errores, scopes, metadatos y política de mail preservados por comparación íntegra y regresiones. |
| `destroy` | 184 | B193: misma sesión exacta antes de workspace/token; rechazo de revocada/caducada/generación/dueño/ausente después del middleware, sin revocar ni auditar éxito. Editor válido preservado y viewer rechazado. |
| `validExpiry` | 219 | Un único instante para exigir fecha futura y máximo un año; null conserva credenciales sin fecha. Límites -1/0/+1 y paso del tiempo durante bcrypt real probados. |
| `dto` | 226 | Cuerpo íntegro leído y preservado; fechas UTC milisegundos, sin bearer/hash. Fracción/offset probados por emisión nativa, sin cambiar el contrato JSON. |
| `iso` | 239 | Delegación íntegra y preservada a IsoDate; precisión del contrato de salida sigue en milisegundos. |

## backend-laravel/app/Http/Middleware/RequireApiToken.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `handle` | 21 | B192: caducidad inclusiva de rechazo antes de last_used_at/handler en las 18 rutas bearer; tres lecturas positivas con futuro y sin caducidad. Scheme/hash, creador/rol/scopes y contexto de tenant preservados. En rutas DNS/TLS sólo se prueba rechazo temprano con recursos ausentes, no proveedor ni negocio de dominio. |

## backend-laravel/app/Models/ApiToken.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `casts` | 36 | Cuerpo preservado; formato de almacenamiento .uP y migración timestamp(6) conservan instante/fracción. Native SQL/HTTP prueba +500ms y +02:00 con seis dígitos, acceso antes y rechazo exacto. |
| `workspace` | 48 | Relación íntegra leída y preservada; la autoridad del workspace se acredita en sus callers, no en la relación. |
| `creator` | 54 | Relación íntegra leída y preservada; middleware sólo admite creador vivo/verificado, regresiones de consumidores mantienen rol/scope/generación. |

La autoridad compartida se registra también en S03; ReleaseReadiness en S01/S13. Migración `2026_10_06_000001_preserve_api_token_expiry_precision` aplicada sólo a uvh_test, con guard testing/*_test anterior a DDL. Up conserva filas enteras/null e índices; down toma lock exclusivo y rechaza fracciones activas e históricas, evitando redondeo destructivo. Readiness rechaza precisión incompatible aunque el ledger diga aplicado y también rechaza ledger pendiente aunque el esquema sea preciso. Los entornos de ejecución y externos deben aplicar la migración mediante release; aquí no se han alterado.

Los logs O58 conservan el prefijo histórico `s11-api-token-*`; el sistema correcto en matriz/inventario y este ledger es S07. El prefijo no acredita revisión de moderación S11. Hooks seriales no prueban todas las carreras entre procesos; cookies cifradas, proveedor/mail/worker reales, capacidad, CI, UI y producción siguen con gates propios. Dos archivos de control local añadidos por el usuario aparecen ahora en inventario S13; se preservan y enumeran, sin declararlos revisados ni ejecutarlos.


O63 (06/10): revisión del consumidor frontend, alcance local; no cierre global del sistema.

## frontend/src/app/core/api-token-label.ts

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `tokenExpiryTick` | 6 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |
| `apiTokenState` | 18 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |
| `tokenStateLabel` | 35 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |
| `tokenActionLabel` | 39 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |
| `tokenStateIcon` | 43 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |
| `tokenActionAriaLabel` | 49 | O63/B209: presentación temporal estricta con precisión submilisegundo, sin caducidad y prioridad de revocación. Trece controles de componente/reloj; no autoridad bearer nueva. |

## frontend/src/app/panel/tokens/tokens.component.ts

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `constructor` | 95 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `load` | 130 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `toggleScope` | 160 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `create` | 164 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `expiresAtIso` | 201 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `revoke` | 209 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `copyPlain` | 237 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `trackByToken` | 251 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `refreshClock` | 255 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `state` | 260 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `stateLabel` | 265 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `stateIcon` | 266 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `actionLabel` | 267 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
| `actionAriaLabel` | 268 | O63/B209: fuente completa revisada; temporizador único y cleanup, visibilidad, estados y fechas. Transportes load/create/revoke/copy y efecto de workspace preservados literalmente. Trece controles nuevos y regresión completa. Autoridad/roles/producción conservan gates separados. |
