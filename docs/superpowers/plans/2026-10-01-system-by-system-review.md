# UVH — Plan de revisión y depuración por sistemas

> **Para ejecución:** trabajo secuencial en este chat, con revisión al cerrar cada sistema. Mantener la matriz de cobertura y el plan persistente. No iniciar agentes, commits o despliegues automáticamente. Este es el plan maestro de auditoría; cada defecto confirmado recibe su implementación concreta y ciclo de regresión antes de tocar código.

**Objetivo:** revisar en código todas las funciones de cada sistema, corregir fallos funcionales/visuales, reforzar seguridad y optimizar código con evidencia verificable.

**Arquitectura:** seguir cada flujo desde ruta y componente hasta autorización, servicio, persistencia, cola/correo y resultado visible. Organizar bloques independientes; la suite verde acompaña la revisión de código y no la sustituye. Mantener una matriz por función, con decisiones y límites explícitos.

**Stack:** Angular22/TypeScript; Laravel13/PHP8.4; PostgreSQL; Docker Compose; Chrome/Playwright; PHPUnit, Pint y PHPStan.

**Especificación:** petición del usuario de revisión sistema por sistema; alcance y criterios concretados en este documento. Hallazgos históricos: `docs/project-completion-audit-2026-09-30.md`. Inventario vivo: `docs/superpowers/plans/2026-10-01-system-review-coverage.md`.

## Restricciones globales

- Conservar el árbol compartido y los cambios existentes; sin reset ni reorganización masiva no justificada.
- Tests destructivos exclusivamente en `uvh_test` o una base cuyo nombre termine en `_test`, nunca en `uvh_local`. Una ejecución DB a la vez.
- PHP por Docker; Compose local: `docker-compose.local.yml`, variables `.env.docker.local`. No publicar secretos en logs/documentos.
- No iniciar workers/scheduler que puedan entregar mensajes/webhooks reales para simular pruebas. Navegador con fixtures aislados o respuestas simuladas identificadas como tales.
- No despliegue, commit, push ni mensajes externos sin petición correspondiente.
- Evidencia existente orienta la búsqueda; no marcar cobertura nueva con resultados anteriores. Fallos reproducidos y límites conservados.
- Seguridad alta implica controles, pruebas y recuperación; no declarar «sin bugs» ni seguridad absoluta.

## Entregables y orden

- [x] Inventario inicial de rutas reales, middleware y acciones, extraído con `php artisan route:list --json`:185 rutas totales,172 bajo API v1.
- [x] Plan maestro con13 sistemas y criterios de cierre.
- [ ] Ampliar matriz a todos los Jobs/comandos/servicios/helpers/plantillas relacionados; asignar propietario por sistema.
- [ ] Cerrar S01 antes de pasar al siguiente bloque salvo fallo crítico compartido que justifique cambiar el orden.
- [ ] Ejecutar S02–S13 en orden, registrando cada desviación y su motivo.

Una casilla de sistema sólo se marca cuando cada función tiene revisión de código, prueba del contrato y tratamiento explícito de UI o de su no pertinencia. El cierre de implementación y la preparación para producción se registran por separado.

## Ciclo obligatorio por sistema

1. Inventariar ruta/acción, roles, estados, componentes y dependencias. Leer la implementación completa y sus llamadores. Registrar línea concreta y evidencia; no inferir seguridad sólo por middleware.
2. Trazar éxito y rechazo: entrada inválida, recurso ajeno, estado caducado/revocado, doble envío y cambio de identidad/workspace/rol entre autorización y commit.
3. Revisar atomicidad, locks/orden, consumo de bearer/factor, auditoría exacta, mail/outbox, efectos externos y compensación ante fallo en cada frontera.
4. Reproducir el defecto antes del cambio con el interleaving o fallo concreto. Los defectos de UI requieren observación del estado, foco/teclado y viewport pertinente.
5. Aplicar la corrección a su causa; no ocultar errores, aumentar timeouts o añadir reintentos ciegos para hacer pasar la prueba. Revisar todas las operaciones que comparten la misma causa.
6. Ejecutar regresión, controles apropiados y suites afectadas. La suite completa se usa en fronteras de cambio relevante, sin repetirla por cada ajuste documental.
7. Actualizar matriz con archivo/línea, comportamiento esperado, bug/decisión, prueba/log/fecha y riesgo residual. Si depende de proveedor o entorno externo, registrar pendiente explícito y no marcar «verificado».

## Casos mínimos de seguridad y UX

| Dimensión | Comprobaciones concretas |
| --- | --- |
| Identidad | Anónimo, no verificado, cada rol, sesión/código/token caducado y revocado, snapshot antiguo, sesión de otra cuenta. |
| Tenant | ID de otro workspace, cambio de workspace durante petición, pérdida de rol/propiedad, respuestas tardías y caches. |
| Entradas | Tipos incorrectos/null/array, límites, Unicode, URLs/esquemas, hostname, CSV y secretos. |
| Concurrencia | Doble POST, replay, cambios tras preflight, locks inversos, idempotencia y unicidad. |
| Fallos | SQL, admisión/historial de auditoría, outbox, cache, transporte/timeout, worker muerto y almacenamiento. |
| Estado | Persistencia real y UI coinciden; sin éxito falso, mutación parcial o pantalla atrapada tras error temporal. |
| Diseño |360/390/768/1440px; claro/oscuro; teclado/foco; nombres accesibles; carga/vacío/error/éxito; copy y layout de correos. |

## Optimización por sistema (petición ampliada 02/10)

