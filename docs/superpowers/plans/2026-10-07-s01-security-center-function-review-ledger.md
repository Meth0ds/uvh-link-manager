# O69 — Ledger parcial S01/S13: Centro de seguridad y sesiones

Código TS/HTML/SCSS del Centro y619líneas originales de AuthService releídos completos, junto a transportes/decodificadores y contratos backend listados. Lectura no acredita todas sus dependencias ni cierra S01/S13. Fuente autoritativa: código actual y suite completa1630;28controles nuevos con25rojos válidos, no los intentos de harness sin fichero/timestamp válido. Nueve casos previos del Centro preservan sus expectativas; doble usa SessionContextService y reproduce la transición real de logout. Auth HTTP añade un caso conservando los46previos.

B238–B243 separan intención anterior al diálogo, respuestas/propietario, vista montada/read sin epoch, decisiones durante refresco, navegación de cierre propio y prioridad de respuesta del servidor. No se demuestra bypass backend; AccountSessionsController sigue usando admisión transaccional y notice durable. No se cancela ni repite una escritura admitida. Los tickets de comando se comparan a la intención capturada para conservar el logout propio y adicionalmente a la clave viva para publicar; sólo la transición exacta a anónimo permite navegación.

Composición: sesiones/actividad tras postura; credenciales/recuperación después. Texto funcional13–16px, wrap de dispositivos/fechas/dirección pendiente y acciones44px, grupos y advertencia de última lectura. QA y límites en plan/evidencia O69. Objetivo global abierto.

## frontend/src/app/panel/security/security-center.component.ts

SHA-256: `005f1258d72de4834e5ff63492b1135de0122b8f311a2245f33f0891619510ed`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `canDecide` | 82 | Lifetime se consulta en vivo: DestroyRef no es signal y no se debe cachear. Ready exige cuenta verificada y respuesta de contexto vigente. Tres casos de destrucción pasaron tras corregir esa omisión en la primera implementación. |
| `constructor` | 84 | Centro: effect del contexto limpia datos/lecturas/slot visible, carga sólo si elegible. Auth: lifecycle del listener storage leído y preservado. Dependencias no quedan todas cerradas por esta lectura. |
| `load` | 102 | B240/B241: LatestRequest usa pregunta viva de identidad/estado, cancelación de reads y exclusión de respuestas antiguas; decisiones desarmadas durante la lectura. Centro conserva aviso de última lectura mientras refresca. |
| `captureIntent` | 130 | B238: captura cuenta, generación y contexto antes del diálogo; no captura una intención desde una lectura pendiente o inválida. |
| `revoke` | 135 | Backend: transacción con SecurityContext lock, cuenta vigente y row propia; notice durable/auditoría. Relectura completa sin gate DB nuevo. |
| `closeOtherSessions` | 154 | B238/B239: confirmación capturada y runner común, incluido recuento cero confirmado. |
| `closeAllSessions` | 170 | B238/B239/B242: confirmación y runner común; cierre total no navega otra identidad ni niega un ACK por fallo del router. |
| `runRevocation` | 186 | B239/B242: ticket único para tres comandos, comprobación viva antes del despacho y de publicaciones; finally sólo libera su comando. Cierre propio acepta generación+1/usuario null; navegación fallida conserva aviso de cierre confirmado. |
| `actionLabel` | 221 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `formatDate` | 222 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `agent` | 223 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |

## frontend/src/app/core/services/auth.service.ts

