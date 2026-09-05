# UVH — checkpoint de continuidad

Fecha inicial: 4 de septiembre de 2026. Actualizado: 5 de septiembre de 2026.

Este documento permite continuar el proyecto aunque la interfaz de Codex pierda
la posición del historial o reabra un turno anterior. El código y los documentos
del workspace son siempre la fuente de verdad; este resumen no sustituye una
comprobación del estado actual antes de editar.

## Objetivo vigente

Dejar UVH preparado para producción mediante revisión manual extensa, corrección
de bugs y fallos de lógica, endurecimiento de seguridad, mejora profesional del
frontend y una interfaz local para iniciar y observar backend y frontend.

No se puede afirmar todavía que el sistema sea «100 % seguro» o esté listo para
producción mientras falten migraciones, E2E, infraestructura real, configuración
de secretos/proxy/TLS y validación jurídica.

## Restricciones acordadas

- Seguridad reiterada como prioridad expresa: aislamiento, permisos actuales,
  minimización y fallo cerrado; no afirmar seguridad absoluta sin validación.
- Nueva prioridad expresa el 5 de septiembre: tras BAF-138 (espera de invitaciones),
  comenzar roadmap opcional. Empezado PRODUCT-001; no exige cerrar producción
  antes de programar estas superficies, ni levanta las restricciones siguientes.
- No utilizar Codex Security.
- Continuar la revisión manual sin suites automatizadas hasta nueva autorización.
- No ejecutar preparación destructiva de pruebas contra `uvh_local`; cualquier
  validación futura debe usar una base aislada como `uvh_test`.
- Usar comentarios de código para invariantes, concurrencia y recuperación, no
  para describir literalmente cada instrucción.
- No aplicar las migraciones pendientes a `uvh_local` sin autorización expresa.

## Estado técnico conservado en el workspace

- Landing, autenticación y panel Angular han recibido un rediseño amplio, pero
  siguen pendientes revisión visual integral, accesibilidad y E2E reales.
- El flujo de intención de enlace usa token opaco y conserva la tarea durante el
  registro/login sin introducir el destino en la URL.
- Existen hCaptcha oficial, MFA/TOTP, recovery codes, reautenticación de
  administración, recuperación reforzada de cuenta y revocación de emergencia.
- Existen perfil, cambio de email/contraseña, sesiones, exportación personal,
  eliminación de cuenta y workflow de derechos RGPD.
- El sistema de dominios personalizados contiene verificación TXT/CNAME,
  estados DNS/TLS, jobs de provisión y configuración de edge; la infraestructura
  y los dominios reales todavía deben validarse.
- El outbox de correo durable, sus estados, compensación, reintento administrativo,
  métricas y purga están implementados en gran parte. BAF-115 cerró en código la
  admisión atómica de alta/verificación, solicitud de reset, cambio de email e
  invitación/reenvío. Se recorrieron estados, recuperación, purga y compensación.
  BAF-122/123 corrigen transportes `log` anidados, confirmaciones nulas y la parte
  de texto omitida. Hay un runbook operativo; ninguna suite ni entrega real se
  ejecutó para validar estos cambios.
- BAF-124 incorporó el aviso de incidente al commit de cambio/reset de contraseña
  y finalización de recuperación reforzada. El helper usa al usuario bloqueado,
  propaga el fallo de admisión y ya no abre una segunda transacción independiente.
  BAF-125 excluye el bearer nuevo de la limpieza de enlaces antiguos. Hay casos
  preparados de fallo tras INSERT, repetición de los tres flujos, rollback
  exterior y retención; ninguno se ejecutó.
- BAF-126 incorporó a sus transacciones los avisos de alta/sustitución de MFA,
  regeneración de códigos, desactivación y ambos buzones en cambio de email.
  Un segundo sobre fallido revierte también el primero. `SecurityNoticeAtomicityTest`
  tiene diez casos preparados (ocho MFA y dos de email), sin ejecutar. Se documentó
  que estos avisos históricos no deben volverse obsoletos por cambios posteriores.
- BAF-127 incorpora los avisos de token API y transferencia/borrado de workspace
  al commit: fallo de admisión devuelve `503` y revierte cambios. BAF-128 evita
  gastar recovery code persistido cuando un webhook ocupado rechaza el borrado.
- BAF-129 admite el aviso de cancelación protectora en un savepoint: comparte
  commit si se admite, pero si falla prevalece detener la eliminación; no se
  promete entrega posterior sin outbox. `WorkspaceNoticeAtomicityTest` tiene
  siete casos preparados, incluidos fallo SQL y segundo aviso, sin ejecutar.
  Rechazo/aprobación administrativa de recuperación ya usaban su transacción.