Revisar junto a cada función duplicación, consultas redundantes/N+1, límites/paginación, trabajo repetido, limpieza de tareas y responsabilidades. Aplicar simplificaciones justificadas por la lectura y conservar contratos, locks, recuperación y autorización. Para mejoras de rendimiento registrar medición antes/después cuando se afirme ganancia; menos líneas no prueba mayor velocidad. Evitar abstracciones sin consumidores reales, supresiones y refactorizaciones masivas. La matriz y el journal deben registrar también oportunidades revisadas, optimizaciones realizadas y pendientes; los13 sistemas mantienen su alcance.

## Comandos y evidencias

Desde la raíz del proyecto, para un sistema usar sus clases de test indicadas abajo (seleccionar la clase real; no crear pruebas que sólo repitan la implementación):

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm -e DB_DATABASE=uvh_test app php artisan test --filter=PasswordNoticeAtomicityTest
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer quality
npm run lint --prefix frontend
npm run typecheck --prefix frontend
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless
npm run build --prefix frontend
git diff --check
```

Para cierre amplio posterior: `npm run e2e --prefix frontend`, `npm run release:e2e --prefix frontend`, `npm run e2e:async --prefix frontend`, `npm run release:boot --prefix frontend`, `npm run e2e:backup --prefix frontend`; revisar antes sus scripts de preparación y DB/stack objetivo. Esas puertas no sustituyen CI ni operación real. Auditorías de dependencias/imagenes y checks de digest mantienen fecha de consulta y excepciones documentadas.

## Estado de partida

Hay correcciones previas B01–B48 y cinco regresiones nuevas de recuperación verificadas. No acreditan auditoría exhaustiva de S01. Pendientes inmediatos de S01: cobertura de registro/login y MFA/recovery restante, eventos de apertura/confirmación de expediente, incidentes protectores, relación bearer/sesión distinta, perfil y medidor de contraseña generado. El medidor y la política se corrigieron en el primer lote S01, con alcance registrado por función en la matriz; queda revisión completa de los flujos. La suite iniciada antes de esta petición terminó:956 backend/7266 aserciones; Pint401/PHPStan0 y69 pruebas específicas. Sus correcciones B49/B50/G11 se registran en el informe; no se acredita nueva suite frontend. La próxima implementación seguirá S01 de este plan.

### S01: Identidad, acceso y recuperación

**Estado:** en curso; política, registro/login, MFA, activación, lecturas y recuperación tienen revisiones parciales documentadas. El cierre de cada función y del sistema sigue pendiente conforme a la matriz.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/AuthController.php`
- `frontend/src/app/auth`
- `frontend/src/app/core/guards/auth.guard.ts`
- `frontend/src/app/core/services/auth.service.ts`

**Funciones/dependencias:** Registro pendiente, verificación/reenvío, login/logout, CAPTCHA, MFA, recuperación, perfil, contraseña y cambio de email. Leer también UvhSession/UvhAuth, MfaStepUp, SessionManager y AccountRecoveryLifecycle.

**Contratos a demostrar:** Ningún bearer inválido autentica; email sin verificar no se presenta como credenciales incorrectas; snapshot/caducidad/versión revalidados; factor y bearer no se consumen por validación fallida; cuenta bloqueada no se recupera. Medidores de contraseña coherentes con la política generada. Sesión distinta del propietario del enlace no pierde identidad por accidente.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/AuthEmailTokenTest.php`, `backend-laravel/tests/Feature/PasswordNoticeAtomicityTest.php`, `backend-laravel/tests/Feature/SecurityNoticeAtomicityTest.php`, `backend-laravel/tests/Feature/SecurityCenterTest.php`, `backend-laravel/tests/Feature/SessionManagerTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S02: Cuenta, exportación, borrado y derechos

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/AccountController.php`
- `backend-laravel/app/Http/Controllers/PrivacyRightsController.php`
- `frontend/src/app/panel/settings`

**Funciones/dependencias:** Solicitud/generación/descarga/acuse/cancelación de exportaciones; impacto, confirmación, cancelación y anonimización de cuenta; solicitudes de derechos. Leer GenerateDataExportJob, PrivateArtifactCleanup y etapas correspondientes de UvhHousekeeping.

**Contratos a demostrar:** Exportaciones privadas y acotadas; no acceso con sesión revocada; archivo no borrado antes del commit; cancelación protectora conservada; auditoría durable incluso durante fallos. No reutilizar filas con cancelación pendiente. Compensaciones y ejecuciones automáticas no contradicen el estado mostrado.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/AccountDeletionSecurityTest.php`, `backend-laravel/tests/Feature/DataExportDownloadLifecycleTest.php`, `backend-laravel/tests/Feature/DataExportGenerationTest.php`, `backend-laravel/tests/Feature/PrivateArtifactTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S03: Workspaces, equipo e invitaciones

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/WorkspaceController.php`
- `backend-laravel/app/Http/Controllers/WorkspaceOnboardingController.php`
- `frontend/src/app/panel/team`
- `frontend/src/app/panel/getting-started`
- `frontend/src/app/panel/workspace-dialog.component.ts`
- `frontend/src/app/core/services/workspace.service.ts`

**Funciones/dependencias:** Crear/seleccionar/editar/borrar workspace; owner/admin/editor/viewer; invitación, aceptar/rechazar, revocar y transferir propiedad. Revisar cada rol y los locks de WorkspaceMutation.

