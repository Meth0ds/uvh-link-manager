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

**Estado:** en curso. Fronteras locales de privacidad y exportación verificadas O31–O40; borrado, funciones y gates restantes pendientes de revisión completa.

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


## O29 — perfil/email concurrentes y separación frontend Auth (03/10)

**B153/P2 — snapshot User sin revisión reemplazaba cambios ya confirmados de la misma cuenta.** Los tres writers sustituyen toda la proyección: profile atrasado quitaba o restauraba pendingEmail; email/cancel atrasado borraba el nombre; un DTO de profile capturado antes de MFA rebajaba flags UI después de leerlos o cancelaba el read post-MFA iniciado entre commit y entrega. No autorización por flags ni bypass backend atribuido. Lectura completa de los tres callers controller, ProfileAdmission/EmailChangeAdmission/SecurityContext/AccountReadContext/publicUser, decoders de identidad, Auth writers/lectores y callers Settings/dialog. Orden real de commits/snapshots fijado en fixtures, independiente de inicio HTTP o llegada.

**Corrección:** AccountProfileService separa transporte de nombre/email/cancel. AuthUserMutations agrupa commands inmediatamente despachados del mismo epoch/ID; sólo datos de control, ninguna password en cola, serialización o retry de writes. Solapamiento o read de identidad iniciado/publicado durante command exige un único /me al cerrar el grupo. Mantiene decoder/API/CSRF/expected-account/epoch y LatestRequest; comandos enviados no se cancelan. Un command aislado conserva un round trip; no ahorro de latencia general atribuido. El retorno AuthUser es ACK propio, no garantía de snapshot actual. Fallo de read conserva ACK confirmado y proyección conocida, con aviso persistente y botón de read manual deduplicado. Settings distingue cambio aplicado de datos sin refrescar; foco vuelve a #account si el control sigue elegido. aria-disabled mantiene foco durante espera y busy guard evita reenvío.

**Evidencia final:**22 nuevos controles frontend (17 AuthUserMutations con HTTP/API/interceptor/decoder reales y5 Settings). Rojo inicial5fallos/6; refinamiento post-MFA1/17; foco nuevo1/54 antes de corregirlo.147/147 dedicadas (0,423s Karma/0,392s), exit0 `s01-user-writers-contracts-final.log`. Full final1018/1018 (5,225s Karma/4,841s), exit0 `s01-user-writers-full-frontend-post-mfa-final.log`; lint/tipos/build8,677s, todos exit0. Full intermedios1015/1015 y1017/1017 fueron etapas anteriores al control post-MFA; sólo1018/1018 acredita el árbol final. Karma emite404 de fixture hcaptcha-frame como antes; no gate de proveedor atribuido. Node--check/gitdiff--check correctos.

**QA:** navegador aislado uvh-o29 y SPA/fixture HTTP propia (sin Laravel DB/mail/provider). Formularios reales: profile retenido tras capturar snapshot, request-email y cancel confirmados antes de liberar respuesta antigua; nombre y reserva/cancelación finales coherentes, error503 posterior presenta aviso sin rollback falso. Botón manual recupera estado sin repetir commands. Capturas success/failure/recovered y mobile-final inspeccionadas;390x844 sin overflow y Enter final retorna foco a #account. Caso anterior perdía focoBODY con native disabled; tests y browser detectaron/refinaron la UI nueva, no bug histórico adicional. Fixtures/JSON/capturas en `.uvh-runtime/s01-user-writers-browser/`; campos de commands registrados sin values de password. No gate de teclado completo, todas resoluciones/tema claro, cookie cross-tab nativa o E2E/proveedor real atribuido. Primeros handles de previews desaparecieron y el browser se reinició about:blank; tras confirmar handles ausentes se recuperó misma fixture, sin atribuir bug producto. Find-role fill/click fueron frágiles, refs y eventos DOM reales permitieron observar flujo; no cambios de Auth state por inyección para producir success. Todos los procesos/sesiones propios cerrados.

**Cobertura/fuentes:** inventario471files/2240named/1155callbacks/3firmas/0provisional;471 hashes comprobados,307anchorsS01/64files+16S03/2+63S10/9. Backend y PHP tests sin modificar ni ejecutar en O29;1820/13770/Pint472/PHPStan0 son verificación anterior O28, no nueva suite. Baseline161/150/AuthController1408 y comparación tresTX preservados. No DB/migraciones/uvh_local/cuentas/reales/proveedor/worker/scheduler/commit/push/deploy. Esta fase es progreso; **objetivo global y S01–S13 siguen abiertos**, CI billing histórico y gates externos pendientes. Siguiente revisión S01: restantes ACK de seguridad/MFA y sus refresh/callers, destrucción y transiciones, funciones aún sin ledger y revisión de roles/errores; separación gradual sólo tras caracterizar contrato completo.


## O30 — MFA en Ajustes y separación gradual de Auth (03/10)

B154/P2: sesiones revocadas no se recargaban tras enable/disable; B155/P2: estado MFA anterior reaparecía tras refresh fallido, incluido resumen superior; B156/P2: códigos vacíos/parciales/duplicados/invalidados por formato se aceptaban como éxito. Corregidos con incertidumbre explícita, protección de códigos confirmados, aviso de entrega perdida durante remount y reconciliación con writers de perfil/email. AccountMfaService separa cinco transports manteniendo lifecycle/autoridad en Auth.

35 controles nuevos; full final1053/1053,150dedicadas previas al ajuste final del resumen, lint/tipos/build11,705s exit0. QA fixture enable/regenerate, read fallido/manual/teclado, remount,1440/390px y resumen final verificados; sin DB/proveedor.472 hashes,339S01/16S03/63S10anchors; baseline161/150/AuthController1408 preservados. Evidencia, rojos, fixtures e incidencias en [reporte O30](../../project-completion-audit-2026-09-30.md). Backend1820/13770/Pint472/PHPStan0 es evidencia O28, no suite nueva.

Objetivo global yS01–S13 continúan abiertos; CI/gates externos pendientes. Siguiente: proyecciones restantes de Settings al cambiar identidad, callbacks clipboard/descarga y coherencia URI/secret. Son candidatos por leer/reproducir, sin IDs todavía. Separación gradual de Auth sigue dentro del trabajo autorizado.


## O31 — identidad y datos privados de Ajustes (04/10)

B157/P1: datos privados/drafts de Settings sobrevivían al cambio o eliminación de identidad. B158/P1: confirmación antigua de cancel export se enviaba para el actor nuevo (privacidad también intentaba enviar, pero owner backend limita la fila). B159/P2: resultados/callbacks antiguos podían alterar feedback/formularios/busy nuevos. Corregidos con cleanup/load centralizado, id/epoch/destroy/ref de overlays y propiedad tras awaits; timers/read antiguos retirados sin abortar/reintentar writes.

21 controles nuevos;116dedicadas,1074/1074 full final, lint/tipos/build17,422s exit0. QA fixture/read Auth instrumentado/confirmación real/remount/desktop/móvil; no cookie/provider/DB real.472hashes/339S01+16S03+63S10+53S02anchors verificados, baseline161/150/AuthController1408 preservados. [Reporte O31](../../project-completion-audit-2026-09-30.md) contiene rojos, fixtures y límites; backend O28 es evidencia anterior, sin nueva suite.

Objetivo global yS01–S13 abiertos. Siguiente: admisión de sesión concreta/bloqueo y auditoría/outbox de PrivacyRightsController; errores de export representados como ausencia; setup URI/secret y restantes roles/sistemas. Candidatos sin ID hasta reproducir. CI/provider/gates reales pendientes.


## O32 — solicitudes de privacidad y autoridad fresca (04/10)

- **B160/P1:** las tres mutaciones privadas no comprobaban la sesión exacta después de hydration; el listado privado tampoco revalidaba cuenta/sesión. Revocación, caducidad exacta, versión o cambio de propietario aún permitían commands y lectura del expediente. Reutilizar SecurityContext en TX y AccountReadContext en GET cierra las ventanas reproducidas.
- **B161/P1:** listado administrativo seguía exponiendo expedientes tras perder rol/MFA; adminAction aceptaba expires_at igual a now o rotación conjunta cuenta/sesión con snapshot antiguo. Se conserva usuarios ascendentes→sesión→expediente y se comparten contexto/version/expiry/freshness actuales.
- **B162/P2:** store/respond/cancel/adminAction admitían audit después de confirmar expediente/mensajes/inbox/mail. Fallo de audit_outbox dejaba el cambio sin evento exacto. Las cuatro admisiones ahora pertenecen a su TX; materialización de audit_events sigue siendo recuperable después del commit, sin copiar texto personal.

Rojo real49fallos/27controles,307aserciones/13,79s; fix inicial76/556/13,94s. Definitivo266/266 dedicado,1832aserciones/53,68s,110controles nuevos PrivacyRightsAdmissionTest; otras156son dependencias S01/S10 ya existentes. Se cubren52interleavings de autoridad,8fallos audit,4historial ausente,8commit/rollback exterior,4success,3fallos mail,15decisiones admin,9estados cerrados,2owner404 y5controles de duplicado/límite/listas/corrupción. PHP/tests estables durante suites.

Optimización de código: helper administrativo duplicado eliminado, política compartida por SecurityContext/MfaFreshness; seis retornos JsonResponse y dos PHPDoc concretados. Baseline161/150→153findings/142entradas, sólo8de PrivacyRightsController resueltos retirados, sin nuevos ignores. Calidad finalPint473/PHPStan0 exit0. No ahorro de SQL o latencia nuevo atribuido; batch existente1query de mensajes por página y0en página vacía comprobado.

**Full backend final:**1930/1930,14523aserciones,358,030s/133MB,exit0 (`s02-privacy-rights-full-backend.log`), exclusivamenteuvh_test. JUnit1930/14523/errors0/failures0/skipped0;110casos/753aserciones del nuevo PrivacyRightsAdmissionTest. JUnit en storage/logs/s02-privacy-rights-junit.xml. Verificación de fuente472files/2254named/1162callbacks/3firmas,0ownersprovisionales;472hashes y339S01/67files+16S03/2+63S10/9+61S02/10anchors coinciden. Enum≠revisión completa. AuthController1408 y comparación tresTX de revocación intactos.

Incidencia de fixture: primera suite ampliada265/266 pasó; corrupción usaba texto sin prefijo, soportado como legacyplaintext por UvhCrypto. Fixture corregida a ciphertext enc:v1: malformado; no cambio global de crypto ni bug adicional atribuido. Calidad inicial473/0 antes de tipos y format2files/1stylefix son pasos intermedios.