- BAF-130 aplica también al receptor de transferencias la cota de 20 workspaces,
  bajo el lock de usuario compartido con creación y antes de MFA. No cuenta
  pertenencias ajenas ni impide transferir hacia fuera con exceso histórico.
  `WorkspaceOwnershipLimitTest` prepara seis casos 19/20/21, incluido reintento
  tras borrar una plaza; no se han ejecutado ni ensayado carreras multiproceso.
- BAF-131 cierra la rama incompleta de BAF-009: caducidad de pendientes antes de
  reinvitar, renovación transaccional de expiradas, conflictos controlados y
  listado con caducidad efectiva sin escritura. El panel permite reenviar
  expiradas y refresca estado/fecha sin confundir fallo de refresco con correo.
  `InvitationExpiryTest` prepara once casos, sin ejecutar. Aceptar/rechazar
  invalida el enlace también en el instante exacto `expires_at`.
- BAF-132 cancela invitaciones pendientes de admin del owner anterior dentro de
  la transferencia; no toca editor/visor ni otros workspaces. BAF-133 cancela
  las emitidas al programar eliminación, además de las recibidas. Restaurar
  cuenta/autoridad no reactiva enlaces; fallos transaccionales revierten todo.
  Se revisaron degradación, expulsión, salida y bloqueo admin: ya cancelaban.
  `InvitationAuthorityLifecycleTest` prepara seis casos sin ejecutar; la UI
  advierte del efecto. No se han saneado datos de transiciones históricas.
- BAF-134 estabiliza el presupuesto 20/15 de invitaciones por cuenta/workspace
  sin ceros iniciales, compartido con reenvío; cambiar sesión ya no crea cuota.
  BAF-135 limita a 100 pendientes vigentes bajo lock; renovar una vencida ocupa
  plaza, reenviar una viva la reutiliza. `InvitationBudgetTest` prepara nueve
  casos, no ejecutados. No se aplicaron migraciones ni se borró historial.
  BAF-041 se reclasificó como mitigado: destinatario/IP/volumen diario y alertas
  siguen en `INVITATION-004`; no atribuir esas garantías al throttle existente.
- BAF-136 añade `InvitationMailBudget`: reserva SQL compartida con invitación
  y outbox, destinatario del reenvío desde la fila bloqueada, dimensiones
  cuenta/workspace/destinatario/IP/global y cooldown. Locks ordenados, reloj DB,
  HMAC con keyring, `429` con espera y `503` cerrado; métricas y purga acotada.
  Migración nueva `2026_09_05_000032_create_invitation_mail_budgets.php` escrita,
  NO aplicada. Trece casos preparados en `InvitationMailBudgetTest`, sin ejecutar.
  El `TestCase` limpia contadores sin FK tras el guard `*_test`; exige esquema
  completo. Runbook nuevo y solapamiento de claves actualizado a 24 horas.
  `INVITATION-004` sigue abierto por migración, calibración, concurrencia y alertas.
- BAF-137 añade `ReleaseReadiness` y `uvh:release-check` de sólo lectura:
  registro/pendientes, tabla/columnas 000032 y límites compartidos con admisión.
  Entrypoint estándar de producción bloquea PHP-FPM/queue/scheduler, no `migrate`;
  los healthchecks de contenedor repiten el gate. Siete casos preparados en
  `UvhReleaseCheckTest`, sin ejecutar. No se probó la imagen ni se aplicó esquema;
  no comprueba todo el esquema ni cambia el endpoint HTTP `/health`.
- `docs/todos.md` ya separa implementación, validación, producción y las 25 ideas
  opcionales `PRODUCT-*`. La radiografía inicial está escrita; no reconstruirla
  desde cero ni usar conteos históricos como medidas de cierre.
- BAF-138 conserva `Retry-After` en promesas/observables/blob y añade cuenta atrás
  en Equipo por workspace/email, con guards crear/reenviar/Enter, cancelación libre
  y sin envío automático. Memoria de componente, timer limpiado al destruir, sin
  persistencia de emails ni coordinación entre pestañas. Diecisiete casos frontend
  preparados (parser/API/servicio/handlers), sin ejecutar ni typecheck/build/E2E.