**Contratos a demostrar:** Ningún ID permite cruzar workspaces; permisos revalidados tras cambios concurrentes; siempre existe propietario válido; correo de invitación y autoridad coinciden; una respuesta de workspace anterior no modifica el nuevo.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/WorkspaceOwnershipGuardTest.php`, `backend-laravel/tests/Feature/WorkspaceMemberSearchTest.php`, `backend-laravel/tests/Feature/InvitationAuthorityLifecycleTest.php`, `backend-laravel/tests/Feature/InvitationExpiryTest.php`, `backend-laravel/tests/Feature/WorkspaceOnboardingTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S04: Enlaces, plantillas, etiquetas y colecciones

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/LinkController.php`
- `backend-laravel/app/Http/Controllers/LinkBulkController.php`
- `backend-laravel/app/Http/Controllers/LinkCsvController.php`
- `backend-laravel/app/Http/Controllers/TagController.php`
- `backend-laravel/app/Http/Controllers/CollectionController.php`
- `backend-laravel/app/Http/Controllers/LinkTemplateController.php`
- `frontend/src/app/panel/links`

**Funciones/dependencias:** CRUD, filtros/paginación, alias/destino, protección, campañas, caducidad, papelera/restauración/purga, CSV y acciones masivas. Leer LinkService, WorkspaceLimits y modelos compartidos.

**Contratos a demostrar:** Sin cambios parciales en operaciones atómicas; versiones obsoletas rechazadas; CSV acotado y sin inyección de fórmulas; cuota bajo concurrencia; filtros y selección no conservan filas de otro contexto; teclado/QR/copiar no activan navegación accidental.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/LinkTrashTest.php`, `backend-laravel/tests/Feature/LinkBulkIdempotencyTest.php`, `backend-laravel/tests/Feature/LinkCsvTransferTest.php`, `backend-laravel/tests/Feature/TagManagerTest.php`, `backend-laravel/tests/Feature/CollectionManagerTest.php`, `backend-laravel/tests/Feature/LinkTemplateTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S05: Redirecciones y handoffs públicos

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/RedirectController.php`
- `backend-laravel/app/Http/Controllers/LinkIntentController.php`
- `backend-laravel/app/Http/Controllers/PendingHandoffController.php`
- `frontend/src/app/auth/invitation-accept.component.ts`
- `frontend/src/app/core/services/pending-link-intent.service.ts`
- `frontend/src/app/core/services/pending-invitation.service.ts`

**Funciones/dependencias:** Resolver raíz/alias, unlock, destino protegido, host público/custom, intención pendiente, parking y finalización. Leer RedirectService, LinkIntentRegistry y vistas públicas Laravel.

**Contratos a demostrar:** Host y dominio elegible comprobados; destino autorizado; consumo único/max-clicks bajo concurrencia; bearer explícito inválido no cae a cookie alternativa; TTL y revocación efectivos; errores públicos seguros sin stack trace.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/RedirectAdmissionTest.php`, `backend-laravel/tests/Feature/RedirectConcurrencyTest.php`, `backend-laravel/tests/Feature/PendingHandoffTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S06: Dominios, DNS, TLS y edge

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/DomainController.php`
- `backend-laravel/app/Http/Controllers/EdgeController.php`
- `frontend/src/app/panel/domains`

**Funciones/dependencias:** Alta, claim, verificación, diagnóstico, estado deseado/observado, suspensión/borrado, traslado y Caddy ask. Leer VerifyDomainDnsJob, ProbeDomainTlsJob, ProvisionDomainTlsJob y DispatchDomainEventsJob.

**Contratos a demostrar:** DNS/TLS no declarados listos antes de verificarlos; owner/claim vigente; carreras de transferencia no autorizan dominio antiguo; consultas/probes no permiten SSRF; interfaz diferencia pending/error/stale y conserva recuperación.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/DomainDiagnosticsTest.php`, `backend-laravel/tests/Feature/DomainClaimLockOrderTest.php`, `backend-laravel/tests/Feature/DomainIdempotencyTest.php`, `backend-laravel/tests/Feature/AutoTlsProvisioningTest.php`, `backend-laravel/tests/Feature/DomainTlsProbeTest.php`, `backend-laravel/tests/Feature/DomainVisitorSurfaceTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S07: API tokens e integraciones

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/TokenController.php`
- `frontend/src/app/panel/tokens`

**Funciones/dependencias:** Creación con scopes, presentación única del secreto, revocación, expiración y autenticación de máquina. Leer middleware de API tokens y autorización por workspace.

**Contratos a demostrar:** Scope mínimo y rol vigente; secreto nunca reaparece ni se registra; token revocado/expirado no accede; formatos ambiguos rechazados; revocación durable; respuestas tardías no muestran secreto en otra cuenta/workspace.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/ApiTokenSchemeTest.php`, `backend-laravel/tests/Feature/CredentialStepUpContractTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S08: Webhooks y tráfico saliente

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/WebhookController.php`
- `frontend/src/app/panel/webhooks`

**Funciones/dependencias:** Alta/editar/borrar, prueba, inspección, reintento, firma, event ID, entrega y abandono. Leer WebhookDeliveryJob y servicios de transporte/reputación.

**Contratos a demostrar:** SSRF incluyendo DNS cambiante, IPv6, redirects y IP privada; firma/verificación correctas; lease y budgets acotados; secretos redaccionados; entrega no duplica efectos locales; prueba manual no dispara destinos reales sin intención explícita.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/WebhookQueueLeaseTest.php`, `backend-laravel/tests/Feature/WebhookInspectorTest.php`, `backend-laravel/tests/Feature/WebhookEventCatalogTest.php`, `backend-laravel/tests/Feature/SsrfTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S09: Analítica, actividad, dashboard y uso

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/AnalyticsController.php`
- `backend-laravel/app/Http/Controllers/WorkspaceActivityController.php`
- `backend-laravel/app/Http/Controllers/WorkspaceUsageController.php`
- `frontend/src/app/panel/analytics`
- `frontend/src/app/panel/activity`
- `frontend/src/app/panel/dashboard`
- `frontend/src/app/panel/usage`