Frontend intacto:1074/1074/lint/tipos/build/QA O31 siguen evidencia previa, no nueva suite/browser. No migraciones, uvh_local, cuentas/mail reales, proveedores/workers/scheduler productivos, commit/push/deploy. **Objetivo global/S01–S13 siguen abiertos**, al igual que CI y gates de operación real. Siguiente acción: caracterizar los cuatro contratos de sesión de Auth según `2026-10-04-auth-sessions-transport.md` y separar sólo su transporte. URI/secret MFA y errores de export representados como ausencia siguen candidatos sin ID; sistemas y gates restantes abiertos.

O32 cierre local: hashes/anchors y JUnit verificados después del full; Node--check y git diff --check correctos. Todas las ejecuciones propias cerradas. No cierre del objetivo ni de S01–S13. Desviación acotada hacia S02 por datos privados de Ajustes y autoridad compartida S01; motivo y límites registrados.


## O33 — separación gradual del transporte de sesiones Auth (04/10)

AccountSessionsService extrae cuatro transports: list/revoke/revokeOthers/revokeAll. Auth mantiene fachada, generación, current protector, sessionExpired, workspace cleanup y marker entre pestañas. Cuatro métodos completos comparados mecánicamente con before: sólo expression API delegada; guard/effects/returns idénticos. Tres imports decoder pasan al módulo dedicado. Clase Auth actual659líneas. No bugID nuevo: optimización de responsabilidades y cobertura, sin ahorro de SQL/latencia atribuido.

46caracterizaciones nuevas HTTP/API/interceptor/decoders reales pasan antes de producto46/46 (0,251sKarma/0,239sejecución), preservadas después. Cubren GETregistryempty/truncated/options/abort/timeout, encodeID/headers/body, ACKmalformado/refusals sin falsologout, current local legado oconfirmadoserver, otros/all incluso0, guards CSRF/únicoretry ycontexto reemplazado. Reemplazo válido simulado: invalidarA→GETme sin expectativaA observaB→workspacesB; oldsuccess/401 no borraB ni repitewrite. No cookie nativa/backend/provider atribuido.

Cinco nuevos controles del callerSettings con Auth/API reales: navegación propia pese a cleanup, recarga de otrodevice, ACK inválido sin navegación, oldcurrentwrite frente aB, destroy sinfeedback aunque global signout confirmado siga válido.51controles nuevos totales respecto a1074O31. Definitivo174/174 dedicado (2,223sKarma/2,16sejecución), exit0; **full1125/1125** (7,715sKarma/7,198sejecución), exit0 `s01-sessions-transport-full-frontend-final.log`. Lintfinal/tipos/build10,512s exit0; producto estable, tipos/build fueron posteriores a extracción yanteriores a5testsnuevos, compilados en full final.

Errores/etapas: full1120 anterior y169dedicado anteriores a5controlescaller son intermedios. Consumer71/72 falló sólo por duración toast esperada4500 vs4000 existente; assertion ajustada a mensaje/conteo relevantes, sin modificar producción/policy. No defecto adicional atribuido.

Inventario473files/2258named/1162callbacks/3firmas/0ownersprovisionales; owner explícitoS01delmódulo.473hashes y352anchorsS01/68files+16S03/2+63S10/9+61S02/10 coinciden, comparación4facademethods, Node--check/diff correctos. No cierre de funciones/sistemas por mera enumeración. No DOM/CSS/cambiosPHP, DB/migraciones, cuentas/mail/proveedor, worker/scheduler/commit/push/deploy. Backend1930/14523/Pint473/PHPStan0/baseline153/142/AuthController1408 son evidencia O32 anterior, sin nueva ejecución atribuida. Todos handles propios cerrados.

Objetivo global yS01–S13 activos. Next Step: reproducir coherencia URI/secretMFA frente al emisor Totp ysu callerSettings antes de decidir fix; error exportstatus yotras funciones/roles/operación/CI siguen abiertos. Plan próximo `2026-10-04-mfa-setup-response-contract.md`.


## O34 — coherencia de las instrucciones de MFA (04/10)

**B163/P2 — el contrato de alta aceptaba instrucciones manuales y de QR incoherentes.** decodeMfaSetup sólo comprobaba texto no vacío y prefijo otpauth://totp/. Admitía secretos distintos, claves incompatibles con el generador, parámetros ausentes/duplicados o TOTP SHA256/8 dígitos/60 segundos, emisor engañoso y fragmentos. Settings mostraba el par como preparado; en un reemplazo iniciaba además la reconciliación de un ACK considerado válido. Es un defecto de contrato y consistencia/disponibilidad de UI, sin atribuir un bypass de autenticación.

**Corrección:** el decoder valida las nuevas instrucciones antes de que AccountMfaService/Auth/Settings las reciban: Base32 mayúscula de32 caracteres, mismo secreto manual y QR, exactamente cinco campos únicos conocidos (secret/issuerUVH/algorithmSHA1/digits6/period30), labelUVH con cuenta no vacía, un segmento crudo y authority correcta, sin controles, fragmentos ni rutas que la normalización pueda ocultar. Conserva el URI validado original. No cambia los secretos heredados de16–128 caracteres aceptados por Laravel, el transporte separado ni políticas de MFA/recovery/freshness. Un DTO inválido produce502 genérico sin secreto; replacement conserva resultado incierto y necesidad de lectura. No se repite el POST ni se afirma rollback: el pending factor o el consumo de recovery pueden haber sido confirmados en servidor.

**Evidencia del emisor:** lectura completa de generateSecret/provisioningUri, caller mfaSetup y admisión setup; ejecución pura de Totp en Docker sin bootstrap/DB. Tres payloads reales con fixture pública comparados exactamente con los positivos frontend, incluyendo plus/slash/hash/UTF8 codificados.100/100 muestras del generador cumplen el formato; esto no prueba entropía/RNG ni que el validador de email admita todos los ejemplos.

**Regresiones:** rojo83 casos:35 fallos/48 controles (1,143s Karma/1,119s ejecución), exit1 `s01-mfa-setup-red.log`; material de incoherencia reproducido por decoder/API/interceptor/Auth y Settings reales. Verde inicial93/93 (1,12/1,093s) fue intermedio. Se conservan negativas y se actualizan sólo los dos positivos antiguos de transporte y el positivo del decoder para usar el contrato real.54 controles nuevos respecto a1125:47 de decoder/HTTP y7 de Settings, incluyendo inicial/replacement inválidos y válidos, QR real, fallback de canvas con manual disponible, vista destruida y reemplazo legítimo de identidad (invalidaciónA→GETme sin expectativaA observaB→workspacesB), sin cancelar/repetir writes enviados.

**Verificación final:**242/242 dedicadas (3,302s Karma/3,204s ejecución), exit0 `s01-mfa-setup-contracts-final.log`; **1179/1179 full frontend** (7,517s Karma/6,99s ejecución), exit0 `s01-mfa-setup-full-frontend.log`. Lint/tipos/build8,049s exit0. DOM/CSS/políticas de Auth y backend sin cambios en esta fase; QA de estado/render en TestBed con HTTP simulado y biblioteca QR reales. No nueva prueba de navegador visual, cookie nativa, autenticador externo o proveedor.

Inventario473 archivos/2258 funciones con nombre/1164 callbacks/3 firmas/0 owners provisionales;473 hashes y353 anchors S01/68 archivos,16S03/2,63S10/9 y61S02/10 comprobados. Cuatro cuerpos completos de sesión de Auth siguen idénticos tras adaptar sólo transporte; facade659líneas. Baseline153/142, AuthController1408 y comparación tres TX de revocación preservados. Backend1930/14523/Pint473/PHPStan0 es evidencia anterior O32, sin nueva suite PHP/DB. Primer intento auxiliar de rebasar ledger falló por zip(strict) no disponible en el Python local antes de escribir; adaptación compatible aplicada y verificadores finales exit0. No bug adicional de producto atribuido.

Todos los handles propios cerrados. Sin migraciones, uvh_local, cuentas/mail/proveedores reales, workers/scheduler productivos, commit/push/deploy. **Objetivo global y S01–S13 siguen activos.** Next Step: caracterizar exportaciones de Ajustes frente a error visible representado como ausencia, polling silencioso, recuperación e identidad; decidir fix sólo después del rojo y mantener ACK vs refresh. Resto de funciones/roles/UI/retención/operación y CI/gates externos abiertos.


## O35 — observación de exportaciones en Ajustes (04/10)

**B164/P2 — fallar la consulta visible se representaba como ausencia.** loadExportStatus borraba exportStatus en catch, y exportShowsRequestEntry trataba null como autorización UI para Solicitar mi archivo. Tras un snapshot processing/ready se perdía el estado visible; tras un comando confirmado aparecía una entrada nueva aunque el GET fallara. Silent poll conservaba el snapshot pero no indicaba falta de actualización. Defecto de consistencia/disponibilidad UI, sin atribuir autorización backend a estos flags.

**Corrección:** exportError distingue lectura fallida de null validado y conserva el último snapshot. Aviso accesible persistente, tono neutro del snapshot antiguo y comandos bloqueados hasta actualizar; no hay POST automático. retryExportStatus hace un GET manual, conserva foco en el botón si falla y lo lleva al título estable si se recupera. aria-disabled/busy y guard frenan doble activación sin quitar el botón enfocado. Poll y expiry se pausan durante la consulta manual; después se conserva backoff/stop/visibility. Cleanup descarta errores/refrescos de otro owner o vista destruida. Cancel revalida loading/error/refresh tras la confirmación asíncrona. ACK/outcome request/download/cancel se conserva aunque falle la observación posterior; no afirma rollback ni vuelve a emitir el write.

**Código:** lectura completa de los seis métodos Auth export, Settings observación/expiry/poll/handlers/callers/cleanup, AsyncPoller, dialogTS y decoder/caller de GET; exportStatus/history/publicExport/isExpired del servidor releídos. DTO valida campos individualmente, pero relaciones stage/status/failure/deadlines siguen candidatas; export reads aún usan actor hidratado y requieren revisión fresca O36. No extracción nueva de Auth ni modificación de su transporte/policy ni PHP en O35. El plan corregía un dato previo: montaje actual notify=true, comprobado antes de producto.

**Regresiones:** rojo13casos,11fallos/2controles (0,891s Karma/0,878s ejecución), exit1 `s02-export-observation-red.log`. Primer verde102/102 fue intermedio.24 controles nuevos con API/interceptor/decoder/Auth/Settings reales: HTTP503/DTO502/network0 no false ausencia, null confirmado, processing/ready visible ysilent fallo, polling/backoff/stop y recuperación, cancelACK+GETfallo, outcomes confirmados request/download yreceiptunconfirmed, manual éxito/fallo/dobleactivación/foco, timers/freshread, destroy/latest/readabort/identidad legítima, handlers sin comando yconfirmación que outliveerror. Request/download outcomes del overlay se simulan, no se atribuye ejecución real de esos writes ni filesystem.