- PRODUCT-001 iniciado por nueva prioridad: `WorkspaceOnboardingController`, GET
  `/api/v1/workspaces/:id/getting-started` verificado y limitado, consulta única con
  autorización/correlación y hechos minimizados. Tipo `WorkspaceGettingStarted`
  en Angular y cinco casos `WorkspaceOnboardingTest`, sin ejecutar. Ahora también
  pantalla `/app/getting-started`, menú y tarjeta compacta en Dashboard; omitir y
  reanudar guarda sólo preferencia por usuario/workspace, no progreso. Al observar
  enlace/redirección/MFA se oculta la tarjeta; dominio/equipo son opcionales.
  Respuestas obsoletas se descartan por contexto/número/destrucción y omitir
  funciona incluso cargando/error. Trece casos frontend preparados, sin ejecutar.
  PRODUCT-001 marcado como implementado; PRODUCT-VALID-001 abierto. No añadió
  migración ni se abrió navegador; detalles en `docs/getting-started-roadmap.md`.
- PRODUCT-002 iniciado: 000033 añade `audit_events.workspace_id` nullable positivo
  sin FK e índice de timeline; migración escrita, NO aplicada. `Audit::write`
  conserva scope explícito en afterCommit y deriva sólo del ID cuando el propio
  recurso es workspace. No infiere actor/metadata/cabecera ni hace backfill.
  Enlaces/dominios/tokens/webhooks, DNS/TLS y moderación de enlaces/denuncias llevan
  el contexto capturado; los eventos workspace ya quedan atribuidos por identidad.
  Fallo de audit sigue no bloqueante, sin reintento quitando scope. Release check
  valida la columna; contrato de esquema actualizado. Seis casos de atribución y
  un caso adicional de release preparados (ocho release en total), sin ejecutar.
  Ya hay GET `/api/v1/workspaces/:id/activity` owner/admin: catálogo cerrado,
  DTO mínimo, sin metadata/email/IP, actor por ID actual o indisponible/moderación,
  resultados explícitos y cursor cifrado `Crypt` (APP_KEY) ligado a cuenta,
  workspace/security_version con TTL 1h no renovable. Páginas 1–100, locks/SQL
  con límites locales 2s/5s, throttle 60/min por cuenta más IP120/min. Veinte casos
  API preparados, sin ejecutar. Pantalla `/app/activity` y menú owner/admin ya
  implementados: DTO separado, fechas UTC/resultados/cobertura, páginas manuales
  de 25 y cota 500 ajustada tras páginas cortas. Invalida por contexto, ignora
  respuestas tardías/destroy, borra todo ante errores y no reintenta solo.
  Cursor sólo en memoria; proyección de campos acotados sin HTML dinámico.
  29 casos frontend preparados (18 componente, 5 DTO y 6 navegación), sin ejecutar.
  PRODUCT-002 marcado implementado, PRODUCT-VALID-002 abierto; runbook actualizado.
- BAF-116/118/120 añadieron señales de antigüedad e incidentes; BAF-119 minimizó
  el listado webhook. BAF-121 documentó la rotación existente de `APP_SECRET` y
  añadió contratos pendientes. Los contratos operativos de API se actualizaron.
- La consola local `UVH Control` inicia y observa Docker, backend y frontend sin
  bloquear la GUI. Incluye reparación elevada y recuperable de sockets IPC de
  Docker Desktop, sin borrar imágenes, contenedores, volúmenes ni datos.
- La depuración posterior añadió manejo de salida/stderr vacío y detalle de
  proceso/archivo del panel. No se repitió aquí la validación de su GUI ni se
  refrescó el estado de Docker/HTTP.
- La reparación local archivó runtimes corruptos de Docker como directorios
  `.stale-*`; Docker, los servicios y ambos HTTP respondieron después. Este dato
  era válido en la comprobación de las 16:41 y debe refrescarse antes de usarlo.
- `uvh_local` tenía 17 migraciones aplicadas y 16 pendientes, hasta la migración
  `000031`, en la última comprobación. No se aplicaron automáticamente.

## Próximo punto exacto de continuación

1. Continuar PRODUCT-003 (uso y límites) desde `docs/todos.md`: primero contrastar
   cuotas reales de enlaces/dominios/miembros/tokens/webhooks y retención; después
   implementar API/UI minimizadas por rol, sin inventar capacidades ni planes.
   PRODUCT-001 y PRODUCT-002 ya tienen API/UI implementadas; validación separada
   pendiente, no repetirlas. `docs/workspace-activity-roadmap.md` conserva límites
   de privacidad/retención, cursor y despliegue. Auditoría afterCommit puede perder
   eventos y la UI no revoca por push datos ya entregados. Nada de aplicar
   migraciones, backfill o suites sin autorización.