**Funciones/dependencias:** Rangos, zona horaria, rollups, desglose, CSV, snapshot/cache, actividad e indicadores/cuotas. Leer RecordClickAnalyticsJob y políticas de retención.

**Contratos a demostrar:** Resultados consistentes con filtros y límites; acceso estrictamente por workspace; sin fugas de PII; caché aislada/invalidation; estados sin datos, error y carga distintos; gráficos/tablas legibles en móvil y exportación fiel.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/AnalyticsRollupMapTest.php`, `backend-laravel/tests/Feature/AnalyticsExportTest.php`, `backend-laravel/tests/Feature/WorkspaceActivityTest.php`, `backend-laravel/tests/Feature/WorkspaceUsageTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S10: Notificaciones, correos y auditoría

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/NotificationController.php`
- `frontend/src/app/panel/notifications`
- `frontend/src/app/core/services/notification.service.ts`

**Funciones/dependencias:** Bandeja, leído/preferencias, digest, correo/outbox, templates, revocación de envelopes obsoletos y trazabilidad. Leer UvhMail, MailDeliveryEligibility, DeliverMailOutboxJob, UvhNotificationsDigest y Audit.

**Contratos a demostrar:** Correo no anuncia un commit revertido; destinatario y generación vigentes; reintento/idempotencia; enlaces válidos y copy fiel al estado; evento exacto durable, recurso/actor correctos y sin secretos; no fuga al cambiar identidad.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/NotificationCenterTest.php`, `backend-laravel/tests/Feature/MailPresentationTest.php`, `backend-laravel/tests/Feature/MailTransportTest.php`, `backend-laravel/tests/Feature/AuditOutboxRecoveryTest.php`, `backend-laravel/tests/Feature/AuditWorkspaceAttributionTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S11: Administración, abuso y reputación

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/AdminController.php`
- `frontend/src/app/panel/admin`

**Funciones/dependencias:** Usuarios/bloqueos/roles, recuperaciones y dos aprobadores, informes/apelaciones, destinos y moderación. Leer CheckDestinationReputationJob y ContinueDestinationSweepJob.