Refinamiento rojo3/24fallos/21controles (1,668/1,473s): timerexpiry cancelaba nueva recuperación, confirmación pendiente aún enviaba cancel yuna fixture retenía GET30s, superando timeout real20s. Timer yguard corregidos; fixture adaptada a10s sin alterar timeout/policy. No bugs históricos adicionales atribuidos a refinamiento del método nuevo. **122/122 dedicadas** (3,196/3,119s), exit0 `s02-export-observation-contracts-final.log`; **1203/1203 full frontend final** (10,956s Karma/10,201s ejecución), exit0 `s02-export-observation-full-frontend-final.log`. Full1203 anterior10,545/9,801s ybuild6,635s fueron intermedios, antes de tono neutro/opacidad disabled. Lintfinal/tipos/buildfinal11,909s exit0; tipos ejecutados tras TS final y antes del último ajuste sóloHTML/CSS, compilado en build/full final.

**QA propia:** agent-browser sesión uvh-o35, frontend compilado de producción con servidor HTTP aislado8450, sin Laravel/DB/mail/providers/reales. Aviso inicial, fracaso/reintento Enter yfocus conservado, recuperación ready y ausencia hacia#export-heading; failure de foreground conserva snapshot y bloquea descarga/cancel.390x844 sin overflow, manual retenido con aria-busy/disabled sin native disabled yEnter repetido. Capturas initial-error/ready/stale-mobile-final/recovered-mobile inspeccionadas; últimas con tono neutro ycancel atenuado. Summary en `.uvh-runtime/s02-export-observation-browser/summary.json`, logs sólo métodos/paths y0writes. Dark/system+desktop/móvil acotados, no matriz universal de temas/roles/cookie/proveedor. Aviso de preferencias en primer montaje sin GET registrado quedó como candidato sin causa/ID y no se atribuye automáticamente a fixture. Navegador propio cerrado yservidor terminado intencionalmenteexit130; ningún navegador del usuario tocado.

Inventario473archivos/2260funciones con nombre/1164callbacks/3firmas/0ownersprovisionales;473hashes,353anchorsS01/68archivos+16S03/2+63S10/9+80S02/11 coinciden. Nuevo callback current de retry revisado con su función; homónimos no agregados como anchors ambiguos. Cuatro cuerpos completos de sesión Auth continúan idénticos tras adaptación de transporte/facade659;baseline153/142/AuthController1408/tresTXrevocación preservados. Backend1930/14523/Pint473/PHPStan0 es evidencia anterior O32, no nueva suite PHP/DB. Sin migraciones/uvh_local/worker/scheduler/commit/push/deploy. Todos handles propios cerrados.

**Objetivo global y S01–S13 permanecen activos.** Siguiente: `2026-10-04-data-export-admission.md`, autoridad de export reads/writes/artefactos/eventos ycoherencia DTO antes de separar otro transporte Auth; restantes funciones/roles/UI/retención/capacidad/operación/CI/providers siguen abiertos. Candidatos sinID hasta reproducción.


## O36 — exportaciones: fronteras de controller (04/10)
B165/P1 (GET con sesión/actor obsoletos), B166/P1 (verified perdido durante I/O) y B167/P2 (caducidad exacta/null incoherente) reproducidos y corregidos.70 controles nuevos;143/1099 dedicado25,65s y Pint474/PHPStan0, exit0. Baseline152/141 sólo1ignore resuelto retirado;473hashes/353S01/16S03/63S10/104S02anchors y cuerpos Auth preservados. Full backend uvh_test/JUnit en curso, todavía sin crédito de regresión completa. Frontend1203O35 histórico sin nuevo cambio/gate. Detalle, rojos y límites en [reporte O36](../../project-completion-audit-2026-09-30.md).
PlanO36 sigue abierto: reproducir failed/size Audit fuera de TX, pointer perdido antes de cleanup, recursos de stream, outer dispatch y relaciones DTO. Candidatos sin ID hasta rojo; objetivo global/S01–S13/CI/operación/roles/retención siguen abiertos. Sin PHP/tests editados durante suites ni datos/proveedores/worker/scheduler reales/commit/push/deploy.

O36 controller full verificado:2000/2000backend,15172aserciones,313,847s/131MB,exit0 exclusivamenteuvh_test. JUnit2000/15172/errors0/failures0/skipped0;70nuevos DataExportAdmissionBoundaryTest/649aserciones. Log s02-export-admission-full-backend.log y storage/logs/s02-export-admission-junit.xml. PHP/tests sin edits durante suite; hashes/anchors comprobados. Cierra únicamente esta frontera local B165–B167, no planO36/global. Handle propio cerrado. Next Step: rojo de failed/size Audit y cleanup del job.


O36 segunda subfase: B168/P2 admite Audit en TX de failed/size, B169/P2 cleanup sólo después de outer commit y B170/P2 conserva pointer ante volumen inaccesible.17 controles nuevos públicos, rojo7/17;160/1239 dedicado30,53s y Pint475/PHPStan0,exit0. Size fixture no escribe fichero: no fuga privada atribuida. Full del job final en curso;2000/15172 anterior sólo controller. Resto de recursos/spools/DTO/outer dispatch y objetivo global siguen abiertos; detalle y límites en reporteO36. PHP/tests estables durante suites.


O36 final de las dos subfases verificadas (04/10): **2017/2017 backend,15312aserciones,336,833s/133MB,exit0**, exclusivamente uvh_test (`s02-export-failure-full-backend.log`). JUnit2017/15312/errors0/failures0/skipped0 en storage/logs/s02-export-failure-junit.xml;70nuevos admisión/649aserciones+17nuevos terminal/140=87controles nuevos respecto a1930O32.160/1239 dedicado30,53s yPint475/PHPStan0 exit0. Los2000/15172 anteriores sólo eran la etapa controller;2017 acredita el job final. Cinco hashes controller/job/tests/baseline sin cambio durante full.473hashes y353S01/68+16S03/2+63S10/9+121S02/14anchors verificados después del full;Auth1408/659/cuerpos adaptados intactos, baseline152/141 sin nuevos ignores. B165–B170 corregidos con rojos y límites descritos. No cambios frontend/gate nuevo:1203O35 histórico. Todas ejecuciones propias cerradas;PHP/tests estables durante suites, sin DBsuites paralelas/datos/proveedores/worker/scheduler reales/commit/push/deploy. **PlanO36/objetivo global/S01–S13 permanecen abiertos** por recursos/spools/DTO/outer dispatch y sistemas/gates restantes.

Next Step vigente: reproducir validate/readChunks con cierre del recurso y lecturas de spool con fallo frente a EOF normal según planO36. Después DTO y seis contratos Auth export antes de separar transporte; no repetir full sin nuevo cambio/fallo que lo justifique. CI/operación/roles/retención y candidato notificationprefs siguen abiertos.


## O37 — streams/spools export (04/10)
B171/P2 cierra recursos de download ante validate/readChunks excepcionales;B172/P2 error/rewind de temporales deja de publicar ready incompleto;B173/P2 libera aperturas parciales.23controles nuevos reales HTTP/public handle con streams fake/childisolated.189/1664 dedicado38,01s yPint480/PHPStan0 exit0;baseline152/141 sin nuevoignore. Rojo stream8/13 yspool6/10 con archivo original descifrado/notice publicado y datos ausentes.473hashes/353S01/16S03/63S10/125S02anchors/cuerposAuth preservados. Full/JUnit actual en curso;2017O36 anterior yfrontend1203O35 históricos. Detalle/límites en reporteO37. No PHP/tests editados durante DBsuites ni datos/proveedores/productiveworkers/commit/push/deploy; objetivo global/S01–S13/planO36 siguen abiertos.


O37 final verificado (04/10): **2040/2040backend,15721aserciones,355,198s/133MB,exit0**, exclusivamenteuvh_test (`s02-export-stream-spool-full-backend.log`). JUnit2040/15721/errors0/failures0/skipped0 en storage/logs/s02-export-stream-spool-junit.xml;13StreamLifetime/197aserciones+10SpoolIntegrity/212=23nuevos/409aserciones.189/1664dedicado38,01s yPint480/PHPStan0 exit0. Los2017/15312 O36 anteriores no se atribuyen a estas correcciones;2040 acredita árbol final. Ocho hashes PHP/tests/baseline sin cambio durante full y473sourcehashes/353S01/16S03/63S10/125S02anchors/comparacionesAuth comprobados después. Baseline152/141 sin ignores nuevos;Auth1408/659 preservados. Todas ejecuciones propias cerradas, PHP/tests estables durante suites, sin suites DB paralelas. B171–B173 corregidos con casos negativos/positivos yretry; no filesystem/proveedor/capacidad/receipt nativo real. Ningún frontend/DOM/browser nuevo:1203O35 es evidencia previa. No datos/cuentas/mail/productiveworkers/scheduler/migraciones externas/commit/push/deploy.

**Objetivo global/S01–S13/planO36 permanecen activos.** Next Step vigente: ejecutar2026-10-04-data-export-response-contract.md, caracterizar relaciones stage/status/failure con emisor/legacy yHTTP/API/Auth/caller antes de fix. Separar transporte Authexport después de contratos completos y comparación de cuerpos, en fase propia. Outerdispatch/restantes funciones/roles/retención/capacidad/CI/operación real ynotificationprefs siguen abiertos. No repetir full actual sin cambios/fallos nuevos.


## O38 — respuestas export (04/10)
B174/P2 corregido: stage sólo con processing, failureReason sólo con failed; nullable legacy y fechas históricas preservadas.41 controles nuevos con rojo16/37 y19/65 combinado;155 dedicado/1244full10,010sKarma9,353sexec/lint/tipos/build8,713s exit0. HTTP real simulado conserva snapshot/GET-onlyrecovery/teardown/legítimoB; no rollback/replay por DTO inválido. No PHP/DOM/DB/provider nuevo:2040/15721O37 previo. Objetivo/S01–S13 activos; sigue extracción gradual de seis transportes Auth, outerdispatch y sistemas/gates restantes. Detalle y límites en reporteO38.