2. BAF-138 ya implementó la espera UI: no repetirla. La revisión manual de jobs,
   avisos/consistencia y `/health` sigue abierta pero la prioridad ahora es roadmap
   opcional. El siguiente hallazgo nuevo será posterior a BAF-138; PRODUCT-001 no
   se registró como vulnerabilidad ni se considera validado/desplegado.
3. Mantener abiertos `MAIL-002` y los gates de validación/producción: alertas,
   retención aprobada, fault injection y proveedor real no se han acreditado.
4. No ejecutar pruebas automatizadas ni aplicar migraciones sin autorización.
   `php` no estaba en PATH en esta pasada; tampoco se ejecutó lint PHP.

## Archivos de referencia

- `docs/todos.md`: lista viva; contiene backlog técnico, legal, validación y
  roadmap de producto ya clasificado.
- `docs/project-radiography-2026-09-04.md`: contraste estático por subsistema;
  diferencia código presente, validación pendiente y preparación de producción.
- `docs/backend-audit-findings.md`: historial acumulativo de hallazgos manuales.
- `docs/production-readiness.md`: gate de producción e infraestructura.
- `docs/local-control.md`: operación de la consola local.
- `tools/uvh-control.ps1`: controlador CLI/WinForms.
- `tools/repair-docker-sailor-socket.ps1`: reparación elevada recuperable.
- `backend-laravel/app/Support/UvhMail.php`: admisión del outbox.
- `backend-laravel/app/Jobs/DeliverMailOutboxJob.php`: entrega y reintento.
- `backend-laravel/app/Support/MailOutboxCompensation.php`: compensación durable.
- `backend-laravel/app/Support/MailTransportPolicy.php`: validación compartida
  de transportes efectivos en envío, arranque y consola operativa.
- `docs/mail-outbox-runbook.md`: estados, tiempos, recuperación y ensayo pendiente.
- `backend-laravel/tests/Unit/MailTransportPolicyTest.php`,
  `tests/Feature/MailTransportTest.php` y `tests/Unit/ProductionSecurityTest.php`:
  regresiones de transporte preparadas, no ejecutadas (rutas bajo backend-laravel).
- `backend-laravel/tests/Feature/PasswordNoticeAtomicityTest.php`: tres flujos con
  fallo tras INSERT y reintento, rollback exterior y limpieza del bearer nuevo;
  requiere el esquema completo en `*_test`, no ejecutado.
- `backend-laravel/tests/Feature/SecurityNoticeAtomicityTest.php`: MFA y fallo del
  segundo aviso de email; usa caché de prueba para conservar la marca TOTP fuera
  del rollback SQL. Requiere esquema completo en `*_test`; no ejecutado.
- `backend-laravel/tests/Feature/WorkspaceNoticeAtomicityTest.php`: tokens,
  propiedad/borrado, webhook ocupado y cancelación protectora con savepoint.
- `backend-laravel/tests/Feature/WorkspaceOwnershipLimitTest.php`: cuota de
  propiedad al crear/recibir, exceso histórico y plaza liberada por borrado.
  Ambos requieren esquema completo en `*_test`; no ejecutados.
- `backend-laravel/tests/Feature/InvitationExpiryTest.php`: once casos de
  caducidad/renovación y rollback. Requiere esquema completo en `*_test`;
  no ejecutado, ni tampoco compilación o E2E del panel modificado.
- `backend-laravel/tests/Feature/InvitationAuthorityLifecycleTest.php`: seis
  casos de pérdida/retorno de autoridad, rollback y restauración de eliminación;
  requiere esquema completo `*_test`, sin ejecutar.
- `backend-laravel/tests/Feature/InvitationBudgetTest.php`: nueve casos de
  presupuesto/capacidad; usa la caché array declarada en PHPUnit y requiere
  esquema completo en `*_test`. No ejecutado, no es ensayo multiproceso.
- `backend-laravel/app/Support/InvitationMailBudget.php`, migración 000032 y
  `backend-laravel/tests/Feature/InvitationMailBudgetTest.php`: presupuesto SQL,
  trece casos preparados; no ejecutados. `docs/invitation-mail-budget-runbook.md`
  documenta límites iniciales, atomicidad, despliegue, keyring y validación pendiente.
- `backend-laravel/app/Http/Controllers/AuthController.php`: avisos de contraseña,
  MFA y cambio de email corregidos estáticamente; no hay evidencia runtime nueva.

## Regla para reanudar

Antes de continuar desde otra tarea, inspeccionar las fechas y el contenido de
los archivos anteriores. No marcar una casilla ni afirmar que algo está acabado
basándose solamente en este checkpoint.