**Contratos a demostrar:** Admin+MFA fresh en cada mutación; separación de aprobadores y solicitante; último admin protegido; bloqueo cancela accesos pendientes; autorización vigente bajo bloqueo; paginación/budgets; fallos parciales no confirman decisiones inexistentes.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/LinkAppealTest.php`, `backend-laravel/tests/Feature/DestinationReputationTest.php`, `backend-laravel/tests/Feature/HttpReputationProviderTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S12: Páginas públicas y diseño transversal

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/PublicController.php`
- `frontend/src/app/auth/auth-shell.component.ts`
- `frontend/src/app/panel/panel.component.ts`
- `frontend/src/app/legal`

**Funciones/dependencias:** Landing, ayuda, legal, estado público, formularios públicos; navegación, diálogos, responsive, foco, tema claro/oscuro y estados de error. Descubrir componentes reales con rg --files antes de asignar cambios.

**Contratos a demostrar:** Navegación coherente; deep links funcionales; sin overflow a360/390px; controles y mensajes distinguibles sin color; foco visible/restaurado; nombres accesibles y errores vinculados; no dar disponibilidad falsa ante infraestructura desconocida.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/PublicStatusTest.php`, `backend-laravel/tests/Feature/SecurityHeadersTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

### S13: Operación, seguridad transversal y release

**Estado:** pendiente de revisión completa.

**Archivos de entrada verificados:**

- `backend-laravel/app/Http/Controllers/OperationsController.php`
- `docker-compose.local.yml`
- `docker-compose.production.yml`
- `scripts`
- `.github/workflows`

**Funciones/dependencias:** Middleware/CSRF/CORS/hosts/proxies, secretos, cifrado/rotación, migraciones, scheduler/colas, health/readiness/métricas, dependencias, backups y CI. Leer bootstrap/app.php, ProductionSecurity y todos los comandos/Jobs que aún no tengan propietario.

**Contratos a demostrar:** Config de producción falla cerrada; migraciones y código compatibles; clocks/TTLs/budgets coherentes; queue con lease/retry/idempotencia; health no filtra secretos; recuperación/rollback probados; evidencia local no sustituye TLS/proveedores/alertas/datos/CI reales.

**Pruebas existentes a leer:** `backend-laravel/tests/Feature/DatabaseSchemaTest.php`, `backend-laravel/tests/Feature/SecurityLimiterStoreTest.php`, `backend-laravel/tests/Feature/RateLimitFailoverTest.php`, `backend-laravel/tests/Feature/QueueBacklogTest.php`.

- [ ] Asignar todas las acciones de este sistema y sus helpers/jobs a la matriz, con roles y estados.
- [ ] Revisar código y contratos indicados; registrar hallazgos con referencias concretas.
- [ ] Reproducir cada defecto confirmado, corregir su causa y verificar regresión sin ampliar permisos.
- [ ] Verificar UI/correo cuando corresponda, incluyendo fallos y respuestas tardías.
- [ ] Cerrar evidencia por función y actualizar informe/pendientes antes de cambiar de sistema.

## Criterio de cierre global

- [ ] Las185 rutas y las entradas adicionales de Jobs/comandos/servicios/frontend tienen propietario y revisión de código terminada; no quedan filas sin evidencia o sin motivo explícito de exclusión.
- [ ] No quedan fallos críticos/altos confirmados sin corregir; cada corrección tiene prueba del síntoma original y de sus fronteras de seguridad.
- [ ] Sistemas S01–S13 pasan sus contratos y no contradicen las funciones vecinas.
- [ ] Suites/calidad/build y puertas de integración pertinentes pasan sobre el estado final, con logs fechados.
- [ ] Pantallas/correos críticos revisados en móvil/escritorio, claro/oscuro, teclado y recuperación de errores; accesibilidad manual de lector de pantalla separada de comprobaciones automáticas.
- [ ] Informe final distingue implementación verificada, riesgos residuales y requisitos de producción dependientes de DNS/TLS, proveedores, CI, alertas recibidas, backups reales, capacidad y revisión jurídica.

## Revisión del propio plan

Cobertura: todos los controladores con rutas tienen sistema; las closures/framework y middleware transversal se asignan a S13/S12 según pertinencia al revisarlas. AccountController/PrivacyRights cubren datos/ciclo de cuenta; Public/Edge/Operations incluyen superficies no API. Jobs/comandos se añaden por método antes de cerrar sistema, sin omitir trabajo porque no tenga endpoint. Las pruebas citadas existen; los nombres de archivos se verificaron en el árbol actual. No se presupone que todo hallazgo histórico esté cubierto por pruebas actuales.


S01 B112–B115/O05 (2026-10-02): seis confirmaciones de mutaciones ahora decodificadas en ejecución, evitando éxito falso en registro/corrección, logout, cambio de contraseña y cancelación/acuse de exportación. Cinco reutilizan ok:true y registro requiere user:null; no cambia admisión/autorización backend ni política de reintento.44regresiones (baseline34fallos/10correctas; green44), frontend834/lint/tipos/build correctos; backend66/915 en uvh_test y browser4contextos/16POST simulados correctos. Inventario440archivos/2141funciones con nombre/1128callbacks/3firmas con líneas y hashes, propietarios propuestos y conciliación pendiente; no es cobertura de revisión. Véase informe completion e inventario2026-10-02. S01 parcial, S02–S13/producción pendientes. Sin nuevo full backend ni entrega/proveedor real.


Cierre definitivo de este lote (sin cierre de sistema): ajustado el aviso de logout del panel para no afirmar sesión vigente ante confirmación fallida. Después de ese último cambio:834/834frontend y lint/typecheck/build exit0 (s01-account-mutations-full-frontend-definitive.log). Inventario regenerado y440hashes contrastados con el árbol actual; Node --check y php -l correctos. Browser definitivo4contextos/16POST, foco y geometría, capturas390oscuro/1440claro inspeccionadas; backend66/915 específico, sin cambio productivo PHP. diff --check correcto. S01 parcial; objetivo activo, siguiente paso conciliación de funciones/helpers y UI MFA/cambios autenticados pendientes.


S01 B116–B118/O06 (2026-10-02): edición OTP conserva posiciones/invalida huecos, reset/completado correctamente; métodos MFA/recovery se serializan durante verificación; foco/modal/tab y caducidad/error/Escape conservan paso vigente.15regresiones nuevas, final52dedicadas; frontend849/lint/tipos/build correctos; browser4contextos/32POSTsimulados; backend77/541+filtro separado14/82 en uvh_test, sin sumar como suite completa. Ledger52funciones leídas/11archivos con fronteras pendientes explícitas; inventario440/2143con nombre/1127callbacks/3firmas y propuestas de propiedad refinadas. S01 parcial; todos los sistemas/objetivo conservan alcance. Informe completion y ledger2026-10-02 contienen evidencia y límites.


S01 B119/B120/O07 (2026-10-02): navegación después de autenticar maneja cancelación y fallo con reintento sin credenciales ni factores, con generación/flujo/foco protegidos. Caducidad MFA ahora excluye el instante expiresAt; status y step-up coinciden y factor no se consume al caducar. Frontend864, controles dedicados67, calidad/build correctos; backend filtro85/572 y Pint421/PHPStan0; full backend1251/8941 aserciones correcto,209,09s en uvh_test. Browser12 recorridos/20 POST simulados sin repetir credenciales. Inventario440/2146 con nombre/1128 callbacks/3 firmas; ledger59 lecturas explícitas, aún parcial. Detalle y límites en informe completion y ledger; S01–S13 abiertos.


S01 B121/B122/O08 (2026-10-02): reautenticación maneja navegación fallida con reintento sin otro factor, conservando contexto/vida/roles/busy/foco; promoción exige MFA utilizable bajo lock y conserva legacy/keyring. Destino de retorno usa regla compartida. Vectores TOTP oficiales19/23 aserciones; backend completo1274/8983 aserciones y frontend885/calidad/build correctos. Browser8 recorridos/4 POST simulados, status una vez y factor como máximo una vez. Autorretorno /auth no reprodujo bloqueo por renovación del componente. Ledger77 lecturas/16 archivos e inventario440/2148 con nombre/1129 callbacks/3 firmas; S01–S13 mantienen pendientes. Detalle y límites en informe completion.


### Desviación de orden — contrato compartido de auditoría (02/10)
Se adelanta lectura y corrección parcial S03: las doce mutaciones explícitas de WorkspaceController admiten auditoría después del commit. El patrón afecta autoridad, consumo de credenciales y avisos, y justifica resolver esta causa compartida antes de extraer Auth. Regresión en base aislada y evento exacto recuperable, sin marcar S03 ni S01 cerrados. La propuesta de deuda técnica se aplica de forma incremental: fallos confirmados, CI/trazabilidad, contratos, servicios/estados Auth y optimización medida.


S01/S03 B125/O09–O10 (02/10): revalidación de sesión concreta bajo lock en las doce mutaciones de workspace y conservación del bearer ante identidad obsoleta; contexto compartido con Auth sin cambiar política de sus callers. Primera separación Auth implementada: LoginAdmission y MfaChallengeStore, preservando TX/audit/TTL/keys y respuestas.251 contratos/1636 aserciones; Pint428/PHPStan0 con baseline activo. Inventario444/2158 funciones con nombre/1130 callbacks/3 firmas y hashes actuales; ledger S01 95/19. Full final1431/10041 correcto; detalle en informe/ledgers/contrato. S01–S13 y gates externos siguen abiertos.


Verificación definitiva del árbol final B125/O09–O10:1431/1431 backend,10041 aserciones,249,51s en uvh_test (s01-auth-extraction-full-backend-final.log), exit0. Pint428/PHPStan0 con baseline existente y sin ampliación (s01-auth-extraction-quality-final.log), exit0. Último cambio PHP ID0/000 incluido en esta suite. Inventario444/2158 con nombre/1130 callbacks/3 firmas;444 hashes y anchors de ambos ledgers actuales, Node --check y git diff --check correctos. Backend97 regresiones nuevas frente al full1334 anterior; frontend no modificado en este lote y no se acredita nueva ejecución de su suite. S01–S13 y objetivo global abiertos; siguiente extracción admisión final TOTP/recovery según plan. CI billing permanece externo pendiente. No DB local, migración, proveedor, worker/scheduler, commit/push ni despliegue.


S01 B126/O11 (02/10): segundo paso Auth extrae admisión SQL TOTP/recovery y factores compartidos con StepUp/enrollment, preservando locks/TX/keys/TTL/replay. Traslado89/606 antes/después; B126 corregido después de red4fallos/2controles: cuenta obsoleta no cobra intento de recovery ni registra factor incorrecto. Final91/640;Pint430/PHPStan0 y baseline191→188. Inventario446/2160/1130/3 con hashes actuales, ledger101/21; full final1441/10137 correcto,269,95s. Detalle/alcance en informe/ledger S01; S01–S13 permanecen abiertos.


Verificación final B126/O11:1441/1441 backend,10137 aserciones,269,95s en uvh_test (s01-mfa-admission-full-backend.log), exit0; incluye10 casos nuevos frente a1431 anterior. Pint430/PHPStan0, baseline191→188 con sólo3 entradas resueltas retiradas (s01-mfa-admission-quality-final.log), exit0.91/640 contratos dedicados y traslado89/606 antes/después. Inventario446 archivos/2160 con nombre/1130 callbacks/3 firmas;446 hashes y101/16 anchors S01/S03 comprobadas. Ledger S01 101 funciones/21 archivos, todavía parcial. Node --check y git diff --check correctos, sin cambio de PHP después de la suite. Frontend no modificado ni nueva ejecución/browser atribuidos a este lote. Auth y objetivo global S01–S13 siguen abiertos; siguiente RegistrationEdit/registro/verificación antes de extraer su admisión. CI billing conocido y gates de producción permanecen externos. Sin migración, DB local, proveedor, worker/scheduler, commit/push ni despliegue.


S01 B127/O12 (02/10): registro/activación separados conservando admisión SQL completa y compatibilidad legacy; deadline exclusivo del permiso de edición corregido. Full1451/10213 correcto,257,75s en uvh_test; Pint434/PHPStan0 con baseline186. AuthController2637líneas; funciones restantes siguen pendientes, S01–S13 abiertos. Evidencia y siguiente bloque de corrección/reenvío en informe y ledger S01.


### Corrección prioritaria siguiente: B129, recibo de registro y privacidad compuesta

Requisito: un cliente anónimo con cookies de su propio signup no puede distinguir User/pending ajeno/reserva/dirección libre mediante secuencias de login/corrección/reenvío, conservando corrección de typo, aviso de verificación de cuentas sin verificar con contraseña correcta y single-use bajo lock. No basta un200 común o cifrar claim si capacidades posteriores difieren.

Diseño a concretar y contrastar con fuente: representar el intento de registro como recurso propio en todos los desenlaces (libre/ocupado), con generación y caducidad, separado de la cuenta y de quién controla el buzón. Su estado público no debe revelar si está asociado a un pending real. Corregir el destino del intento bajo lock y rotar su generación en todos los ACK; nunca modificar User ni pending ajeno. La prueba del email sigue siendo obligatoria para crear cuenta/workspace/password/consentimientos. Adaptar compatibilidad de cookies previas sin abrir una vía de enumeración ni permitir gastar dos veces la misma autoridad.

Puertas antes de implementar: tablas/modelos/limpiado e invariantes de registro/token/outbox/audit y lock order, todos los callers RegistrationEdit y lógica de orientación frontend/login. Puertas después: llevar probe a regresión permanente con User verificado/no verificado/deleted, pending ajeno, reserva vigente/caducada y libre; secuencias y concurrencia con ambos cookies; rechazos secret/expiry/version/sessionless, snapshots/rollback/admisión mail/audit, UI sin afirmaciones indebidas, migración/rollback en *_test, full y gates restantes. Evitar solución que meramente esconda errores pero deje el oráculo en otra secuencia. No migrar uvh_local ni desplegar durante preparación.


S01 O13/B128 (02/10): corrección/reenvío extraídos, emisión pending/legacy unificada, cookie v3 con lectura v2 y rangos completos. Full habitual1480/10386,258,44s, y calidad437/PHPStan0 correctos. B129(P2) confirmado y abierto: un signup anónimo obtiene201 uniforme pero sus posteriores login/corrección distinguen dirección libre de ocupada. Probe separado falla; full verde no prueba privacidad ni finalización. Prioridad siguiente B129 según plan maestro; resto S01–S13 y gates externos pendientes.


O14/B129/B130 (03/10): intento de registro durable independiente de ocupación, cookie v4 y compatibilidad v2/v3, corrección coherente y single-use para todos los ACK. El aviso de login describe la solicitud; contraseña correcta conserva prioridad. Activación y retención comparten raíz estable/contexto antes de pending; purga conserva una renovación confirmada durante su espera. Probe original B129 ahora es regresión permanente; B130 reproducido rojo y corregido. Suite completa1527/1527 backend,11020aserciones,348,85s sólo uvh_test (s01-registration-attempt-full-backend.log), exit0;47 casos nuevos frente a1480.198/2255 contratos dedicados (98,94s, s01-registration-attempt-contracts-definitive.log). Pint442/PHPStan0 (s01-registration-attempt-quality-final.log), exit0, baseline sin ampliar. Frontend885/885 y lint/tipos/build correctos, sin nueva revisión visual manual/browser de API local. Inventario452/2176con nombre/1134callbacks/3firmas,452hashes y136anchors S01/28archivos más16S03/2archivos verificados; captura actual03/10, nombre histórico02/10. AuthController2488→2438líneas; no se atribuye ahorro de latencia global. Migración aplicada/verificada sólo uvh_test con guard explícito; NO aplicada uvh_local. Esquema y recambio coordinado de código/procesos pendientes antes de usarlo en otro entorno. S01–S13 y objetivo global siguen abiertos; próximo bloque admisión forgot/reset y helpers compartidos, más gates externos/CI billing sin cambio. Sin entrega real, worker/scheduler productivo, commit/push ni despliegue.


O15/B131 (03/10): PasswordRecovery extrae completas las transacciones de solicitud/reset, SecurityIncidentNotice reúne los avisos de contraseña y sesiones, y CredentialChangeResponse conserva la limpieza de cookie sólo para la cuenta afectada. Seis cuerpos comparados sin cambios de orden/política. AuthController2438→2289líneas; mejora de organización, sin ahorro de latencia/consultas medido.17 nuevas caracterizaciones;151/1246 antes y después. Full1544/1544 backend,11155aserciones,336,31s sólo uvh_test (s01-password-recovery-full-backend.log), exit0. Pint446/PHPStan0 (s01-password-recovery-quality.log), exit0; baseline184→182 findings/171entradas, sólo dos return types resueltos retirados. B131(P3): registro prometía otras24h y disponibilidad de URL sin renovar su deadline ni confirmar existencia. Rojo2fallos/66controles; texto condicionado a caducidad/disponibilidad, sin cambiar TTL/bearer/API; Auth68/68 y frontend887/887, lint/tipos/build correctos. Inventario455/2179con nombre/1134callbacks/3firmas,455hashes y150anchors S01/31archivos más16S03/2archivos comprobados. No nueva revisión visual/browser/E2E atribuida. S01–S13 y objetivo global siguen abiertos; siguientes fronteras: revocación protectora con evidencia recuperable y recuperación de cuenta, luego módulos restantes. CI billing y gates reales externos siguen pendientes. Sin migración, modificación de uvh_local, correo real, worker/scheduler productivo, commit/push ni despliegue.


O16/B132/B133 (03/10): revocación protectora conserva evidencia recuperable ante fallo de admisión audit general; cancelación de borrado no se revierte por logging de fallback roto. TX completa separada en CompromisedAccessRevocation, sin cambiar autoridad/bloqueo/MFA/cookie ni SQLorder. Contratos99/1105 y Pint452/PHPStan0; baseline180 findings/169entradas, sin nuevos ignores. Schema incident receipts aplicado sólo uvh_test, NO uvh_local; down protege pendientes, no backfill histórico. Gauge privado y alerta15min preparados, YAML7reglas validado, sin promtool/scheduler/alerta real atribuida. Full backend definitivo1568/11349,337,83s,exit0 (s01-incident-full-backend.log). Inventario457/2183/1137/3, ledgerS01 158/35 aún parcial. S01–S13/global siguen abiertos: recuperación de cuenta y funciones/roles/gates externos restantes. Detalle y evidencias en informe completion. Sin frontend nuevo/browser/entrega real/commit/push/despliegue.


O16/B132/B133 verificados (03/10): full1568/1568 backend,11349aserciones,337,83s exclusivamente uvh_test (s01-incident-full-backend.log), exit0;24 controles nuevos frente a1544.99/1105 dedicados,22,28s (s01-incident-contracts-definitive.log), exit0. Pint452/PHPStan0 (s01-incident-quality-final-fixed.log), exit0; baseline182→180 findings/169entradas, dos supresiones resueltas retiradas y ninguna añadida. B132 conserva evidencia recuperable sin revertir revocación por audit general; B133 impide rollback de cancelación por logger de fallback. TX incidente completa comparada tras extracción, AuthController2289→2220líneas; sin latencia/consultas ahorradas medidas. Inventario457archivos/2183con nombre/1137callbacks/3firmas,457hashes y158anchorsS01/35archivos más16S03/2archivos comprobados tras full. YAML7reglas completas únicas validado, Node--check/diff correctos; no promtool/monitorización real atribuida. Migración2026_10_03_000002 aplicada sólo uvh_test con guard; uvh_local intacta, sin backfill histórico. Frontend sin cambio/nueva ejecución/browser atribuidos. S01–S13/objetivo global activos: siguiente separación request/confirm/complete recovery con caracterización previa y resto de funciones/roles/gates externos pendientes. CI billing conocido permanece externo. Sin proveedor real, worker/scheduler productivo, commit/push/deploy.


O17/B134 (03/10): request/confirm/complete recovery separados conservando TX completas.103/765 antes/después y139/991 final. B134 cookie sólo propia + current estricto/estadoSPA/generación:2redAPI y5redfrontend, corregidos; frontend50dedicados y895full actuales. Pint454/PHPStan0, baseline177/166 sin nuevos ignores; AuthController1985líneas. Inventario458/2187/1137/3 y ledger176/42 aún parcial. Full backend1600/11589,338,08s verificado; lint sólo test corregido por if/else y gatesfrontend895/lint/tipos/build definitivos exit0. No nueva migración/DBlocal/browser/proveedor real. Global S01–S13 y gates externos abiertos; cleanup físico/fallbacks y resto Auth pendientes. Detalle en informe completion.


O17/B134 verificados (03/10): full1600/1600 backend,11589aserciones,338,08s exclusivamente uvh_test (s01-account-recovery-full-backend.log), exit0;32 casos nuevos frente a1568.103/765 antes/después del traslado,139/991 dedicado final,36,63s; Pint454/PHPStan0 (s01-account-recovery-quality-final.log), exit0. Baseline180→177 findings/166entradas, sólo3 retornos resueltos eliminados. AccountRecoveryAdmission conserva tres TX completas comparadas; AuthController2220→1985líneas. B134 cookie sólo propia/current booleano y SPA con generación/validación/destruction/nueva identidad: redAPI2fallos/1control, redfrontend5fallos/3controles;50dedicados pasan. Fullfrontend895/895 definitivo (s01-account-recovery-full-frontend-definitive.log), lint/tipos/build definitivos exit0. Lint inicial señaló ternario de assert; sustituido por if/else sin relajar regla ni tocar PHP. Inventario458archivos/2187con nombre/1137callbacks/3firmas;458hashes y176anchorsS01/42archivos más16S03/2archivos verificados tras full. Node--check/gitdiff--check correctos. Sin ganancia de latencia/SQL medida ni nueva concurrencia multiproceso/QA visual/E2E/proveedor atribuida. No nueva migración/uvh_local/worker/scheduler/commit/push/deploy. Objetivo yS01–S13 abiertos; siguiente frontera cleanup físico/fallback en callers Auth y resto de mutaciones/lecturas/frontends/roles por función. CI billing conocido y gates reales externos mantienen estado.


O28 verificación final (03/10): B149(P2) orden de probes/DTO confirmado/publicación nested await; B150(P2) epoch/workspace/rol al observar otra cuenta; B151(P1) intención frontend distinta del actor cookie, precondición server y limpieza sólo de proyección; B152(P2) regresión de settlement de startup detectada durante el nuevo hardening, con probe más nuevo401/503 que cancelaba init. Signout definitivo también normaliza probe, sin atribuir a ese caso un bloqueo de AuthCard (loadedtrue ya la muestra).73controles nuevos (46frontend/27backend): rojo Auth11/13, interceptor8/19, backend18/27, publicación2/20 yprobe3/23.111/111 dedicado definitivo0,111s Karma/0,103s y996/996 full frontend5,411s Karma/5,038s, exit0 (`s01-observed-identity-full-frontend-probe-final.log`); lint/tipos/build11,563s definitivos exit0.126/1058 backend específico33,24s yPint472/PHPStan0 exit0. Full backend directo1820/1820,13770aserciones,360,394s/127MB exclusivamenteuvh_test,exit0 (`s01-expected-account-full-backend-raw-final.log`), JUnit1820/13770/errors0/failures0/skipped0;27casos/180aserciones corresponden al nuevo ExpectedAccountBoundaryTest.

La primera suite Artisan salió2 al imprimir WorkspaceAuditAtomicity, sin resumen; no se acredita ni se atribuye causa. Diagnóstico aislado133/935/22,77s pasa. Primer raw+JUnit falló255antes de tests por intentar escribir en mount/ro, corregido a /app/storage/logs. Fuente PHP/tests estable durante cada suite ysin cambios para saltar contratos. El full directo tiene evidencia completa; investigar la primera salida anómala queda como límite S13. Los fallos de fixtures (factory-vs-fresh, token422, unionPromise TS2345 yworkspace read nueva) están registrados sin bug de producto atribuido.

Reutilizar LatestRequest evita otra implementación de cancelación/revisión; init/me y confirmed DTO tienen propiedad explícita, double guard sin await antes de publicar y generation compartida. No se atribuye ahorro de latencia/SQL ni nueva extracción backend: baseline161/150, controlador1408, tres TX previas comparadas intactas. Inventario469archivos/2229named/1148callbacks/3firmas y0ownersprovisionales;469hashes y293S01/60files+16S03/2+63S10/9anchors verificados. QA sólo fixture1440×1000 de409: sinUser/inbox anterior, /auth, loaded/probe true, marker null, capturas inspeccionadas. No nuevaQAvisual específica deB152, autofoco/teclado completo/móvil/vídeo/login real/backendE2E/cookie race/proveedor/CORS producción acreditados. Owned browser/servers/tool handles cerrados; sesión ajena intacta.

Header esperado es opcional yno autoridad ni sustituto de CSRF/roles/verified/locks; legacy ypublicbearer conservados. No retira write/Set-Cookie ya enviado. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13 ygates reales/CI billing histórico siguen abiertos; Next Step [writers simultáneos de DTO del mismo User](superpowers/plans/2026-10-03-auth-dto-writers.md), candidato de código aún sin ID, más restantes funciones/roles/UX/operación. No marcar cierre global por estas suites.