## O39 — transporte Auth export verificado (04/10)
AccountDataExportService6transportes, seis cuerpos completos de fachada idénticos salvo llamada;4sesiones/3TXbackend preservadas.68controles nuevos antes/después,269dedicado/1312full9,777sKarma9,187sexec/lint/tipos/build8,940s exit0.474hashes/353S01/16S03/63S10/131S02anchors; inventario474/2266/1164/3/0provisional. Auth652/1408,baseline152/141 sin nuevoignore. SinBugID/DOM/PHP/DB/provider nuevos;2040backendO37 previo. Handles propios cerrados, objetivo/S01–S13 activos. NextStep: reproducir dispatch/export artefacto ante outerTX rollback; roles/retención/capacidad/CI/operación/restantes sistemas abiertos.


## O40 — frontera de publicación export (04/10)
B175/P2 reproducido3/9 con queue database real en segundoPDOuvh_test; publicación temprana/jobs tras rollback/savepoint. DB.afterCommit capturaIDs y conserva recovery marker/metric/evento.9controles nuevos,209/1850 dedicado41,16s,Pint481/PHPStan0 exit0. Full2049/JUnit en curso,PHP/tests estables;2040/15721O37 previo yfrontend1312O39 previo.474hashes/131S02anchors/baseline152/141/cuerposAuth preservados. Sin broker/proveedor/cookie nativa/archivo huérfano atribuidos; sin datos/migraciones uvh_local/worker/scheduler/productivos/commit/push/deploy. Objetivo/S01–S13 abiertos; candidatos borradoGET/cookieB/deadline sinID hasta rojo. NextStep: concluir full/JUnit, después plan2026-10-04-account-deletion-boundaries.md.


O40 final verificado (04/10): **2049/2049 backend,15833aserciones,360,442s/135MB,exit0**, exclusivamenteuvh_test (`s02-export-queue-commit-full-backend.log`). JUnit2049/15833/errors0/failures0/skipped0;9DataExportQueueCommitTest/112aserciones en storage/logs/s02-export-queue-commit-junit.xml.209/1850dedicado41,16s yPint481/PHPStan0 exit0. Diez hashes PHP/tests/baseline sin cambio durante full y474sourcehashes/353S01/16S03/63S10/131S02anchors/cuerpos6export+4sessions+3TX comprobados después. Baseline152/141 sin nuevos ignores; Auth652/1408. B175/P2 corregido con cola database real/separadoPDO; no provider/broker/archivo huérfano/cookie nativa/worker real atribuídos. Frontend1312/1312 O39 previo y41O38+68O39=109controles nuevos; este TS no se modificó durante O40. Todos handles de comandos propios cerrados; Docker Desktop permanece operativo con postgres/mailpit locales, sin workers/scheduler/appserver. No uvh_local/migraciones/reales/commit/push/deploy. **Objetivo global/S01–S13 siguen activos.** NextStep vigente: ejecutar2026-10-04-account-deletion-boundaries.md; candidatosGET/currentCookie/deadline sin ID ni cierre hasta reproducción. CI/roles/retención/capacidad/operación real/restantes funciones continúan pendientes.


## O41 — fronteras de eliminación de cuenta verificadas (04/10)

B176/P1: deletionImpact vuelve a resolver sesión, cuenta verificada y rol actuales; siete intercalaciones tras hydrate y dos cambios de rol ya no publican información privada obsoleta. B177/P2: confirmar un enlace de A con sesión de B conserva B; backend devuelve current boolean obligatorio y sólo limpia cookie del propietario, UI respeta current y generación. B178/P2: confirmación exige plazo estrictamente futuro, coherente con impact; cancelación protectora no cambia. Mensaje de éxito identifica la cuenta del enlace.

17 nuevos backend/165 aserciones y23 frontend; rojos13/17 y15/23 antes del fix.272/2176 dedicado46,22s; **2066/2066 backend,15998 aserciones,352,034s/133MB**, JUnit0 errores/fallos/skips exclusivamente uvh_test. Pint482/PHPStan0.109 dedicado y **1335/1335 frontend**,10,256s Karma/9,521s ejecución; lint/tipos/build10,334s exit0. Logs `.uvh-runtime/s02-deletion-{boundary,identity}-*`; JUnit `backend-laravel/storage/logs/s02-deletion-boundary-junit.xml`. QA aislada en390×844 y1440×1000, ambos temas sin overflow, cuatro capturas y resumen en `.uvh-runtime/s02-deletion-browser/`; navegador/servidor8451 cerrados.

474 hashes y353 S01/16 S03/63 S10/139 S02 anchors en19archivos comprobados; inventario474/2266/1165/3/0provisional. Auth652/AuthController1408, baseline152/141, cuerpos6export+4sessions+3TX preservados. Ocho hashes PHP/tests sin cambios durante full; suites DB secuenciales. Pruebas HTTP/headers no acreditan aplicación de cookie nativa ni congelan un futuro Set-Cookie; QA usa fixture, sin DB/usuarios/proveedores reales. No uvh_local/worker/scheduler/migraciones externas/commit/push/deploy. Todos handles propios cerrados, postgres/mailpit compartidos permanecen operativos.

**Objetivo global/S01–S13 activos.** Siguiente: caracterizar y extraer los dos transportes Auth de borrado conservando guards completos; revisar callers con comportamiento real antes de asignar más bugs. Restantes funciones/roles/retención/capacidad/CI/operación real siguen pendientes.


## O42 — transporte Auth de eliminación separado (04/10)

AccountDeletionService contiene sólo los dos transportes impact/request. Los dos cuerpos de Auth conservan literalmente generación/assertCurrent/return tras adaptar la llamada; también6export+4sesiones+3TXbackend intactos. Auth652→648líneas, AuthController1408/baseline152/141 sin cambios.24contratos HTTP/API/interceptor/Auth y12caller nuevos =36 antes/después;199dedicados/1371fullfrontend9,386sKarma8,742sexec/lint/tipos/build10,679s exit0. Inventario475/2268/1165/3/0provisional y475hashes/353S01/16S03/63S10/151S02anchors en20archivos; inventario no equivale a cierre. Detalle/logs `.uvh-runtime/s02-auth-deletion-*`, comparación literal `.uvh-runtime/verify-auth-deletion-transport.py`.

Fixtures corregidos antes de acreditar36positivos: expected mfaEnabled del escenarioMFA, blocker status válido submitted y ACKliteral requested para TypeScript. No BugID por estos ajustes ni red de producto por extracción. Caller retryGET, blockers/acknowledgement/credenciales/factor/inflight/destroy/secretcleanup yerror malformed ejercitados con componente real/MatDialogRefstub. No cambio DOM/CSS/decoder/seguridad del servidor, no nueva QA/DB/provider/cookie nativa; backend2066/15998O41 es evidencia previa. Sin commits/push/deploy/datosreales/workers. Todas ejecuciones propias cerradas.

**Objetivo/S01–S13 siguen abiertos.** Próximo candidato: checkImpact dice «No se ha enviado ninguna solicitud» incluso después de POST con outcome incierto y retryGET fallido; reproducir antes de ID/fix. Restantes funciones/roles/retención/capacidad/CI/operación siguen pendientes.


## O43 — mensaje tras solicitud incierta corregido (04/10)

**B179/P2:** checkImpact mostraba «No se ha enviado ninguna solicitud» cuando ya se había despachado POST y su respuesta era incierta. Dos reproducciones con componente/API/interceptor/Auth reales: POST network0 o ACKmalformed→GETmanual503; rojo2fallos/36positivos/38cases0,359s. No se afirma que el servidor haya confirmado ni revertido nada. Copy ahora describe únicamente el fallo de lectura e indica consultar estado; sin cambio de guards/decoder/POST/retries. Secretslimpios/impactnull/ackfalse/continuebloqueado, sin replay.

**87/87 dedicadas;1373/1373 frontend**,9,459sKarma8,838sexec, lint/tipos/build10,202s exit0. Logs `.uvh-runtime/s02-deletion-uncertain-{red,contracts,full-frontend,lint,types,build}.log`. QA build propia en8452, diálogo real con unPOST503fixture yGETfallido,390×844/1440×1000 claro/oscuro; mensaje completo ysin overflow de página/contenido;cuatro capturas/summary en `.uvh-runtime/s02-deletion-uncertain-browser/`. No errores JS nuevos enbrowser; server/navegadoruvh-o43 cerrados. CLI screenshot --path no soportado: capturas temporales retornadas copiadas, no fallo producto atribuido.

475hashes/353S01/16S03/63S10/151S02anchors en20archivos, Auth648/AuthController1408/baseline152/141 y2deletion+6export+4sessions+3TX preservados; ocho hashes PHP/tests O41 siguen iguales. Backend2066/15998O41 previo, sin nueva suitePHP/DB. Sólo copyTS ytests, sin datosreales/proveedores/mail/workers/scheduler/migraciones externas/commit/push/deploy. Inicial fixture está aislado;QA no acredita nativecookie/DB/provider ni outcome de una cuenta real. Todas ejecuciones propias cerradas.

**Objetivo global/S01–S13 activos.** Siguiente: fronteras de efectos de LinkIntentRegistry/reconciled Audit tras confirmDeletion ante outercommit/rollback/outages; fuente del registry ycaller leída sin BugID/causa cerrada aún. Política de cancelación protectora, roles/retención/capacidad/CI/operación yrestantes sistemas pendientes.


## O44 — efectos de eliminación tras commit exterior (04/10)

**B180/P2:** confirmDeletion borraba destino privado/counters de caché después de TX interna, antes de outercommit. Rollback yrollback de savepoint restauraban cuenta/version/sesiones/solicitud/email/auditoríaSQL pero destruían handoff; secondaryAudit era admitido dentro de TX exterior y su fallo devolvía500 prematuro. Rojo4fallos/8positivos/12,225aserciones/4,69s. Fixtures issue/claim porHTTP realA/B, caché array independiente de SQLguarded uvh_test; no Redis/broker/provider/producción probado.

Se difiere sólo revocación de intents+Audit de reconciliación con DB.afterCommit capturando user/request IDs y fechaISO inmutables. Normalcommit sigue síncrono al ejecutar callback; rollback/savepoint no ejecutan, B preservada yclaimB válido. Primary account.deletion_scheduled/mail admission siguen en TX; secundarios fallidos no anuncian rollback de suspensión durable. No cambio cancellation/cookie/deadline/registry/sharedcache/config.