SHA-256: `de3994f43a0f335b1e84400b72e59c9e36b644631c3875290426c541bdd592ba`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `constructor` | 30 | Centro: effect del contexto limpia datos/lecturas/slot visible, carga sólo si elegible. Auth: lifecycle del listener storage leído y preservado. Dependencias no quedan todas cerradas por esta lectura. |
| `generation` | 68 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `constructor` | 90 | Centro: effect del contexto limpia datos/lecturas/slot visible, carga sólo si elegible. Auth: lifecycle del listener storage leído y preservado. Dependencias no quedan todas cerradas por esta lectura. |
| `clearLocalAuth` | 98 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `sessionGeneration` | 113 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `nextGeneration` | 117 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `isCurrent` | 122 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `assertCurrent` | 126 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `publishUser` | 131 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `assertUserContext` | 139 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `reconcileUserMutations` | 144 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `applyUserMutation` | 155 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `markUserProjectionStale` | 160 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `confirmedMfaMutation` | 169 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `adoptObservedUser` | 194 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `assertIdentityCurrent` | 211 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `readIdentity` | 215 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `init` | 237 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `refreshWorkspaces` | 284 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `login` | 298 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `verifyMfa` | 320 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `recoverMfa` | 331 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `register` | 346 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `resendVerification` | 361 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `changeRegistrationEmail` | 374 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `logout` | 383 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `sessionExpired` | 395 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `sessionContextChanged` | 401 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `accountSignedOut` | 407 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `invalidateLocalSession` | 418 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `announceInvalidation` | 427 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `me` | 436 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `refreshUser` | 447 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaSessionStatus` | 452 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `reauthenticateMfa` | 460 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `requireAdminMfaReauthentication` | 468 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `clearAdminMfaReauthentication` | 473 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `updateProfile` | 477 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `changePassword` | 481 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `requestEmailChange` | 491 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `cancelEmailChange` | 495 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `dataExportStatus` | 499 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `dataExportHistory` | 507 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `requestDataExport` | 514 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `downloadDataExport` | 526 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `acknowledgeDataExportDownload` | 534 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `cancelDataExport` | 540 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `accountDeletionImpact` | 546 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `requestAccountDeletion` | 553 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `listSessions` | 565 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `revokeSession` | 572 | B243 en fachada: result.current explícito del servidor vence la pista local; ausencia conserva compatibilidad del contrato anterior. HTTP real simulado rojo/verde, expected-account, CSRF, no workspace header ni falsa invalidación de usuario/espacios/storage. Controller backend conserva respuesta current autoritativa. |
| `revokeOtherSessions` | 587 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `revokeAllSessions` | 595 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaSetup` | 603 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaEnable` | 607 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaCancelSetup` | 611 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaRegenerateRecoveryCodes` | 615 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |
| `mfaDisable` | 619 | Fachada leída: captura de generación, publicación de identidad y contratos previos preservados según método. Suite frontend completa conserva controles existentes; sólo revokeSession cambia en O69. Dependencias/candidatos de Auth frontend permanecen abiertos. |

## frontend/src/app/core/services/account-sessions.service.ts

SHA-256: `585723ccb4e26bf0084a5d4435ae0eea7a5941541c541ac5320dabb26362de31`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `list` | 11 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `revoke` | 15 | Transporte HTTP únicamente: POST al id codificado, respuesta decodificada, sin política de invalidación local. Backend transaccional revisado en sus propios cuerpos. |
| `revokeOthers` | 21 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `revokeAll` | 25 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |

## backend-laravel/app/Http/Controllers/AccountSessionsController.php

SHA-256: `f8bfc70ff9c9b32478db6a8e88af52ebdc0389ba2ea6b079270a972f68a88d0c`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `sessions` | 17 | Registro bounded101/100 con current primero; frontend conserva truncation y filtra expiradas/revocadas. Sin nuevo gate de ejecución SQL. |
| `securityCenter` | 31 | Contrato acotado de postura y allowlist de auditoría sin material secreto/IP/metadata; API y decodificador relecturas completas, backend sin cambio. |
| `revokeSession` | 41 | B243 en fachada: result.current explícito del servidor vence la pista local; ausencia conserva compatibilidad del contrato anterior. HTTP real simulado rojo/verde, expected-account, CSRF, no workspace header ni falsa invalidación de usuario/espacios/storage. Controller backend conserva respuesta current autoritativa. |
| `revokeOtherSessions` | 69 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `revokeAllSessions` | 96 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |

## backend-laravel/app/Support/Auth/AccountQueries.php

SHA-256: `af2f0cabc0443b19ddeb8952e16e5a30da1331f2086f218b9a5d34d184c91932`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `me` | 15 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `mfaSession` | 23 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `sessions` | 42 | Registro bounded101/100 con current primero; frontend conserva truncation y filtra expiradas/revocadas. Sin nuevo gate de ejecución SQL. |
| `securityCenter` | 67 | Contrato acotado de postura y allowlist de auditoría sin material secreto/IP/metadata; API y decodificador relecturas completas, backend sin cambio. |

## backend-laravel/app/Support/Auth/AccountReadContext.php

SHA-256: `ec2efc89d35c9bc273d4f6afab9e69157091c5605906675d55243642c74b12d6`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `__construct` | 15 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `resolve` | 17 | AccountReadContext: vuelve a comprobar sesión/cuenta/security_version/expiración/verificación/borrado; no concede autoridad de mutación. |

## backend-laravel/app/Support/Auth/SessionRevocationAdmission.php

SHA-256: `a809cf26bddd2686d242c7d072c757b51054390251a8d0a754fd3ae1950c21fd`.

| Función | Línea | Revisión y límites |
| --- | --- | --- |
| `revoke` | 13 | Backend: transacción con SecurityContext lock, cuenta vigente y row propia; notice durable/auditoría. Relectura completa sin gate DB nuevo. |
| `others` | 34 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |
| `all` | 52 | Cuerpo leído completo en contexto y conservado. No se afirma nueva prueba individual, revisión completa de dependencias o ejecución backend para esta función. |

## Límites y próximos pasos

PHP241hashes sin cambios; no nueva prueba DB/backend, DNS/proveedor/correo/worker ni publicación. Inventario estático se regenera para anchors, no es prueba de ausencia de bugs. Centro no resuelve por sí mismo la entrega de credenciales de recuperación cuando una emisión fue ambigua: conciliar indicadores Auth y vista de recuperación como revisión posterior. Continuar auth frontend, Settings/sesiones abiertas, estado público, despacho bajo TX exterior/CSV y release/operación real. Plan/objetivo S01–S13 permanecen activos.
