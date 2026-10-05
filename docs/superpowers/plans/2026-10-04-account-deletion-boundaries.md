# O41 — fronteras de borrado de cuenta

Continuar después del full/JUnit O40. Ejecución secuencial, árbol compartido conservado, sin agentes/worktree/commit/push/deploy. Sólo uvh_test/Storage fake/mail array/queue fake en PHP y TestBedHTTP real simulado en frontend; no cuentas/bearers/proveedor/cookie real ni migraciones externas. No editar PHP/tests hasta que O40 sea terminal.

1. Releer actor/publictoken/expiry/efectos de deletionImpact/requestDeletion/confirmDeletion/cancelDeletion, AccountDeletionSecurityTest y consumidores/decode/SessionManager/RequireAuth/AccountReadContext. Código candidato leído en O40: GETimpact usa snapshot middleware; confirm exitoso siempre Set-Cookie clear y UI accountSignedOut; confirm isPast permite igualdad y impact isFuture la omite. Sin BugID hasta rojo, no atribuir autorización total a DTO ni modificar cancelación protectora por analogía.
2. Reproducir GETimpact tras hydrate revocado/expiryExact/version/owner cambiado/deleted/unverified/actorversion, con nombre workspace/privacidad pendientes y sin devoluciones privadas. Positivos normales/noTXdelectura y permisos/GETsinwrites; request underlock controles preservados.
3. Confirmar bearerA con cookieA/cookieB/anónimo mediante endpoint público: suspensión/revocación/tokens/invitaciones A exclusivamente; CookieB/meB/sessionregistry intactos. Caller real API/interceptor/Auth conserva B, ownA se cierra sólo con current confirmado, tardíos no limpian B nuevo, destroy no modifica formulario pero reconciliación propia sigue. Contrato current obligatorio/decoder/error sin replay; no fingir rollback ante respuesta malformed tras commit. Considerar UX de mensaje en caso de acción sobre otra cuenta.
4. Reproducir confirm deadline pasado/igual/futuro y relación con impact sólo si policy/emisor/consumidores exigen futuro exclusivo; no cambiar cancelación protectora como efecto colateral. Caracterizar audit/mail/outbox admission/cleanup y efectos postcommit pertinentes sin duplicar cobertura ni ampliar pruebas triviales.
5. Corregir únicamente fallos materiales reproducidos, IDs siguientes a B175. Si se reutiliza CredentialChangeResponse, tipo extra executeAfter explícito o helper adecuado; validar consumidores sin romper flags/account/generation existentes. UI si cambia DOM requiere QA propia aislada por agent-browser; no actor replacement con user.set(B).
6. Dedicado/quality/fullbackend/JUnit y frontend/lint/tipos/build según archivos tocados. DB suites de una en una, PHP/tests congelados durante suites; fuente/anchors/cuerpos previos/baseline sin ignores nuevos. Actualizar matriz/plans/reportes, sin cerrar S01–S13/global/CI/roles/retención/capacidad/operación real por esta fase.


## Cierre local O41

- [x] Pasos1–6: lectura completa acotada, rojos, fixes B176–B178, dedicado/quality/full/JUnit, frontend y QA. Evidencia y límites en reporte O41.
- [x] Matriz y anchors actualizados; no cierre global.



## O41 — fronteras de eliminación de cuenta verificadas (04/10)

B176/P1: deletionImpact vuelve a resolver sesión, cuenta verificada y rol actuales; siete intercalaciones tras hydrate y dos cambios de rol ya no publican información privada obsoleta. B177/P2: confirmar un enlace de A con sesión de B conserva B; backend devuelve current boolean obligatorio y sólo limpia cookie del propietario, UI respeta current y generación. B178/P2: confirmación exige plazo estrictamente futuro, coherente con impact; cancelación protectora no cambia. Mensaje de éxito identifica la cuenta del enlace.

17 nuevos backend/165 aserciones y23 frontend; rojos13/17 y15/23 antes del fix.272/2176 dedicado46,22s; **2066/2066 backend,15998 aserciones,352,034s/133MB**, JUnit0 errores/fallos/skips exclusivamente uvh_test. Pint482/PHPStan0.109 dedicado y **1335/1335 frontend**,10,256s Karma/9,521s ejecución; lint/tipos/build10,334s exit0. Logs `.uvh-runtime/s02-deletion-{boundary,identity}-*`; JUnit `backend-laravel/storage/logs/s02-deletion-boundary-junit.xml`. QA aislada en390×844 y1440×1000, ambos temas sin overflow, cuatro capturas y resumen en `.uvh-runtime/s02-deletion-browser/`; navegador/servidor8451 cerrados.

474 hashes y353 S01/16 S03/63 S10/139 S02 anchors en19archivos comprobados; inventario474/2266/1165/3/0provisional. Auth652/AuthController1408, baseline152/141, cuerpos6export+4sessions+3TX preservados. Ocho hashes PHP/tests sin cambios durante full; suites DB secuenciales. Pruebas HTTP/headers no acreditan aplicación de cookie nativa ni congelan un futuro Set-Cookie; QA usa fixture, sin DB/usuarios/proveedores reales. No uvh_local/worker/scheduler/migraciones externas/commit/push/deploy. Todos handles propios cerrados, postgres/mailpit compartidos permanecen operativos.

**Objetivo global/S01–S13 activos.** Siguiente: caracterizar y extraer los dos transportes Auth de borrado conservando guards completos; revisar callers con comportamiento real antes de asignar más bugs. Restantes funciones/roles/retención/capacidad/CI/operación real siguen pendientes.