17nuevos finales:4commit/rollback/normal+6cacheoutages+3counteroutages+1SQLcleanup+1primaryAuditadmission+1secondaryAuditadmission+1historyoutage. Countercleanup sigue best effort/TTLbounded, no bearer revive; residual counters no se presentan como ahorro/garantía de capacidad. SQLindexoutage después de cachedelete conserva índice yretry no decrementadosveces; cacheforgetfalse/read/lockbusy conservan record eíndice. Historymaterializationfailed retiene dosoutboxevents ydrainonce; secondaryadmit failure no envenena outerTX. **104/104 dedicadas,953aserciones/19,22s;Pint483/PHPStan0**,exit0. Logs `.uvh-runtime/s02-deletion-commit-effects-{red,format,contracts,quality}.log`. Full/JUnit2083 en curso, sin PHP/tests editados durante suite;2066/15998O41 previo yfrontend1373O43 previo, sin nueva QA/UI/provider/cookie nativa.

475hashes/353S01/16S03/63S10/175S02anchors en22archivos; inventario475/2268/1166/3/0provisional.24anchors de registry/controllerLinkIntent son dependencia S04, no cierre S04ni dobleconteo. Auth648/AuthController1408/baseline152/141 y2deletion+6export+4sessions+3TX preservados. Ejecución secuencial; no datosuvh_local/mail/cuentas/workers/scheduler/providers/migraciones externas/commit/push/deploy. Goal previo O41–O43 fue progreso: cuatrofixes/extracción/verificación, no simple plan sin ejecutar.

**Objetivo global/S01–S13 permanecen activos.** Otros4callers revokeForUser (admin, incidentrevocation, recoverycomplete, housekeeping) leídos sólo en fragmentos aún sinreview/casos completos; posiblemismooutercacheefecto, candidatos sinID. Restantes funciones/roles/retención/capacidad/CI/operación real siguen abiertos. No cierre de planO44 hasta full/JUnit final.


O44 final verificado (04/10): **2083/2083 backend,16347aserciones,343,130s/135MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s02-deletion-commit-effects-full-backend.log`). JUnit2083/16347/errors0/failures0/skipped0;17AccountDeletionCommitEffectsTest/349aserciones en `backend-laravel/storage/logs/s02-deletion-commit-effects-junit.xml`.104/953dedicado19,22s yPint483/PHPStan0 exit0. Nueve hashes de fuente/tests/baseline sin cambios durante full y475sourcehashes/353S01/16S03/63S10/175S02anchors/cuerpos2deletion+6export+4sessions+3TX comprobados después; Auth648/AuthController1408/baseline152/141 preservados. B180/P2 corregido con cachearray+SQLreal/HTTPissueclaim; no provider/Redis/capacidad/cookie nativa ni nuevas UI/TS/gatesfrontend atribuidos (1373O43 previo). Todos handles propios cerrados, sin suites DB paralelas/PHPedits durante full. Postgres/mailpit compartidos quedan operativos;sin uvh_local/mail/usuarios/providers/workers/scheduler/migraciones externas/commit/push/deploy.

PlanO44 cerrado sólo localmente; **objetivo global/S01–S13 abiertos**. NextStep vigente: ejecutar `docs/superpowers/plans/2026-10-04-security-intent-commit-effects.md`, revisar completos yreproducir otros4callers antes de ID/fix. Sourceadmissionincident+updateUser ydosAuthwrapper leídos; outputhousekeeping/recoveryhelpers parcialmente truncado no acredita revisión completa. Funciones/roles/retención/capacidad/CI/operación real/restantes sistemas pendientes; no repetir full actual sin nuevos cambios/fallos.


## O45 — coherencia de revocación y archivos con commit exterior (04/10)

**B181/P2:** otros cuatro callers de revokeForUser ejecutaban efectos de caché después de su TX interna pero antes de la confirmación exterior: incidente, bloqueo admin, recuperación aprobada y ejecución de borrado. Rojo auténtico12fallos/4positivos/16casos,278aserciones/3,73s con A/B emitidos/reclamados por HTTP y SQL real uvh_test. Helper LinkIntentRegistry::afterCommit concentra revocación best effort y observer sólo de telemetría secundaria; los cinco callers (incluido confirmDeletion/B180) capturan IDs/metadatos y esperan commit. Normal commit conserva ejecución inmediata; rollback/savepoint no consumen handoffs/counters. Primary admissions/receipts/authority/session-cookie/last-admin/dual-approval intactos.

**B182/P2:** housekeeping borraba ficheros de export antes de outercommit; el retryTerminal posterior podía saltarse un callback diferido al observar terminal dentro de la misma TX. Tras el fix de caché quedaron3fallos/13positivos,479aserciones/4,13s por fichero ausente antes de commit. Retención processing-stalled/ready-expired reprodujo además6fallos/2positivos,28aserciones/2,38s retirando sólo esas adaptaciones antes de restaurarlas. Cleanup de executeAccountDeletions y dos transitions de retención ahora usa afterCommit; retryTerminal programa cada puntero si hay TX exterior y cuenta cero trabajos aún no ejecutados, revalida estado/ruta bajo lock después de commit. attempt para workers conserva respuesta booleana inmediata. Callbacks duplicados son idempotentes, un único export.cleaned.

30 nuevos controles:16action×outcome +8retención×outcome +4cache-lock-outage +1secondaryAuditfallo +1primaryadminAuditadmissionfallo. **181/181 dedicadas,1944aserciones,34,59s; Pint484/PHPStan0**,exit0. Full/JUnit2113 iniciado, PHP/tests congelados durante suite; backend2083/16347O44 yfrontend1373O43 son evidencia previa. Fixtures de housekeeping usan comando nativo sólo en test guardado, exact-generation SENT receipt manual/due-now; no acreditan siete días de gracia/SMTP/provider. Storagefake no es descarga cifrada/proveedor/filesystem productivo; cachearray no Redis ni garantía fuerte de capacidad/countercleanup. SQL inverse row conservado ante lockbusy permite retry explícito; no afirmar que housekeeping ya reintenta todos los blocked intents.

Seis archivos completos comparados literalmente tras adaptaciones específicas (`.uvh-runtime/verify-security-commit-effects.py`); la diferencia de AuthController1408→1399 es sólo eliminación de catches duplicados, no cierre de separación. AuthService648/2deletion+6export+4session y3TXSessionRevocation preservados; baseline152/141 sin nuevos ignores. Inventario475/2269named/1168anonymous/3signatures/0provisional;475hashes,353S01/16S03/63S10/194S02anchors en29archivos. Shared dependencies no se suman como cierre de S04/S11/S13. Reports/sourceledger/matriz no constituyen cobertura completa.

**Objetivo global/S01–S13 siguen activos.** Pendientes: full/JUnit de O45, admisión de auditoría primaria de ejecución de borrado (source candidate: Audit después de businessTX, sin rojo/ID aún), discrepancia TTL registry24h/configurable en issue sin rojo/ID aún, separación gradual AuthController y revisión restante de funciones/roles/retención/capacidad/CI/operación real. Sin uvh_local/cuentas/mail/providers/productiveworkers/scheduler/migraciones externas/commit/push/deploy. Suites DB secuenciales, únicamente uvh_test.


O45 final verificado (04/10): **2113/2113 backend,17018aserciones,350,697s/133MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s02-security-commit-effects-full-backend.log`). JUnit2113/17018/errors0/failures0/skipped0 y30SecurityIntentCommitEffectsTest/671aserciones en `backend-laravel/storage/logs/s02-security-commit-effects-junit.xml`; summary `.uvh-runtime/s02-security-commit-effects-junit-summary.json` (JUnit348,399297s).181/1944dedicado34,59s;Pint484/PHPStan0 exit0.13hashes de fuente/tests/baseline congelados y comprobados después;475sourcehashes y353S01/16S03/63S10/194S02anchors en29archivos actuales. Seis archivos completos comparados tras adaptaciones explícitas y2deletion+6export+4sessions+3TX anteriores conservados. AuthController1399/AuthService648,baseline152/141 sin nuevoignore; no cierre de separación Auth por línea reducida.

B181/P2 yB182/P2 corregidos con evidencia roja/verde, incluidos native-command housekeeping/retención y cuatro security callers; countercleanup sigue best effort/TTLbounded. Sin cambios TS/DOM/QA ni nuevo gatefrontend (1373O43 previo), provider/SMTP/Redis/nativecookie/capacity/fileproductivo no acreditados. No usuarios/mail/DBuvh_local/providers/workers/scheduler/migraciones externas/commit/push/deploy. Todos handles propios terminales; shared postgres/mailpit siguen healthy, sin app/worker/scheduler. La respuesta anterior sobre estado Auth fue informativa; este turno sí es progreso por dosfixes/30regresiones/verificación real.

**Objetivo global/S01–S13 continúa activo.** NextStep vigente: ejecutar `docs/superpowers/plans/2026-10-04-auth-recovery-controller-separation.md`, extracción coherente de recuperación e incidente con completos cuerpos/middleware/routecomparators y contratos antes/después. PrimaryhousekeepingAuditdespuésTX yregistryTTL24/configurable permanecen candidatos no reproducidos/sinID, junto con resto de funciones/roles/retención/capacidad/CI/operación real. O45 cerrado únicamente como bloque local, no como proyecto finalizado.


## O46 — separación gradual de recuperación e incidentes Auth (04/10)

AccountRecoveryController posee request/confirm/complete ySecurityIncidentController posee revocación por incidente. Son acciones HTTP propias, sin wrappers ni herencia del controlador gigante. ValidatesAuthInput comparte tres cuerpos exactos de validación/CAPTCHA; AuthAccountLookup conserva el lookup active/lower(email)/deleted_at con método static, sólo preflight sin autoridad. Ocho dependencias de admisión/response/cleanup/CAPTCHA/baseline conservan hashes. Ninguna TX/receipt/dualapproval/cookie/policy/DTO se mueve o modifica. No nuevo BugID por extracción.

**44 métodos completos comparados:**36quedan enAuth,4accionesHTTP+3helpers+1lookup cambian deowner; sólo sustituciónfindUserByEmail→AuthAccountLookup::activeByEmail en callers. Toda clase Auth restante incluida constante/hash/comments comparada tras adaptaciones explícitas. Toda fuente routes/api.php preservada tras imports+4actionclasses; **185 contratos de ruta runtime idénticos** enverbos/URI/nombres/domains/middleware-order/constraints/defaults/fallback, salvo las4clases. AuthController1399→1227líneas, AuthService648sin cambio; reducción no prueba cierre Auth/S01. Comparador `.uvh-runtime/verify-auth-recovery-controllers.py`.

36contratos nuevos de parsing/CSRF/CAPTCHA ylookup:5emailsmalformed,4verifieroutcomes,4CSRF,16bearersmalformed,6completionpayloads y1trim/case lookup. Pruebas HTTP/API/SQL realesguardados conHttpfake/Queuefake; **191/191 antes/después,1923aserciones,32,27s/32,68s;Pint489/PHPStan0**,exit0. Antesdeatribuirpositivos se normalizaron fixtures SQL mediante refresh yse sustituyó HttpFactory para retirar fake genérico; un transporte que arroja excepción se comprueba por callback-count yno por lista de respuestas grabadas. Esos ajustes no son fallos producto ni rojos de extracción. Full/JUnit2149 en curso, PHP/tests congelados; backend2113/17018O45/frontend1373O43 son gates previos.

Inventario479/2269named/1168anonymous/3signatures/0provisional;479hashes,354S01anchors/72files,16S03/2,63S10/9 y194S02/30 verificados. Anchors relocados conservan evidencia histórica; captchaError es un anchor nuevo completo, no una nueva función global ni gate de proveedor/timing.15hashes congelados para full; baseline152/141 sin cambios/ignores. Histórico O45Auth1399 se valida con snapshot cuyo hash es el del manifiesto congelado O45; comparador O46 valida el árbol actual ytodos los44cuerpos, sin debilitar el gate.

**Objetivo global/S01–S13 activo.** Falta terminar full/JUnit, yAuth aún reúne registro/activación/login/logout/MFA/perfil/password/email/sessions/security-center. SourcecandidatesprimaryhousekeepingAuditfueraTX yTTL24/configurable siguen sinrojo/ID; resto de funciones/roles/retención/capacidad/CI/operación real abiertos. No TS/DOM/QA/provider/SMTP/Redis/nativecookie nuevo; no uvh_local/cuentas/mail/workers/scheduler/migraciones externas/commit/push/deploy. Continuación previa O45 fue progreso probado:2fixes/30tests/full2113.


O46 final verificado (04/10): **2149/2149 backend,17449aserciones,395,866s/139MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s01-auth-recovery-controllers-full-backend.log`). JUnit2149/17449/errors0/failures0/skipped0,36PublicRecoveryHttpContractTest/431aserciones,393,309949sJUnit en `backend-laravel/storage/logs/s01-auth-recovery-controllers-junit.xml`; summary `.uvh-runtime/s01-auth-recovery-controllers-junit-summary.json`.191/1923dedicado antes32,27s/después32,68s;Pint489/PHPStan0 exit0.15hashes de fuente/test/baseline conservados y479sourcehashes/354S01/16S03/63S10/194S02anchors comprobados después. FullAuth restante/44methodbodies/185runtime-routes/8dependencies y2deletion+6export+4sessions+3TX anteriores preservados tras las adaptaciones declaradas.

AccountRecoveryController3actions ySecurityIncidentController1action son los propietarios reales; shared3validators yactive-email preflight evitan duplicación. AuthController1227líneas/AuthService648,baseline152/141 sin nuevoignore. Sin nuevoBugID/TS/DOM/QA/provider/SMTP/Redis/nativecookie/latency/capacity claim;frontend1373O43 previo. Suites DB secuenciales ysin PHP/tests editados durante full. Handles propios terminales;sharedpostgres/mailpit operativos, sin worker/scheduler/appserver. No uvh_local/users/mail/providers/productioncommands/migraciones externas/commit/push/deploy.

PlanO46 cerrado sólo como extracción local. **Objetivo global/S01–S13 activos; Auth no está totalmente separado.** NextStep vigente: `docs/superpowers/plans/2026-10-04-account-deletion-lifecycle-audit.md`, reproducir admisión primaria deanonimización ycompensaciones protectoras por comando nativo guardado;sourcecandidates sin ID hasta rojo. Después continuar extracción coherente registro/activación ypasswordrecovery. RestoAuth/MFA/profile/sessions,registryTTL/configurable,funciones/roles/retención/capacidad/CI/operación real permanecen pendientes. No redefinir cierre como suites verdes/extracción parcial.


## O47 — auditoría durable del ciclo automático de eliminación (04/10, verificado localmente)

**B183/P1:** el comando nativo admitía account.deletion_executed después de confirmar la anonimización SQL; un fallo PHP/SQL de auditoría perdía evidencia de la operación irreversible. **B184/P2:** las compensaciones por correo sin confirmar o workspace aún propio no podían recuperar su evento exacto tras fallo, y el bloqueo de una solicitud incoherente de cuenta activa no tenía evento. Reproducción anterior al fix:7fallos/143aserciones/2,34s, `.uvh-runtime/s02-deletion-lifecycle-audit-red.log`.

La ejecución destructiva exige admisión durable dentro de su TX. Las decisiones protectoras guardan un receipt de identidad/motivo/hora originales y sólo lo consumen con la admisión outbox en el mismo savepoint; una avería del audit general no revierte la protección. El receipt es obligatorio: si su propia admisión falla, no se confirma un cambio sin evidencia recuperable. Caché y archivos siguen esperando el commit exterior; cuenta B preservada. Recuperación acotada a100 antes del checkpoint heavy; un resto pendiente o admisión fallida devuelve1 y no renueva heartbeat. No se promete que el checkpoint heavy nunca avance cuando falla otra etapa. Historia indisponible conserva el evento outbox; cambios de generación, borrado físico de request/user y logs/metrics rotos no borran el motivo original.

**171/171 dedicadas,2919aserciones,31,27s;Pint493/PHPStan0**,exit0.56casos nuevos respecto a O46:45lifecycle +8schema +3readiness. **Full2205/2205,18889aserciones,378,548s/137MB,exit0**, sólo uvh_test; JUnit2205/errors0/failures0/skipped0 (376,120217s),45lifecycle/1397aserciones +8schema/22,16readiness/101 (trescases nuevos de readiness).15hashes fuente/test/dependencias preservados, sin PHP/test edits durante full final. Logs `.uvh-runtime/s02-deletion-lifecycle-audit-{contracts-final,quality-final-bounded,full-backend}.log`,JUnit `backend-laravel/storage/logs/s02-deletion-lifecycle-audit-junit.xml` ysummaryruntime del mismo nombre. Frontend sin cambio/nuevo gate. La primera full se detuvo deliberadamente (propio container, exit137, log `s02-deletion-lifecycle-audit-full-backend-aborted-137.log`), sin atribuir resultado verde, al descubrir durante revisión que batch101 marcaba saludable con1receipt pendiente. Rojo adicional1/9/1,23s y corrección dentro de la implementación O47; nuevo control nativo demuestra100→estado pendiente→1→sano sin duplicación. No nuevo BugID histórico por ese ajuste.

Migración2026_10_04_000001 aplicada sólo uvh_test con guard testing/*_test; schema/ledger, CHECKreason/resource, precisiónUTCms y down que rechaza pendientes probados. Release/readiness/health fallan ante table/column/ledger ausentes; ninguna auto reparación. Hace falta aplicar la migración en los entornos de ejecución mediante el procedimiento de release; uvh_local/externos no migrados aquí.

Inventario480/2273named/1171anonymous/3signatures/0provisional;480hashes y354S01/16S03/63S10/198S02anchors (31archivosS02) comprobados. Enumeración no equivale a revisión completa. Comparación de toda fuente housekeeping/readiness tras adaptaciones explícitas; admisiones compartidas y Auth1227/AuthService648 preservados. Baseline152/141→151/140 al eliminar exactamente una supresión obsoleta de housekeeping, sin ignores nuevos ni tocar rename ajeno. Históricos O45/O46 encadenados mediante snapshots hash-verificados y comparer O47 actual.

**Objetivo global/S01–S13 activos; Auth sigue parcialmente separado.** Bloque local O47 cerrado; próximo bloque: `docs/superpowers/plans/2026-10-04-auth-registration-password-controller-separation.md` (seis acciones de registro/activación/recuperación de contraseña y helpers compartidos, rutas/cuerpos completos preservados). Login/logout/MFA/profile/email/sesiones/security-center y funciones/roles/retención/capacidad/CI/operación real restantes siguen abiertos. TTLregistry/configurable sigue candidato sinrepro/ID. Frontend1373O43/backend2149O46 son evidencia previa hasta gates nuevos; no UI/QA/provider/SMTP/Redis/nativecookie/producción acreditados en O47. Fixtures HTTP A/B/arraycache/Storagefake/Queuefake y receipt SENT/due-now manual no prueban entrega SMTP ni los siete días reales. Sin cuentas/mail/uvh_local/providers/productiveworker/scheduler/commit/push/deploy/migraciones externas.

La respuesta anterior sobre Auth fue informativa; este turno aporta progreso verificable por dos causas corregidas,56controles nuevos y gates de backend completos. Todas las ejecuciones propias son terminales; postgres/mailpit compartidos quedan operativos. No se marca completo el objetivo global ni S01–S13.


## O48 — registro/verificación y recuperación de contraseña con propietarios propios (04/10, verificado localmente)

RegistrationController posee register/changeRegistrationEmail/verifyEmail/resendVerification ysu private pending lookup; PasswordRecoveryController posee forgot/reset. ValidatesAuthInput incorpora el cuerpo original validName compartido con perfil; EqualizesPublicMailDuration contiene el helper original completo ycomentarios, compartido por los dos nuevos controllers. Sin forwarding/herencia ni cambio de política/servicios/transacciones/cookies/bearer/JSON/CAPTCHA. **Auth1227→899/27methods; AuthService648sin cambio**. No nuevo BugID ni ganancia de rendimiento medida.

Todos los36métodos originales ycomentarios preservados literalmente:27quedan,6acciones+3helpers cambian propietario. Toda clase Auth restante, constante ycomentarios comparada tras retirar sólo7imports no usados; input trait sólo añade originalvalidName ytiming concern entero conserva original.185contratos de ruta runtime frescos idénticos salvo6classes (verbos/URI/domain/name/middleware-order/constraints/defaults/fallback); sourceapi sólo2imports+6owners.11dependencias admission/mail/lookup/CAPTCHA/baseline conhashes iguales. Comparador `.uvh-runtime/verify-auth-registration-password-controllers.py`; O45/O46/O47 se conservan como pruebas históricas con snapshots verificados y transformación O48 actual.2deletion+6export+4sessions+3TXsession anteriores intactos.

**301/301 regresiones antes y después,2852aserciones,93,37s/95,46s;Pint496/PHPStan0**,exit0. Registro proposal/activación/identidadlegal/mailbox/corrección, free/occupied/legacy/context/replay/deadline/cooldown, admisiónSQL/mail/audit yreset liveauthority/currentcookie preservados. Include real multiprocess overlap de correction/activation en PostgreSQL*_test, ymail HTML/text→bearer usable en ArrayTransport; no entregaSMTP/proveedor/host productivo acreditados. Sin nueva prueba que copie implementación ni falso red atribuido; existentes apropiadas cubren los contratos impactados. **Full2205/2205,18889aserciones,398,526s/137MB,exit0**, exclusivamente uvh_test;JUnit2205/18889/errors0/failures0/skipped0,396,160934s.213hashes de fuente/dependencias/todaspruebasPHP/support/config comprobados después, sin PHP/test edits durante full. Logs `.uvh-runtime/s01-auth-registration-password-{before,after,format,quality,full-backend}.log`;JUnit `backend-laravel/storage/logs/s01-auth-registration-password-junit.xml` ysummaryruntime. Cero nuevos casos por extracción; no se atribuyen fixtures existentes como nuevas regresiones. Backend2205/18889O47 yfrontend1373O43 previos hasta gates actuales.

Inventario483/2273named/1171anonymous/3signatures/0provisional,483hashes y356S01anchors/75files,16S03/2,63S10/9,198S02/31 comprobados. Se reubican7anchors con evidencia histórica yse añaden2helpers completos; inventario no es revisión completa. Baseline151/140sin cambios ni nuevosignores,rename ajeno intacto. No TS/DOM/browser/latency/capacity/nativecookie ni servicios/almacenamiento reales nuevos. Sin uvh_local/users/mail/providers/productiveworkers/scheduler/migraciones externas/commit/push/deploy.

**Objetivo global/S01–S13 activo; Auth no está totalmente separado.** O48 cerrado sólo como bloque de extracción local, con gates actuales completos. Próximo plan `docs/superpowers/plans/2026-10-04-auth-account-controller-separation.md`: once acciones de perfil/credenciales/sesiones yhelpers, con adaptación explícita de test references que hoy invocan Auth directamente. Después MFA challenge/reauth/configuration; login/logout pueden quedar como propietario coherente. Resto funciones/roles/retención/capacidad/CI/operación real yregistryTTL/configurable (candidato sin repro/ID) pendientes. O47 previo fue progreso real:2causas/56controles/full2205, no una espera por relato ni cambio del objetivo global.

Todos los handles propios terminales; postgres/mailpit compartidos siguen healthy, sin appserver/worker/scheduler productivo. Continúa el objetivo completo; no cierre de S01–S13 ni de la auditoría global por este resultado.


## O49 — perfil, credenciales y sesiones con propietarios propios (04/10, verificado localmente)

AccountProfileController posee me/profile; AccountCredentialsController los cuatro cambios de email/contraseña y appUrl; AccountSessionsController las dos lecturas y tres revocaciones. NormalizesRecoveryCodes conserva el único helper original, compartido con el MFA que sigue en Auth. Auth899→521/14métodos, sin forwarding ni cambios de admisión/política/DTO/cookies. Comparación literal de los27métodos/comentarios, toda clase restante y cuatro propietarios nuevos;185contratos runtime idénticos salvo11classes,23dependencias y baseline151/140 intactos. Comparador `.uvh-runtime/verify-auth-account-controllers.py`; O48 pasa a endpoint histórico hash-verificado yO49 prueba la transformación actual.

Regresión300/2669 antes46,63s ydespués final47,25s. Primera ejecución posterior:296correctas/4fallos (tres referencias antiguas en MfaConfigurationBoundary yuna fixture pending no limpiada al repetir). Siete archivos de tests sólo cambian propietarios; EmailChangeAdmission añade pending_registrations a la limpieza aislada tras el guard, sin quitar aserciones. Comparación completa de los ocho archivos demuestra esas únicas adaptaciones; no nuevo BugID ni nuevos tests de producto. Pint500/PHPStan0,exit0. Full2205/18889,exit0;JUnit errors0/failures0/skips0,387.717031s;06:30.082, Memory: 139.00 MB.683hashes de toda fuente inventariada/pruebasPHP/config conservados tras suite terminal,sin PHP/test edits. Logs `.uvh-runtime/s01-auth-account-controllers-{before,after-final,quality,full-backend}.log`;JUnit `backend-laravel/storage/logs/s01-auth-account-controllers-junit.xml` ysummaryruntime. Inventario487/2273named/1171anonymous/3signatures/0provisional;487hashes y356S01anchors/79files,16S03/2,63S10/9,198S02/31 comprobados; enumeración no equivale a revisión.

**Objetivo global/S01–S13 activo.** Auth aún conserva login/logout yMFA; siguiente plan `docs/superpowers/plans/2026-10-04-auth-mfa-controller-separation.md`. No frontend/UI/provider/SMTP/Redis/nativecookie/capacity/production claim nuevo. Sin uvh_local/users/mail/providers/productiveworkers/scheduler/migraciones externas/commit/push/deploy. La respuesta anterior fue sólo estado; este turno sí modifica propietarios reales y aporta evidencia nueva. No cierre global por extracción parcial o tests verdes.


O49 cerrado sólo como bloque local de extracción. Handles propios terminales; objetivo global activo. MFA pendiente según plan2026_10_04_auth_mfa; servicios frontend yresto de sistemas/roles/retención/capacidad/CI/operación real aún requieren evidencia propia. No marcar el objetivo completo por estos gates.


## O50 — propietarios HTTP de MFA y Auth centrado en login/logout (04/10, verificado localmente)

MfaChallengeController posee las dos verificaciones de login; MfaSessionController estado/reauth eiso; MfaConfigurationController las cinco acciones de configuración ydos helpers de códigos. NormalizesRecoveryCodes conserva implementación compartida con credenciales/challenge/configuración. Auth521→86/2métodos(login/logout): cuerpos yDUMMYconstante intactos;20imports/concern no usados retirados yprólogo obsoleto dehelpers eliminado explícitamente. Sin superclass/forwarding o cambio de negocio/servicios/política/cache/TX/cookies/DTO. Comparación de todos14métodos/docs yAuth completo:12literalmente preservados ydos sólo simplifican la lectura no nullable de security_version; las tresclases nuevas completas se comparan tras esas dos adaptaciones declaradas;185contratos runtime idénticos salvo9owners;34dependencias de negocio/input hash-preservadas;baseline151/140→149/139 al retirar exactamente la supresión antigua(count2) de los dos coalesces redundantes. Sin nuevosignores. Cinco tests completos sólo adaptan propietarios/imports; las revocaciones protectoras de MfaConfigurationBoundary mantienen AccountSessionsController. Comparador `.uvh-runtime/verify-auth-mfa-controllers.py`;O49 histórico hash-verificado ycadenaO45–O50 conservada.

378/3444antes71,73s/después final62,67s,exit0;Pint503/PHPStan0,exit0. Full2205/18889,exit0;JUnit errors0/failures0/skips0,380.362116s;06:22.794, Memory: 137.00 MB.686hashes de toda fuente inventariada/pruebasPHP/config conservados después de full terminal,sin PHP/test edits durante suite. Logs `.uvh-runtime/s01-auth-mfa-controllers-{before,after-final,quality-final,full-backend}.log`;JUnit `backend-laravel/storage/logs/s01-auth-mfa-controllers-junit.xml` ysummaryruntime. Primera extracciónliteral378/3444después68,73s;quality mostró2advertencias previas trasladadas+supresión antigua sinmatch, antes de la limpieza explícita de doscoalesces ysu único bloque de baseline. No nuevoBugID ni supresiones añadidas. Inventario490/2273named/1171anonymous/3signatures/0provisional;358S01anchors/82files,16S03/2,63S10/9,198S02/31. Dos anchors adicionales dehelpers/controlador tienen evidencia acotada; logout queda leído/preservado, su posible frontera de audit no está reproducida ni tieneBugID. No nuevos tests deproducto/bugIDs/performanceclaim por extracción. Lectura completa adicional de LoginAdmission/MfaChallengeStore/MfaLoginAdmission/ReauthenticationAdmission/MfaConfigurationAdmission ycontratos de admisión de challenge/login/configuración; no equivale a gates Redis/SMTP/capacity reales.

**Objetivo global/S01–S13 activo.** La distribución de responsabilidades HTTP de Auth está verificada localmente: Auth sólo login/logout yotros dominios con propietarios independientes. Esto cierra la extracción de controladores, no la revisión completa de Auth/frontend o del proyecto. AuthService/frontend yrevisión de todasfunciones/roles/retención/capacidad/CI/operación real siguen abiertos. TTLregistry/configurable sigue candidato sin reproducción/ID. Logout mantiene su política protectora explícita ante averíaaudit, caracterizada por SessionHydrationBoundary; revisar garantías de evidencia durable preservando esa protección antes de cualquier cambio, sin tratar green previo como cierre global. Sin uvh_local/users/mail/providers/productiveworkers/scheduler/migraciones externas/commit/push/deploy;frontend sin cambio. O49 previo fue progreso con extracción real yfull2205/18889, no una espera narrativa ni cierre parcial del objetivo global.


O50 quality final:Pint503/PHPStan0,exit0. Repetición dedicada tras limpieza378/3444/62,67s. Full/JUnit terminó correctamente;686hashes de fuente/tests/config conservados tras handle terminal,sin PHP/test edits.


O50 cerrado sólo como separación local de controladores. Próximo plan `docs/superpowers/plans/2026-10-04-auth-security-lifecycle-followup.md`;objetivo global activo,resto de funciones/roles/retención/capacidad/CI/operación real pendientes. No nuevoFrontend/UI/provider/SMTP/Redis/nativecookie/capacityclaim. Handles propios terminales;servicios compartidos conservados.


## O51 — B185/P2, shared handoff counter lifetime

Reproduced before edits: configured48/168h handoffs stayed claimable after25h while security revocation expired their shared IP/global admission counters at24h; issue returned201 above the cap instead of429. Four failing cases/eight controls. Shared lifetime policy fixes the divergence;12new HTTP contracts plus related regression147/3569 and Pint505/PHPStan0 pass. Full2217/19429/421.163s/137MB,exit0;JUnit errors0/failures0/skips0,time418.530747s. All688frozen hashes matched after terminal suite;12newcases/540newassertions. No PHP/test edits during full. See the O51 section of `project-completion-audit-2026-09-30.md` for source proof, fixture limits and logs. Inventory491/2274named/1171anonymous/0provisional; baseline149/139 unchanged.

Global audit remains active. Next: `superpowers/plans/2026-10-04-auth-entry-transport.md`, then characterize frontend auth flow state; no new frontend/provider/Redis/production claim, no external migrations. Controller separation alone is complete locally. This phase does not close remaining functions/roles/retention/capacity/CI/operational requirements.


## O52 — gradual auth frontend transport separation

AuthEntryService/RegistrationService now own nine HTTP calls; AuthService648→619 retains identity/generation/workspace/state ownership and public API. Whole facade/new owners/types/decoder/script compared against explicit moves;800prior hashes preserved except three declared changes, all backend/old tests/callers unchanged.24new HTTP consumer contracts,407/407before/after; types/lint/build7.242s exit0. Full frontend1397/1397, ChromeHeadless9.852s (cases9.112s),exit0;804frozen source/test/config hashes match after terminal suite, no source/test edits during full.

Details/logs in the O52 section of `project-completion-audit-2026-09-30.md`. Inventory494/2283named/1171anonymous/0provisional;367S01anchors/84files,199S02/32;baseline149/139 unchanged. No new BugID/performance/native-cookie/provider/backend-full claim. Backend2217/19429 is the unchanged O51 gate, not a new run.

Global audit stays active. Next `superpowers/plans/2026-10-04-auth-flow-state.md`: read whole template/tests and characterize transitions before explicit state extraction. Remaining functions/roles/retention/capacity/CI/production requirements stay open; no real users, productive services or external migrations changed.

## O53 — estado del frontend de auth

Separación de AuthController confirmada por comparación completa actual:86líneas/login/logout y propietarios especializados preservados. Frontend: AuthFlowState reúne paso/desafío/política de recuperación, con proyecciones readonly y transiciones atómicas. Cinco casos nuevos pasan antes del cambio; después412auth y1402frontend completo, types/lint/build verdes. Comparación completa del componente/pruebas y805hashes actuales intactos; plantilla/estilos/backend conservados. QA aislada desktop/dark y móvil/light,6POSTs simulados, con límites registrados. Inventario495/2283named/1174anonymous;385S01anclas/84archivos;baseline149/139 y otros ledgers sin drift. No nuevo BugID ni garantía de proveedor/cookie nativa.

Detalles, logs y límites en el bloque O53 de `project-completion-audit-2026-09-30.md` y `superpowers/plans/2026-10-04-auth-flow-state.md`. El objetivo S01–S13 sigue activo; registros/verificación con autoridad de edición, demás funciones/roles y gates operativos aún requieren su revisión. No operaciones productivas ni migración externa/commit/push/deploy.

## O54 — B186 y estado de registro/verificación

B186/P2 corregido: el comparador de contraseñas de una propuesta abandonada bloqueaba la corrección de email cuando sus campos ya estaban ocultos. Rojo1/73antes de producto;75verde con restauración de igualdad/longitud/consentimiento al volver al alta. Estado explícito reúne etapa/modo/email original y procedencia de verificación en la unión compartida; seis proyecciones readonly reemplazan valores sueltos. Tres contratos más cubren correcciones sucesivas, contexto genérico y cuenta heredada después de otro contexto.

78antes/417auth/1407frontend completo; typecheck/lint/build exit0. Comparación completa del arreglo y de16adaptaciones de estado, cinco casos nuevos sin retirar aserciones,805hashes actuales intactos;802archivos ajenos y todo backend/servicios/interceptor/plantilla/estilos preservados. QA aislada con3POSTs y capturas confirma corrección/restauración/recuperación; no valida cookie/DB/mail/proveedor nativo. Inventario495/2283named/1180anonymous;386S01anclas/84archivos; baseline149/139 y otros ledgers intactos. Ver resultados/límites y logs en O54de `project-completion-audit-2026-09-30.md` y `superpowers/plans/2026-10-05-auth-registration-state.md`.

Objetivo global activo. Siguiente ampliación de código: permisos/membresías/invitaciones S03; los demás sistemas/roles y gates de retención/capacidad/CI/producción continúan abiertos. No operaciones productivas ni migración externa/commit/push/deploy.

## O55 — B187/P1, autoridad de sesión en recursos de enlaces

Confirmado por código yHTTP:41casos escribían después de invalidar la sesión (o tras la primera fila CSV);8controles válidos. WorkspaceMutation revalida cuenta/sesión concreta verificada ymembership en la misma TX antes de negocio;conserva bearer/roles/scopes/orden de locks/versiones/cuotas/idempotencia/audit/callbacks.49/277verdes,264/1630dedicadas,Pint506/PHPStan0. Full2266/19706/07:36.960/139MB,exit0;JUnit0errors/0failures/0skips.806hashes intactos tras terminal;802archivos previos ajenos yfrontend conservados, dos fixtures reciben sesión nativa sin cambiar aserciones.49casos nuevos;baseline149/139 sin ampliación.

Evidencia/límites/logs en O55del informe docs/project-completion-audit-2026-09-30.md yplan `superpowers/plans/2026-10-05-workspace-mutation-session-authority.md`. Inventario495/2283named/1180anonymous;S01 386/S03 18/S10 63/S02 199/S04 42anclas (S04distingue21probadas de21lecturas adicionales). Objetivo S01–S13 activo; siguiente `superpowers/plans/2026-10-05-link-write-session-authority.md` para escrituras directas/bulk/purge,candidatas sin ID. Restantes funciones/roles/UI/diseño/retención/capacidad/CI/operación abiertos. Ningún cambio productivo/migración externa/commit/push/deploy.

## O56 — B188/B189: sesión concreta en escrituras nativas

B188/P1: seis escrituras directas y nueve acciones bulk podían confirmar con sesión invalidada después del middleware;75rojos previos. B189/P1: purge aceptaba una sesión caducada; cinco rojos previos ycontroles deadline -1/0/+1 con password/recovery. Total80fallos/22controles/239aserciones antes de editar producto. WorkspaceWriteActor revalida cuenta/sesión o token/rol/scope dentro de TX originales; purge usa SecurityContext antes de factor/membership. Contratos internos, callbacks, cuotas, versiones ydispatch posterior al commit conservados.

134casos nuevos/697aserciones incluyen cinco clientes bearer sin cookie/concookie ajena,25rechazos de token/scope/rol/generación ybinding de actor/TX.16operaciones válidas comprueban un lock de cuenta yuno de sesión.313/1632dedicadas (59.81s),Pint508/PHPStan0. Full2400/20403,450.217s/141MB,exit0handle70207;JUnit0errores/0fallos/0omitidos,447.905136s.808hashes congelados comprobados post-terminal;802archivos previos ajenos ytodos los tests antiguos conservados. Cuatro archivos completos comparados con transformaciones declaradas; cadena histórica usa snapshots hash-verificados sin omitir digests. AuthController86/login/logout sigue con extracción HTTP completa verificada por O50.

Inventario496/2286named/1180anonymous/3signatures/0provisional. Anclas386S01/21S03/63S10/199S02/44S04; matriz185rutas/nueve columnas conserva todos los contratos/status/owners y sólo añade13celdas de evidencia. Logs `.uvh-runtime/s04-link-write-session-{red,green,extended,focused,quality-final,full-backend}.log`,JUnit `backend-laravel/storage/logs/s04-link-write-session-junit.xml`,summaryJSON y `verify-link-write-session-authority.py`. Fixture inicial sin verification_token yPHPDoc incompleto corregidos antes de gates finales; sinBugID de producto. El primer comprobador final de matriz separaba también pipes escapados yabortó antes de escribir; corregido al formato real con185rutas, sin cambio de producto.

Objetivo S01–S13 activo. Auditoría durable específica de éxito/replays yexpiración exacta bearer siguen candidatos sin nuevoID; restantes funciones/roles/UI/diseño/retención/capacidad/CI/operación abiertos. Hooks seriales no prueban todas las carreras entre procesos; no medición de latencia/capacidad ni nueva suitefrontend (1407O54 histórica). Sin uvh_local/cuentas/correo/proveedores/servicios productivos/migraciones externas/commit/push/deploy.

## O57 — B190/B191: admisión durable de eventos específicos

B190/P1 corregido en23operaciones nativas directas/bulk/recursos relacionados: el evento específico compartela TXdel cambio, incluidos metadatos yatribución actor/recurso/workspace/IP. B191/P1 corregido enCSV: resumen auditado yACKse sellan juntos; filas ya confirmadas permanecen yla misma clave reintenta sin duplicar enlaces ni evento. Actor capturaIP para eventolink enTXoriginal; wrapperadmite callbackespecífico antes del genérico; bulk libera su lease tambiénanteinterrupciónnoSQL. Sin nuevaTXexterior ni cambios al Auditglobal/autoridad/dispatch/roles/cuotas/stepup/payloads. Eliminados dos valores controller ya sinuso.

Rojo real48fallos/24controles/507aserciones,13.24s,exit1handle67417 (46B190/2B191); triggerPostgreSQL58000 específico yhookafterINSERT, sin cambiarproductoantes. Verde72/879/13.62s,exit0handle69379.101casos nuevos/1141aserciones finales incluyen23rollbackexterior SQL,5clientesbearer y1guardTX. Regresión520/3585/91.66s,exit0handle57270;Pint509/PHPStan0,exit0handle97462. Full2501/21544,424.676s/143MB,exit0handle38136;JUniterrors0/failures0/skipped0,time422.282519s.809hashes congelados intactos post-terminal;799fuentes/tests/config previos ajenos ytodos los tests anteriores conservados. Nueve archivos completos comparados contratransformacionesdeclaradas;cadena histórica preserva digests por snapshots preO57 yprueba independiente del endpoint actual. Baseline149/139 sinignore nuevo.

Inventario496/2287named/1187anonymous/3signatures/0provisional;ledgers386S01/22S03/63S10/199S02/44S04. Matriz185rutas/nuevecolumnas conservaowners/status/contratos salvo21celdasdeevidencia acotada. Logs `.uvh-runtime/s04-link-success-audit-{red,green,focused,format,quality,full-backend}.log`,JUnitbackend `storage/logs/s04-link-success-audit-junit.xml`,summaryJSON ywhole-file `verify-link-success-audit.py`. Primerharness67215 tenía48rojos reales y1expectativa bulk-move equivocada(count0porque yaestaba en destino);fixture corregida antes del rojo definitivo,sinBugID porharness.

Objetivo S01–S13 activo; este lote no cierra revisión global de auth/proyecto. Siguienteplan `superpowers/plans/2026-10-05-api-token-authority-deadlines.md`: middleware/lockedbearer enigualdaddeadline ysesiónexacta/emisión/revocación detokens browser, candidatos sinnuevoID;lecturaactual `o57-source-read-ahead/source-evidence.json`. Despachoauxiliar conTXexterior/CSV queda otrogate. Hooksseriales/trigger no prueban todaconcurrencia ni cookies/host/TLS/proveedor. Frontend no modificado (1407O54 histórico),sin medición delatencia/capacidad/CI/producción. Sin uvh_local/cuentas/correos/proveedores/serviciosproductivos/migracionesexternas/agentes/worktrees/commit/push/deploy.
