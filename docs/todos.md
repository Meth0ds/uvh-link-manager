# UVH — TODOs técnicos, de cuenta y de lanzamiento

Última revisión manual: 6 de septiembre de 2026.

Este archivo distingue implementación de código y validación real. Una tarea
marcada como implementada no equivale a estar desplegada, probada ni aprobada
jurídicamente. El 5 de septiembre se autorizó una pasada de estabilidad en el
entorno aislado `uvh_test`: 250 pruebas backend (2078 aserciones) y, tras el lote
de sesión/Ajustes/enlaces/autenticación, flujos bearer, denuncia y diálogo de
workspace, consola administrativa, borde HTTP de identidad, cobertura completa
de Ajustes, contratos sensibles de cuenta, credenciales de workspace y handoff
de enlaces, snapshots de Equipo/workspace y cierre de contratos runtime, 231 pruebas frontend finalizaron
correctamente;
también pasaron typecheck, build, lint PHP y
`uvh:release-check`. Composer y dependencias npm de producción no tienen avisos
conocidos; el árbol npm completo quedó en 0 críticos/altos y 5 moderados de la
cadena local de desarrollo, documentados abajo. Esto no sustituye E2E,
concurrencia multiproceso, infraestructura real ni revisión legal.

La fotografía transversal que contrasta estos estados con rutas, controladores,
migraciones y pantallas está en `docs/project-radiography-2026-09-04.md`.

## Índice operativo por tipo de trabajo

Una casilla marcada sólo acredita que existe una implementación revisada de
forma manual. No acredita pruebas E2E, despliegue, conformidad jurídica ni
preparación para producción. Las secciones posteriores conservan el detalle de
cada flujo bajo estas cuatro categorías; no se debe cerrar una tarea por una
implementación parcial.

### 1. Implementación y cierre técnico

- [x] **INTENT-001 — Finalización recuperable.** Token opaco local, invalidación
  reintentable y vencimiento de 24 horas implementados.
- [x] **INTENT-002 — Admisión compensable.** Diferenciación `429`/`503` y
  compensación exacta de reservas implementadas.
- [x] **MAIL-001 — Outbox transaccional durable.** Estado, sobre cifrado,
  idempotencia, despacho posterior a commit y recuperación de `pending`
  implementados; todavía requiere la validación descrita en la sección 2.
- [x] **CRYPTO-001 — Rotación solapada de `APP_SECRET`.** Keyring temporal,
  deadline, recifrado reanudable, overlay de secretos y runbook implementados;
  el ensayo operativo permanece en la sección 2.
- [x] **API-DOC-001 — Contratos operativos.** Documentados challenges MFA,
  recovery codes de un solo uso, dominios asíncronos, `409/429/503`, límites de
  listados y entrega webhook al menos una vez con firma y deduplicación.
- [x] **WORKSPACE-001 — Cuota coherente de propiedad.** Crear y recibir una
  transferencia comparten el máximo de 20 y el lock del propietario receptor;
  rechazo previo a MFA, sin cambios ni correo. BAF-130; revisión estática.
- [x] **INVITATION-001 — Caducidad y renovación coherentes.** Una pendiente
  vencida no bloquea reinvitar; el panel muestra caducidad efectiva sin escribir
  desde GET y puede reenviar expiradas. Renovación y correo comparten rollback;
  rechazo de enlaces en el instante de caducidad. BAF-131; revisión estática.
- [x] **INVITATION-002 — Revocación persistente al perder autoridad.** Transferir
  propiedad cancela las pendientes de admin del antiguo owner; programar la
  eliminación cancela también las enviadas. No reviven al recuperar autoridad
  o cuenta. BAF-132/133; transacciones y avisos de interfaz revisados estáticamente.
- [x] **INVITATION-003 — Presupuesto estable y capacidad activa.** 20 intentos
  por cuenta/workspace cada 15 minutos, compartidos entre crear/reenviar y sin
  reinicio por sesión o ceros iniciales del ID. Máximo inicial de 100 pendientes
  vigentes bajo lock del workspace; renovar una vencida requiere plaza. BAF-134/135.
- [ ] **INVITATION-004 — Presupuestos de correo complementarios (código presente;
  operación pendiente).** Reserva SQL de cuenta/workspace/destinatario/IP/global,
  cooldown, rollback, métricas y limpieza de contadores implementados en BAF-136.
  La migración 000032 y sus contratos pasaron en `uvh_test`; falta desplegarla en
  cada entorno autorizado, validar multiproceso, calibrar valores, coordinar el
  keyring y conectar alertas. Procedimiento en
  `docs/invitation-mail-budget-runbook.md`. No cerrar BAF-041 sólo por este código.
- [x] **RELEASE-001 — Comprobación previa de esquema.** `uvh:release-check`
  de sólo lectura integrado en arranque de producción y healthchecks de
  contenedor. Detecta migraciones pendientes, esquema de presupuesto ausente y
  límites inválidos; no aplica migraciones y deja disponible el job `migrate`.
  BAF-137; revisión estática, no acredita despliegue ni el conjunto del esquema.
- [x] **INVITATION-UI-001 — Espera de reenvío visible.** `ApiRequestError`
  conserva `Retry-After`; Equipo muestra espera por workspace/destinatario tras
  `429`, bloquea crear/reenviar/Enter durante ese plazo y permite cancelar.
  Sin reenvío automático ni persistencia del email. BAF-138; revisión estática.
- [x] **FRONTEND-STABILITY-001 — Aislamiento y tolerancia a fallos.** Se cerraron
  38 modos reproducibles BAF-143–180: respuestas tardías y datos/secretos entre
  workspaces, sondeos tras destruir, Storage parcial o mal tipado, QR rechazado,
  Object URLs prematuros, webviews sin `matchMedia` e IDs de workspace inválidos.
  Los 125 casos frontend, typecheck y build pasaron. Falta E2E/QA visual real;
  inventario en `docs/frontend-stability-batch-2026-09-05.md`.
- [x] **FRONTEND-STABILITY-002 — Sesión y Ajustes bajo respuestas tardías.**
  Generación monotónica impide que init/login/MFA/perfil/secretos de una cuenta
  anterior resuciten o sobrescriban una sesión nueva; 401/403 sólo afectan a la
  petición autenticada y generación que los originó, y la cabecera workspace se
  limita a APIs tenant. Ajustes descarta listados obsoletos o destruidos, conserva
  el resultado de mutaciones sensibles aunque falle el refresco, ofrece secreto
  MFA manual si falla el QR y revierte la selección si la navegación se cancela.
  Typecheck, build y 143 casos frontend pasaron; quedan E2E real y los candidatos
  abiertos de `docs/bug-analysis-100-candidates-2026-09-05.md`.
- [x] **FRONTEND-STABILITY-003 — Contrato y ciclo de vida del diálogo de enlaces.**
  Fechas, UTM y reglas se validan antes de enviar con los mismos límites del
  servidor; destino de regla vacío conserva su semántica de borrado. Tags y
  reglas respetan el máximo de 20, los tags se deduplican sin distinguir
  mayúsculas y un alias no disponible bloquea el guardado. Subscripciones,
  debounce, cargas y submit ignoran finalizaciones posteriores al cierre. Cinco
  regresiones directas elevan la suite a 148 casos; typecheck y build pasaron.
- [x] **FRONTEND-STABILITY-004 — Flujos de acceso correlacionados.** Configuración
  hCaptcha, login, MFA, recovery, registro/cambio de email y reenvío descartan
  respuestas de otra revisión o de una vista destruida. El destino se captura al
  iniciar, el challenge debe seguir vigente y el login interactivo no compite con
  la redirección de visitantes ya autenticados. Los cambios de pestaña quedan
  deshabilitados durante operaciones sensibles. Siete regresiones nuevas elevan
  la suite a 155; typecheck y build pasaron.
- [x] **FRONTEND-STABILITY-005 — Aceptación de invitaciones correlacionada.** La
  inicialización, aceptar, rechazar y cambiar de cuenta sólo actualizan una vista
  viva, con el mismo bearer y —cuando corresponde— la misma generación de sesión.
  Un bearer nuevo no puede ser borrado por una respuesta antigua; fallo de
  `auth.init()` abandona el loading con mensaje recuperable, y aceptación
  confirmada se mantiene aunque falle el refresco de workspaces. Cinco pruebas
  directas elevan la suite a 160; typecheck y build pasaron.
- [x] **FRONTEND-STABILITY-006 — Recuperación y confirmaciones bearer.** Forgot,
  reset, recuperación reforzada, verificación de email, exportación, eliminación,
  cancelación e incidente descartan resultados de vistas destruidas. Los cambios
  que limpian cookie actualizan el estado global sólo si conservan la generación
  que los inició, evitando expulsar un login posterior. Reautenticación MFA tiene
  una única navegación terminal. Catorce regresiones elevan la suite a 174;
  typecheck y build pasaron.
- [x] **FRONTEND-STABILITY-007 — Denuncia y diálogo de workspace.** La carga de
  hCaptcha de denuncia aplica sólo la revisión más reciente; submit y alta/edición
  de workspace capturan su contexto y no escriben, resetean ni cierran una vista
  destruida. Se restauraron los seis casos históricos de denuncia y se añadieron
  tres regresiones dirigidas entre ambos componentes. La suite completa alcanza
  177 casos; typecheck y build pasaron sin tocar backend ni bases de datos.
- [x] **FRONTEND-STABILITY-008 — Consola administrativa correlacionada.** Los
  listados de recuperaciones, usuarios, denuncias, dominios, auditoría, outbox y
  privacidad, además de overview y operaciones, descartan respuestas antiguas y
  finalizaciones tras destroy. Cada petición captura filtros y paginación; una
  recarga antigua no apaga la vigente y las acciones sobre filas en recarga se
  deshabilitan. Once regresiones elevan la suite a 188; typecheck y build pasaron
  sin tocar backend ni bases de datos.
- [x] **FRONTEND-STABILITY-009 — Decodificación runtime de identidad.** El borde
  HTTP permite decoders opt-in y convierte contratos inválidos en un error 502
  controlado sin incluir cuerpos ni detalles internos. `AuthService` valida
  identidad, resultados login/MFA y la lista completa de workspaces antes de
  publicar estado. Seis regresiones elevan la suite a 194; typecheck y build
  pasaron. BUG-083 sigue abierto hasta cubrir los demás DTO sensibles.
- [x] **FRONTEND-STABILITY-010 — Intercalaciones completas de Ajustes.** Las
  cargas de sesiones, exportación, impacto de eliminación y solicitudes de
  privacidad cuentan con regresiones directas que demuestran última petición y
  generación/página vigentes, incluido el loading. Tres casos nuevos elevan la
  suite a 197; typecheck y build pasaron. BUG-070–073 quedan reclasificados como
  confirmados/corregidos.
- [x] **FRONTEND-STABILITY-011 — Contratos runtime sensibles de cuenta.** Todos
  los resultados que `AuthService` consume para publicar sesión, tenant, MFA,
  perfil, exportación, eliminación, sesiones o recovery codes se validan antes
  de alterar estado o llegar a la interfaz. Los decoders rechazan estructuras,
  enums, enteros, booleanos y secretos malformados mediante un 502 controlado,
  sin adjuntar cuerpos ni detalles internos. Cinco regresiones nuevas elevan la
  suite a 202; typecheck y build pasaron. BUG-083 sigue probable porque aún falta
  inventariar y proteger los DTO sensibles consumidos fuera de `AuthService`.
- [x] **FRONTEND-STABILITY-012 — Credenciales e intenciones en el borde HTTP.**
  Listas y altas de tokens API, webhooks y entregas se reconstruyen de forma
  atómica con límites, IDs, scopes, eventos, estados y booleanos comprobados. Los
  secretos de una sola visualización se publican sólo si cumplen el contrato del
  servidor. El handoff valida bearer, caducidad acotada y URL http/https sin
  credenciales antes de abrir un diálogo o navegar. El modelo de entrega incorpora
  `next_attempt_at`, ya emitido por Laravel. Siete regresiones elevan la suite a
  209; typecheck y build pasaron. No se tocaron backend ni bases de datos.
- [x] **FRONTEND-STABILITY-013 — Roles y Equipo ligados a la petición.** El
  detalle de workspace se reconstruye por completo antes de publicarse y valida
  roles, miembros, invitaciones, estados y paginación. El decoder queda ligado al
  workspace, página y tamaño capturados, por lo que una respuesta bien formada
  pero de otro tenant o contexto también se rechaza. La creación sólo acepta un
  resultado que conceda `owner` antes de cerrar el diálogo. Cinco regresiones
  nuevas elevan la suite a 214; typecheck y build pasaron sin tocar backend ni
  bases de datos.
- [x] **FRONTEND-STABILITY-014 — Cierre transversal de contratos runtime.** El
  inventario de cuerpos JSON realmente consumidos queda cubierto por decoders o,
  en actividad de workspace, por su lector runtime manual. Se añadieron enlaces,
  detalle/reglas/analítica, dominios, todos los listados y snapshots de
  Administración, privacidad de cuenta y operador, onboarding, configuración
  pública y confirmaciones bearer. Los listados se ligan a página/tamaño y los
  DTO se reconstruyen con límites, IDs, enums, booleanos y URLs verificadas antes
  de publicarse. Diecisiete regresiones nuevas elevan la suite a 231; las 36
  pruebas específicas de decoders, typecheck, build y suite completa pasaron.
  BUG-083 queda confirmado y corregido. No se tocaron backend ni bases de datos.
- [x] **AUTH-HCAPTCHA-001 — hCaptcha invisible y compatibilidad local segura.**
  Login, registro y reenvío ejecutan el widget invisible al enviar, consumen un
  token fresco por intento, deduplican dobles clics y descartan cierres,
  caducidad y errores. El backend acepta el hostname sintético de hCaptcha sólo
  fuera de producción y sólo con su sitekey oficial de prueba; cualquier otra
  combinación mantiene el binding estricto. Typecheck, build, 234/234 pruebas
  frontend y 4 pruebas hCaptcha/18 aserciones backend pasaron; backend usó
  exclusivamente `uvh_test` y no se migró ni probó `uvh_local`.
- [ ] **MAIL-002 — Operación y privacidad del outbox (implementación amplia;
  cierre pendiente).** Ya existen reintento administrativo acotado, antigüedad
  de cola, métricas sin contenido, purga configurable y compensación por
  generación. Revisados estáticamente los estados y transportes; procedimiento en
  [`mail-outbox-runbook.md`](mail-outbox-runbook.md). Faltan conectar alertas
  externas, aprobar la retención y validar recuperación, reintentos y
  compensaciones con fallos reales.
- [ ] **DATA-001 — Retención de colecciones (mecanismos presentes; política
  pendiente).** La paginación y las purgas configurables de tokens, outbox, jobs
  fallidos y auditoría existen en código; falta aprobación jurídica/operativa y
  validación sobre una copia representativa.
- [x] **DATA-002 — Snapshot coherente de exportación.** El presupuesto de filas
  y las doce secciones del export se leen dentro de una transacción PostgreSQL
  `REPEATABLE READ READ ONLY`. La transacción termina antes de serializar, cifrar,
  escribir el artefacto o admitir correo, evitando I/O y locks prolongados. La
  prueba dirigida (8 aserciones) y la suite completa de 250 pruebas/2078
  aserciones pasaron en `uvh_test`; no se aplicaron migraciones ni se tocó
  `uvh_local`.
- [ ] **DEPENDENCY-001 — Avisos moderados del servidor de desarrollo.** Se
  fijaron `fast-uri@3.1.7`, `less@4.9.1` y `qs@6.16.0`, eliminando todos los
  avisos altos/críticos; typecheck, build y 101 casos pasaron después. Permanecen
  cinco avisos moderados agregados por `webpack-dev-server → sockjs → uuid@8`.
  SockJS sólo invoca `uuid.v4()` (el advisory afecta v3/v5/v6) y UVH liga `ng
  serve` a `127.0.0.1`. No forzar `uuid@11`: esperar una actualización compatible
  de Webpack/SockJS y repetir `npm audit` al actualizar el lockfile.
- [ ] **OPS-UI-001 — Consola local de servicios (implementación inicial;
  cierre pendiente).** Validar y documentar `UVH Control` como interfaz para
  iniciar, detener y comprobar backend/frontend sin privilegios elevados ni
  exposición de secretos. Debe mostrar salud HTTP real, puertos, procesos
  propios, últimas incidencias y acceso a logs; detener únicamente procesos que
  haya iniciado, recuperarse tras un cierre inesperado y funcionar tras reinicio
  de Windows antes de considerarla terminada.
  - [x] Desacoplar inicio, parada, reinicio, migraciones y diagnóstico del hilo
    de WinForms; impedir operaciones concurrentes y mostrar actividad periódica.
  - [x] Evitar rebuilds rutinarios, registrar Angular con identidad atómica y
    validar manualmente `Start`/`Status` el 4 de septiembre: Docker operativo,
    frontend HTTP `200` y backend HTTP `200` identificado como lento.
  - [x] Recuperar Docker Desktop detenido y reparar mediante UAC los runtimes
    IPC corruptos `Docker\run` y `docker-secrets-engine` archivándolos sin borrar
    imágenes, contenedores o volúmenes; detectar la recurrencia sin esperar el
    timeout completo.
  - [x] Mostrar migraciones reales mediante una consulta local sin contraseña:
    la base `uvh_local` tiene 33 aplicadas y 3 pendientes (000032–000034) en la
    comprobación de las 16:46 del 5 de septiembre; el panel no aplicó ninguna.
  - [x] Normalizar stdout/stderr vacíos en Windows PowerShell 5.1, fijar el
    estado del temporizador/proceso y contener excepciones del callback para que
    no escapen al diálogo JIT. El acceso a `Exception.Response` también comprueba
    primero que la propiedad exista bajo StrictMode. `Status` terminó sin error
    el 5 de septiembre; Docker/PostgreSQL estaban sanos y ambos HTTP detenidos.
  - [ ] Validar visualmente los botones de la GUI, parada/reinicio completos,
    cierre de la ventana durante una operación y recuperación tras reiniciar
    Windows. No cerrar este punto sólo por funcionar en modo de consola.

### 2. Validación manual, E2E y resiliencia

- [x] **BROWSER-E2E-001 — Base Playwright aislada.** Quince recorridos reales
  sobre Chromium, Angular, Laravel y PostgreSQL pasaron juntos el 6 de septiembre
  en 16,7 minutos. Incluyen identidad, MFA/recovery, cambio de email, exportación,
  workspace/enlace/papelera, invitación y token Bearer. hCaptcha y la entrega de
  correo usan adaptadores locales deterministas, pero la verificación antiabuso
  continúa siendo servidor a servidor. La base `uvh_e2e_test`, los contenedores y
  la red se eliminaron al terminar; `uvh_local` no se tocó. Alcance y límites en
  `docs/e2e-testing.md`.
- [ ] **PRODUCT-VALID-001 — Primeros pasos.** Los cinco casos backend y trece
  frontend pasaron el 5 de septiembre dentro de las suites completas; typecheck
  y build también pasaron. Faltan E2E con cambios de cuenta/workspace/rol,
  omitir/reanudar entre visitas y QA visual/accesible. Detalle en
  `docs/getting-started-roadmap.md`.
- [ ] **RELEASE-VALID-001 — Arranque y deriva del esquema.** Los nueve casos de
  `UvhReleaseCheckTest` pasaron en `uvh_test` y el comando de sólo lectura pasó
  con las 36 migraciones aisladas aplicadas. Una migración limpia desde base
  vacía y los contratos de esquema/release (12 casos, 290 aserciones) pasaron en
  `uvh_clean_20260905_1648_test`, eliminada después. Probar además la imagen real:
  fallo antes de servir/procesar y pérdida posterior de readiness.
- [ ] **PRODUCT-VALID-002 — Actividad y atribución.** Los seis casos de
  `AuditWorkspaceAttributionTest`, veinte de `WorkspaceActivityTest` y 29 casos
  frontend pasaron el 5 de septiembre con 000033 aplicada sólo en `uvh_test`.
  Typecheck y build también pasaron. Faltan E2E, visual/accesibilidad,
  rendimiento, concurrencia y despliegue.
- [ ] **INVITATION-UI-VALID-001 — Contrato y cuenta atrás.** Diecisiete casos
  pasaron en `retry-after.spec.ts`, `api.service.spec.ts`,
  `invitation-retry.service.spec.ts` y `team.component.spec.ts`; typecheck y build
  también pasaron. Falta E2E, navegación durante peticiones, pestaña suspendida,
  teclado/lector de pantalla y visual móvil/temas. No confundir espera UI con cuota.
- [ ] **INVITATION-VALID-001 — Ciclo de vida de invitaciones.** Los once casos de
  `InvitationExpiryTest` pasaron: renovación, rollback,
  generaciones, frontera temporal, listado sin escritura y conflictos.
  También pasaron los seis de `InvitationAuthorityLifecycleTest`: retorno de propiedad,
  rollback del segundo aviso, suspensión/restauración explícita o compensada,
  rollback tras revocar invitaciones y degradación/promoción; los nueve casos de
  `InvitationBudgetTest` cubrieron sesiones y formas del ID,
  creación 99/100, cancelación que libera plaza, reenvíos vigentes/vencidos,
  exceso histórico y rollback; y los trece de `InvitationMailBudgetTest` cubrieron
  dimensiones compartidas, destinatario real, fallos SQL/outbox,
  autoridad/configuración, rotación y limpieza. Todo se ejecutó en `uvh_test`.
  Falta concurrencia real de varios administradores. Playwright ya cubre crear
  una invitación, verificar al destinatario, aceptarla y seleccionar el workspace
  concedido como `viewer`; siguen pendientes carreras de aceptar/cancelar/reenviar,
  cambios de autoridad del invitador y eliminación de cuentas. No ejecutar contra
  `uvh_local`.
  Revisar el estado heredado de transiciones anteriores al parche antes de
  afirmar saneamiento histórico; no se ha aplicado ninguna reparación de datos.
- [ ] **WORKSPACE-VALID-001 — Límites y concurrencia de propiedad.** Los seis
  casos de `WorkspaceOwnershipLimitTest` pasaron: 19/20/21 al crear
  y transferir, pertenencias ajenas, salida de un propietario con exceso y
  reintento con el mismo recovery code tras liberar una plaza mediante borrado.
  Añadir validación multiproceso de crear/transferir y dos transferencias hacia
  el mismo receptor con una plaza libre; esa parte concurrente sigue pendiente.
- [ ] **OUTBOX-VALID-001 — Matriz transaccional y de fallos.** Demostrar en una
  base aislada que cuenta/bearer/invitación y outbox confirman o revierten juntos;
  simular caída antes/después de commit, publicación perdida, worker detenido,
  proveedor caído, obsolescencia, agotamiento y compensación generacional.
  Incluir cambio/reset/finalización de recuperación, conservación del enlace
  nuevo y rollback exterior de `PasswordNoticeAtomicityTest` (casos unitarios pasados).
  Incluir también `SecurityNoticeAtomicityTest`: MFA y fallo del segundo aviso
  de cambio de email, sin sobres/publicaciones parciales (casos pasados).
  Añadir `WorkspaceNoticeAtomicityTest`: tokens, transferencia/borrado, webhook
  ocupado y cancelación protectora con savepoint (casos pasados). Siguen faltando
  las caídas reales, procesos separados y observación operativa descritos arriba.
- [ ] **CRYPTO-VALID-001 — Ceremonia de rotación.** Ejecutar en una copia el
  dry-run, recifrado, interrupción/reanudación, concurrencia, drenaje de jobs y
  tokens, rollback en ambos sentidos y retirada de la clave anterior según
  `docs/app-secret-rotation-runbook.md`.
- [ ] **AUTH-001 — Matriz E2E de identidad.** Verificar en procesos distintos
  registro, scanner de enlaces, verificación, login, MFA/TOTP, recovery de un
  uso, frescura administrativa, reset, cambio de email y revocación simultánea.
  Playwright ya acredita registro/verificación/login, bloqueo de no verificados,
  reset, cambio de email, TOTP, recovery de un uso y logout en un navegador; aún
  faltan scanner, frescura administrativa y revocación simultánea multiproceso.
- [ ] **CACHE-001 — Fault injection distribuido.** Interrumpir el store
  compartido entre lecturas/escrituras de challenges MFA e intenciones y demostrar
  rollback, `503` genérico, ausencia de consumo parcial y convergencia por TTL.
- [ ] **EDGE-001 — Dominio real de extremo a extremo.** Validar TXT/CNAME/CAA,
  DNSSEC cuando aplique, SNI, ACME, retirada, transferencia, apex/IDN y la
  topología final de certificados.

### 3. Producción, operación y cumplimiento

- [ ] **OPS-001 — Evidencia operativa.** Configurar correlación, métricas y
  alertas sin PII para `5xx`, cola, correo, DNS/TLS, webhooks, locks, hCaptcha y
  auditoría; probar runbooks, backup/restauración y degradación.
- [ ] **RELEASE-001 — Gate reproducible.** Aplicar migraciones en una copia,
  ejecutar pruebas autorizadas sobre `uvh_test`, generar SBOM y artefactos
  firmados, validar secretos/proxies/TLS/cookies y documentar rollback.
- [ ] **LEGAL-001 — Aprobación española/europea.** Sustituir datos provisionales
  y aprobar bases jurídicas, encargados, transferencias, retenciones, derechos,
  brechas y versiones aceptadas con asesoría competente.

## 3 — Producción y despliegue — gate real

- [ ] Desplegar las migraciones `000016` a `000031` sobre una copia
  representativa, medir bloqueo y preparar rollback compatible.
- [ ] Ejecutar el release con imágenes identificadas por digest, SBOM, análisis
  de dependencias y firma/verificación de artefactos; las bases actuales aún se
  fijan por etiqueta y los paquetes del sistema no están pinneados por versión.
- [ ] Cargar `APP_KEY`, `APP_SECRET`, PostgreSQL, hCaptcha, Resend y edge desde
  un gestor de secretos. Evitar valores sensibles permanentes en `env_file` y
  desplegar la rotación documentada sin invalidar MFA, webhooks o datos
  cifrados. El runbook existe; el gestor y el ensayo real siguen pendientes.
- [ ] Verificar en infraestructura real `TRUSTED_PROXIES`, subnet de Compose,
  sobrescritura de `Forwarded`/`X-Forwarded-*`, TLS, HSTS, cookies `__Host-` y
  aislamiento de Nginx/PostgreSQL.
- [ ] Configurar PostgreSQL con `sslmode=verify-full`, CA real, usuario de mínimo
  privilegio, backups cifrados y una restauración medida con RPO/RTO aprobados.
- [ ] Supervisar `app`, `queue`, `scheduler`, Caddy y Nginx. Los workers y el
  scheduler necesitan health checks externos, alertas de caída y antigüedad de
  cola; el reinicio automático por sí solo no acredita salud funcional.
- [ ] Ejecutar E2E con correo y hCaptcha reales: alta, verificación, login, MFA,
  recuperación, intención de URL, logout y caducidad/revocación de sesión.
- [ ] Revisar manualmente todos los módulos en móvil/escritorio, claro/oscuro,
  teclado, foco, contraste, lector de pantalla y movimiento reducido.
- [ ] Aprobar y publicar datos legales reales. Los textos actuales no deben
  lanzarse con titular, NIF, domicilio, registro, proveedores o regiones
  pendientes de confirmar.

## 1 — Implementación — Recuperación de contraseña y seguridad de cuenta

### Implementado en código; validación externa pendiente

- [x] Solicitud genérica y anti-enumeración, hCaptcha oficial verificado en
  servidor, cooldown, token aleatorio almacenado sólo como SHA-256 y TTL de una
  hora.
- [x] Mantener válido el último enlace ya entregado hasta que el reemplazo haya
  sido admitido por la cola; borrar sólo el token nuevo si falla la admisión.
- [x] Consumir el bearer una sola vez bajo lock, invalidar los demás resets,
  incrementar `security_version` y revocar todas las sesiones activas.
- [x] Rechazar el reset de cuentas bloqueadas y aplicar la misma política de
  fortaleza y máximo bcrypt de 72 bytes.
- [x] Separar el rate limit de solicitud por cuenta y el de consumo por hash del
  token; se evita el antiguo bucket global derivado de un email vacío.

### Pendiente antes de considerarlo completo

- [ ] Probar con el proveedor real entrega, enlace caducado, token usado dos
  veces, solicitudes concurrentes, caída de cola y reintento desde otro proceso.
- [x] Enviar aviso de contraseña cambiada sin incluir secretos, indicando
  recuperación de cuenta y contacto de soporte si no se reconoce la operación.
- [x] Añadir un enlace de incidente de un solo uso y 24 horas que revoca
  sesiones, tokens API, exports y cambios pendientes sin iniciar sesión, cambiar
  identidad ni desactivar MFA. Un bloqueo administrativo nunca puede revertirse.
- [ ] Registrar y alertar patrones anómalos de recuperación sin almacenar email,
  IP, token ni URL bearer en claro.
- [ ] Definir recuperación cuando se pierde también MFA: nunca desactivar MFA
  sólo por acceso al correo; exigir recovery code o procedimiento de soporte con
  verificación reforzada, segregación de funciones y trazabilidad.
- [ ] Revisar accesibilidad y mensajes de todos los estados `400/401/403/409`,
  `422`, `429`, `503`, caducidad, proveedor no disponible y red interrumpida.

## 1 — Implementación — Ajustes de perfil y ciclo de vida de cuenta

### Perfil y cambio de email

- [x] Edición del nombre con validación, CSRF, sesión HttpOnly y auditoría.
- [x] Cambio de contraseña con contraseña actual, política fuerte, revocación de
  otras sesiones e invalidación de resets pendientes.
- [x] Exigir TOTP o recovery code además de contraseña para cambiar credenciales
  cuando MFA esté activo; consumir el factor concreto, notificar el cambio y
  cerrar el resto de sesiones.
- [x] Implementar cambio de email de una cuenta verificada como operación
  pendiente: contraseña + step-up MFA, verificar el nuevo buzón, mantener el
  anterior hasta confirmar, comprobar unicidad bajo transacción y permitir
  cancelar.
- [x] Notificar tanto al email anterior como al nuevo, invalidar tokens antiguos,
  decidir revocación de sesiones/API tokens y auditar inicio, confirmación,
  cancelación y fallo de entrega sin exponer direcciones en logs.
- [x] Diferenciar el flujo anterior del cambio de email de un registro aún no
  verificado, que ya existe y no crea sesión.

La implementación añade una reserva temporal de email serializada con advisory
lock de PostgreSQL para cerrar la carrera entre alta, corrección de registro y
confirmación del nuevo buzón. Falta validación E2E/concurrente antes de producción.

### Descarga y portabilidad de datos

- [x] Implementar solicitud autenticada con contraseña y step-up MFA, rate limit,
  auditoría y confirmación por email; no generar exports desde un simple GET.
- [x] Generar el archivo asíncronamente, cifrado en reposo, con enlace opaco de
  un solo uso y corta caducidad. El worker debe verificar de nuevo que la cuenta
  sigue activa y que la solicitud no fue revocada.
- [x] Incluir datos de cuenta, membresías, enlaces creados, dominios y webhooks
  de workspaces propios, reglas, tags, tokens sin secretos, auditoría mínima y
  analítica agregada atribuible.
- [x] Incluir los expedientes y mensajes RGPD de la propia cuenta sin hashes de
  generación, IDs del personal ni ciphertext; conservar el registro con una
  marca explícita si un cuerpo cifrado no puede recuperarse.
- [x] No incluir secretos, hashes, cookies, recovery codes, tokens bearer,
  payloads de otros miembros ni datos personales de terceros sin base jurídica.
- [x] Borrar el artefacto al caducar, impedir caché/CDN, registrar descarga,
  cancelar solicitudes y compensar el agotamiento de reintentos de correo.
- [ ] Separar contractualmente copia de acceso (art. 15 RGPD) y portabilidad
  estructurada (art. 20 RGPD), y definir el procedimiento manual para exports
  superiores al límite automático cifrado de 25 MiB.
- [ ] Probar archivos grandes, caída de worker/almacenamiento, reintentos,
  descarga concurrente, cuenta bloqueada y purga en infraestructura real.

### Eliminación de cuenta

- [x] Implementar confirmación explícita con contraseña, step-up MFA, cooldown y
  aviso por email. La operación debe ser idempotente y poder cancelarse durante
  un periodo de gracia definido, salvo solicitud de borrado inmediato aplicable.
- [x] Bloquear la eliminación si la persona es propietaria de workspaces;
  ofrecer transferencia explícita o eliminación separada del workspace con
  impacto, recuentos y segunda confirmación.
- [x] Revocar en la misma transición sesiones, API tokens creados por la cuenta,
  resets, verificaciones, cambios de email, exports e invitaciones pendientes.
  Al bloquear cualquier workspace propio no quedan dominios/webhooks del usuario
  que puedan continuar su ciclo de edge.
- [x] Añadir un índice inverso sin destino ni bearer a las intenciones de enlace
  reclamadas. La eliminación de cuenta las revoca de caché y libera sus cuotas;
  el índice impone además un máximo atómico de 100 intenciones por usuario.
- [x] Mantener el token opaco en estado `completing` hasta que el backend confirme
  su invalidación; un fallo de red ya no pierde el reintento ni reabre el diálogo.
- [x] Compensar por separado los contadores de intención por IP y global cuando
  falle una escritura intermedia; un fallo parcial no puede reducir cuota ajena.
- [ ] Simular indisponibilidad y contención del store compartido durante emisión,
  claim y complete; comprobar compensación de cuotas, reintento tras recarga y
  caducidad final sin conservar el destino más de 24 horas. Cubierto ya el
  rechazo de borrado al completar, la contención al liberar contadores y el
  reintento del índice inverso; faltan caída multiproceso, emisión/claim y TTL real.
- [x] Diseñar la purga/anonimización por fases para cuenta y membresías, con
  revocación inmediata, siete días de gracia y anonimización desde housekeeping.
- [ ] Completar con asesoría jurídica la política para auditoría, analítica,
  denuncias y logs. Conservar sólo lo exigido por obligación, defensa de
  reclamaciones o seguridad, con acceso restringido y plazo documentado.
- [ ] Documentar tratamiento en backups: supresión lógica inmediata, exclusión
  tras restauración y desaparición definitiva al vencer la retención.
- [ ] Probar carreras con invitaciones, webhooks, export pendiente, cambio de
  email, restauración de backup y propiedad de workspace.

Si el email que contiene el enlace de cancelación agota todos sus reintentos, el
job restaura automáticamente la cuenta; nunca se mantiene una eliminación
programada sin haber podido entregar el canal de recuperación. Este mecanismo y
la ejecución por scheduler siguen pendientes de pruebas autorizadas.

## 3 — Producción y cumplimiento — RGPD, LOPDGDD y LSSI-CE

Estas tareas requieren validación de asesoría jurídica/DPO. El código y este
backlog no certifican cumplimiento legal.

- [ ] Identificar responsable real: razón social/nombre, NIF, domicilio, datos
  registrales, contacto, representante y DPO cuando proceda; sustituir todos los
  textos provisionales y comprobar los buzones publicados.
- [ ] Elaborar registro de actividades, inventario de datos, finalidades, bases
  jurídicas, categorías, destinatarios, encargados, transferencias y retenciones.
- [ ] Firmar DPA con hosting, base de datos, backups, correo, hCaptcha, soporte y
  observabilidad; documentar región, subencargados, SCC/decisión de adecuación y
  evaluación de transferencias cuando corresponda.
- [ ] Definir la base de hCaptcha y almacenamiento estrictamente necesario;
  revisar banner/capa de cookies conforme a LSSI-CE si se añade cualquier
  tecnología no esencial. No instalar analítica o marketing antes del consentimiento.
- [x] Implementar en código un workflow de derechos de los artículos 12–22
  RGPD: acceso, rectificación, supresión, oposición, limitación y portabilidad,
  con identidad proporcional, acuse, plazo de un mes, prórroga motivada,
  conversación cifrada y registro de respuesta.
- [ ] Validar con DPO/asesoría el procedimiento operativo del workflow: reparto
  de expedientes, prueba de identidad en casos dudosos, excepciones, búsqueda en
  backups/terceros, contenido de las respuestas y evidencia de cumplimiento de
  plazo. La interfaz y el backend no sustituyen este procedimiento.
- [ ] Aprobar tabla de conservación para cuentas, sesiones, auditoría, analítica,
  denuncias, correo, colas, exports, logs y backups; el housekeeping técnico debe
  reflejarla y nunca aceptar valores peligrosos en producción.
- [ ] Revisar privacidad desde el diseño: minimización, pseudonimización,
  permisos, acceso del personal, trazabilidad, gestión de claves y borrado.
- [ ] Definir edad mínima y tratamiento de menores conforme a RGPD/LOPDGDD;
  incorporar controles y lenguaje adecuados si el servicio puede dirigirse a ellos.
- [ ] Preparar respuesta a brechas: clasificación, contención, evidencias,
  comunicación a AEPD en hasta 72 horas cuando proceda y aviso a afectados si el
  riesgo es alto.
- [ ] Evaluar DPIA cuando el tratamiento o la escala lo requieran, interés
  legítimo para antiabuso/seguridad y necesidad/proporcionalidad de retenciones.
- [ ] Completar aviso legal y condiciones LSSI-CE: identidad, contacto, reglas de
  contratación si hubiera pago, precios/impuestos antes de activar checkout,
  propiedad intelectual, abuso y comunicaciones comerciales.
- [x] Registrar por separado la versión exacta de los Términos aceptados y del
  aviso de privacidad mostrado durante el alta; no presentar la política como
  consentimiento global para todas las finalidades.
- [x] Hacer durable esa evidencia en `legal_acceptances` dentro de la misma
  transacción que crea cuenta/workspace, sin IP ni user-agent, e incluirla en la
  exportación personal. La migración `000031` sigue pendiente de despliegue.
- [ ] Definir cómo informar y registrar el aviso de privacidad para cuentas
  anteriores a `000031`. La migración recupera únicamente Términos respaldados
  por auditoría y no atribuye retroactivamente un aviso que no puede probarse.
- [ ] Definir el flujo para cambios materiales: aviso, conservación de versiones
  históricas y nueva aceptación o acuse cuando proceda jurídicamente.

## 1 — Implementación — MFA, operaciones sensibles y eventos

- [x] Login en dos pasos con challenge opaco de cinco minutos ligado a
  `security_version`, lock distribuido y TOTP no reutilizable por contador.
- [x] Recovery codes con alfabeto normalizado, hash SHA-256, uso único, recuento,
  aviso al quedar pocos y regeneración con contraseña + segundo factor.
- [x] Configuración en tres pasos con secreto pendiente, TTL, cancelación y
  sustitución del autenticador sólo tras verificar el nuevo TOTP.
- [x] Desactivación y reconfiguración requieren contraseña y TOTP/recovery;
  administradores de plataforma no pueden quedarse sin MFA.
- [x] Aplicar el verificador compartido de contraseña + TOTP/recovery a emisión
  de API tokens, borrado de workspace, transferencia de propiedad, exportación
  y eliminación de cuenta. El borrado exige además escribir el nombre exacto.
- [ ] Diseñar, si la UX lo requiere, un grant de step-up de muy corta duración
  ligado a sesión, acción y workspace; nunca reutilizar sólo el indicador MFA
  histórico de la cookie para operaciones distintas.
- [x] Exigir una antigüedad máxima configurable de MFA para administración de
  plataforma. Tras 15 minutos por defecto, backend y guard fuerzan una pantalla
  de reautenticación con contraseña + TOTP/recovery sin cerrar la sesión general.
- [ ] Validar manualmente y mediante E2E la expiración mientras administración
  está abierta, varias pestañas, red interrumpida, TOTP reutilizado, recovery de
  un solo uso y restauración exacta del `returnTo` tras reautenticar.
- [x] Fallar cerrado con `503` y rollback cuando el store compartido no puede
  reservar un contador TOTP o consumir un challenge, sin presentarlo como código
  incorrecto ni dejar una mutación parcialmente aplicada.
- [x] Consumir challenge y recovery code en una sola transición transaccional:
  una caída intermedia ya no puede gastar el código sin crear la sesión MFA.
- [x] Implementar rotación solapada de `APP_SECRET`: clave actual de escritura,
  keyring anterior de sólo lectura, deadline de 31 días, recifrado reanudable de
  TOTP, webhooks, outbox, privacidad y exports, compatibilidad con tokens breves
  ya firmados y overlay de secretos para todos los procesos PHP.
- [ ] Ensayar el runbook `docs/app-secret-rotation-runbook.md` sobre una copia:
  dry-run, interrupción/reanudación, writers concurrentes, drenaje de jobs y
  tokens, rollback en ambos sentidos y custodia/revocación de claves anteriores.
- [x] Añadir notificaciones de alta, sustitución, desactivación y regeneración
  MFA, sin incluir secretos ni códigos y con fallo de admisión auditado.

## 1 — Implementación — Dominios personalizados, DNS y TLS

### Implementado en código; despliegue y E2E pendientes

- [x] TXT dedicado `_uvh-verification.<dominio>`, comparación exacta, CNAME
  obligatorio hacia `CUSTOM_DOMAIN_CNAME_TARGET` y token oculto a viewers.
- [x] Estados separados para propiedad/ruta, `edge_eligible`, provisioning TLS y
  `tls_ready_at`; `active` sólo se alcanza tras comprobar HTTPS con CA válida.
- [x] Caddy con On-Demand TLS protegido por endpoint `ask` interno, secreto
  independiente, lookup indexado y preservación de `Host` hasta Laravel.
- [x] Versionado de DNS/TLS, locks con propietario, recuperación de jobs
  atascados, revalidación periódica, contador de fallos y gracia acotada.
- [x] Hostnames desconocidos no reciben landing ni datos; los orígenes `www`
  redirigen al host canónico y los dominios deshabilitados no resuelven enlaces.
- [x] Borrar un dominio se bloquea mientras existan enlaces, incluso en papelera.

### Producción y operación pendientes

- [ ] Publicar `edge.uvh.es` con A/AAAA estables, abrir 80/443 TCP y 443 UDP,
  configurar CAA y validar emisión/renovación ACME contra dominios reales.
- [ ] Probar TXT fragmentado/múltiple, `NXDOMAIN`, `NODATA`, `SERVFAIL`, timeout,
  propagación parcial, bucles CNAME, CAA denegado, apex, IDN y cambio de control.
- [ ] Definir soporte de apex, IDNA2008/punycode y wildcard; no prometerlos antes.
- [ ] Añadir alertas por certificado, fallos DNS/TLS, revalidación vencida,
  dominios en gracia y cola. En multi-edge, compartir almacenamiento de
  certificados o usar un diseño distribuido explícito.
- [ ] Definir retirada urgente y ciclo de certificados ya cacheados por Caddy;
  desactivar en aplicación impide redirecciones, pero no borra por sí solo el
  certificado almacenado hasta su expiración/limpieza operativa.
- [ ] E2E: alta → TXT → CNAME → TLS → activación → redirect → revalidación →
  desactivación → transferencia a otro workspace sin replay ni takeover.

## 1 — Implementación — Errores, correo y colas

- [x] Registro, corrección/reenvío de verificación, reset, cambio de email e
  invitación/reenvío confirman recurso y outbox en una sola transacción. Los
  fallos de admisión no invalidan bearers ya entregados ni confirman éxito.
- [x] Cambio/reset de contraseña y finalización de recuperación reforzada
  confirman credenciales, revocaciones y aviso de incidente en un solo commit.
  Un fallo de admisión revierte la operación; la limpieza conserva explícitamente
  el bearer nuevo. BAF-124/125; pruebas automatizadas pasadas, fault injection pendiente.
- [x] Alta/sustitución/desactivación de MFA, regeneración de recovery codes y
  avisos de ambos buzones en cambio de email se admiten con sus mutaciones.
  El fallo del segundo aviso revierte ambos; no se devuelven códigos nuevos si
  la operación se revierte. BAF-126; pruebas automatizadas pasadas.
- [x] Admitir avisos de token API y transferencia/borrado de workspace con sus
  mutaciones; preservar el recovery code si un webhook impide borrar. BAF-127/128.
- [x] Intentar el aviso de cancelación de cuenta dentro de un savepoint: su fallo
  no puede mantener la eliminación programada. BAF-129; excepción documentada,
  sin prometer correo recuperable cuando no se pudo admitir. Casos automatizados pasados.
- [x] Los errores de webhook persistidos son genéricos y no incluyen IP, TLS,
  cURL, secretos ni URLs internas; los creadores bloqueados dejan de emitir.
- [x] Reclamar durante diez minutos la publicación de cada entrega webhook
  pendiente. Housekeeping no multiplica jobs si el worker está parado; un lease
  vencido o un fallo inmediato conserva el reintento durable. BAF-142.
- [x] El arranque de producción rechaza queue `sync/deferred/background/failover`,
  cache no compartida, `failed_jobs` desactivado, rate limits/retenciones fuera
  de rango, DB sin `verify-full` y secretos de ejemplo.
- [x] Vincular cada correo de invitación a ID y hash de generación: si agota los
  reintentos, sólo esa generación pendiente pasa a `cancelled`; un fallo antiguo
  no puede cancelar un reenvío posterior.
- [x] Migrar el bearer de invitación a fragmento y handoff del mismo navegador,
  sin perderlo al pasar por registro/login y manteniendo compatibilidad temporal
  con enlaces query ya enviados. La aceptación/rechazo requiere clic explícito.
- [x] Evitar que los scanners de correo consuman verificaciones, cambios de
  email, exports, descargas, eliminaciones o invitaciones: las pantallas limpian
  el fragmento y esperan una acción humana explícita.
- [x] `MAIL-001` y la superficie operativa base de `MAIL-002`: outbox
  transaccional, estado consultable, idempotency key, antigüedad, métricas,
  reintento acotado y compensación sin exponer destinatarios.
- [x] Validar transportes efectivos, alias y `MAIL_URL`; impedir respaldos
  `log/array` en entrega real y exigir aceptación explícita del mailer sin
  perder la parte de texto. BAF-122/123; contratos automatizados pasados.
- [x] Documentar estados, cadencias, recuperación, presupuestos de reintento,
  compensación, conservación y evidencia pendiente en el runbook del outbox.
- [ ] Conectar las señales de correo a alertas externas, aprobar la conservación
  y validar transacciones, reintentos, obsolescencia, purga y compensaciones con
  fallos reales antes de cerrar `MAIL-002`.
- [x] Añadir paginación contractual, total y orden estable para miembros e
  invitaciones; sesiones y API tokens continúan acotados a 100 por respuesta.
- [x] Purgar tokens API sólo después de una ventana configurable desde su
  revocación o caducidad; producción admite entre 7 y 365 días.
- [ ] Incorporar métricas y alertas sin PII para hCaptcha, correo, DNS, TLS,
  webhooks, rate limits, locks, errores `5xx`, backups y auditoría no durable.
  La instrumentación de aplicación ya cubre hCaptcha, correo, DNS/TLS,
  webhooks, locks, `5xx`, lentitud, auditoría, housekeeping y presión HTTP 429,
  además de conteos y antigüedad de colas. La consola muestra las señales de la
  última hora y degrada su resumen ante fallos de disponibilidad o durabilidad.
  Faltan reglas/receptores externos, monitorización del sistema de backups y
  validar que cada alarma llegue al canal operativo previsto.

## 4 — Roadmap opcional — Superficies de producto

El inventario del 4 de septiembre de 2026 cubre creación y gestión de enlaces,
analítica, dominios, equipo, tokens, webhooks, cuenta, RGPD y administración.
Los siguientes puntos son huecos operativos reales, no una promesa comercial ni
un motivo para retrasar los gates de seguridad anteriores.

Prioridad actualizada por petición expresa el 5 de septiembre: comenzar este
roadmap tras cerrar el bloque de espera de invitaciones BAF-138, aunque los gates
de validación/producción sigan abiertos. No equivale a aprobar despliegue ni a
levantar restricciones de pruebas, migraciones o las condiciones de PRODUCT-022–024.

- [x] **PRODUCT-001 — Primeros pasos por workspace (`/app/getting-started`).**
  Mostrar un checklist derivado exclusivamente del estado real: crear el primer
  enlace, probar su redirección, añadir un dominio si se desea, invitar al equipo
  y configurar MFA. Debe poder omitirse, reanudarse y desaparecer al completarse;
  no almacenar progreso duplicado que pueda divergir del backend.
  - Implementado y revisado estáticamente el 5 de septiembre: GET autenticado y verificado
    `/api/v1/workspaces/:id/getting-started`, hechos/capacidades tipados, consulta
    correlacionada con autorización y sin escrituras de progreso. Pantalla, menú,
    tarjeta Dashboard, omitir/reanudar por usuario/workspace y ocultación al observar
    las tres señales iniciales. Dominio/equipo opcionales. Cinco casos backend y
    trece frontend pasaron el 5 de septiembre. `PRODUCT-VALID-001` permanece abierto;
    detalles y límites en `docs/getting-started-roadmap.md`.
- [x] **PRODUCT-002 — Actividad del workspace (`/app/activity`).** Añadir un
  registro paginado para propietarios y administradores con actor, acción,
  recurso, fecha y resultado; aplicar aislamiento estricto por workspace,
  etiquetas comprensibles y detalle minimizado. Nunca mostrar IP, tokens,
  destinos sensibles, ciphertext ni metadatos internos de otro tenant. Base
  actual: cada detalle de enlace muestra sus últimos 50 eventos, sin paginación
  ni vista transversal del workspace.
  - Base iniciada: migración 000033 para atribución durable, argumento opcional
    de auditoría e integración en controladores/jobs principales. Aplicada sólo
    en `uvh_test`, no en `uvh_local`;
    seis casos pasaron en `uvh_test`. API owner/admin con cursor cifrado ligado
    a contexto, catálogo cerrado, DTO mínimo y límites operativos implementada;
    veinte casos API pasaron. Pantalla y navegación owner/admin
    implementadas: DTO separado/minimizado, estados de error y cobertura, páginas
    manuales de 25 hasta 500, invalidación por contexto y respuesta tardía, sin
    persistir cursores ni reintentar solos. Los 29 casos frontend, typecheck y
    build pasaron. `PRODUCT-VALID-002` sigue abierto; esto no acredita producción.
    Plan, garantías y despliegue en `docs/workspace-activity-roadmap.md`.
- [x] **PRODUCT-003 — Uso y límites (`/app/usage`).** Exponer consumo frente a
  cuotas reales de enlaces, dominios, miembros, tokens, webhooks y retención de
  analítica. Indicar qué operación alcanzó un límite y cómo liberar capacidad,
  sin presentar precios, upgrades o capacidades que todavía no existen.
  - Backend: constantes de
    política compartidas, GET agregado y minimizado por rol, throttle por cuenta,
    índices 000034 y fallo cerrado ante cuota/esquema ausentes. Sus doce casos
    pasaron en `uvh_test`; 000034 no se aplicó a `uvh_local`.
  - UI finalizada el 6 de septiembre: ruta y navegación para todos los roles,
    contrato runtime ligado a workspace/rol, seis tarjetas con redacción por
    permisos, estados alcanzado/no configurado/no disponible, acciones para
    liberar capacidad, política de retención y manejo de `Retry-After`. Diez
    regresiones elevan la suite frontend a 245/245; typecheck, build y los doce
    casos backend/116 aserciones pasaron, estos últimos sólo en `uvh_test`.
    Diseño y garantías en `docs/workspace-usage-roadmap.md`.
- [ ] **PRODUCT-VALID-003 — Validación E2E/operativa de Uso y límites.** Recorrer
  la pantalla autenticada con owner/admin/editor/viewer sobre una copia aislada,
  verificar teclado, lector, móvil y contraste, y medir el endpoint con volumen
  representativo. No aplicar 000034 a `uvh_local` para cerrar este gate.
- [ ] **PRODUCT-004 — Centro de notificaciones (`/app/notifications`).** Crear
  una bandeja durable, paginada y deduplicada para dominios/DNS/TLS, webhooks
  agotados, enlaces próximos a expirar o agotar clics, tokens próximos a caducar,
  invitaciones y eventos de seguridad. Soportar leído/no leído y enlace interno
  seguro; no guardar secretos, URLs bearer ni contenido de correo.
- [ ] **PRODUCT-005 — Preferencias de avisos (`/app/settings/notifications`).**
  Separar mensajes de seguridad obligatorios de avisos operativos configurables,
  registrar cambios y ofrecer frecuencia inmediata o resumen cuando proceda.
  Un usuario no puede desactivar avisos críticos de credenciales, MFA, email,
  exportación o eliminación de cuenta.
- [x] **PRODUCT-006 — Diagnóstico de dominio (`/app/domains/:id`).** Asistente
  implementado con pasos TXT/CNAME/TLS/activación, estado observado, errores,
  comprobación en curso y calendario calculado por una política compartida con
  housekeeping. Viewers no reciben host ni token de propiedad. Cuatro casos
  backend/21 aserciones y los contratos frontend pasaron.
- [ ] **PRODUCT-VALID-006 — Validación operativa de dominios.** Completar un
  ciclo DNS/TLS real en proveedor aislado, ensayar propagación lenta y pérdida de
  job, y revisar teclado, lector, contraste y móvil.
- [x] **PRODUCT-007 — Inspector de webhook (`/app/webhooks/:id`).** Historial
  paginado y estable, error normalizado, prueba 202 y reenvío idempotente por rol.
  La preview se reconstruye con allowlist; nunca devuelve payload almacenado,
  firma, secreto, URL resuelta, IP ni cuerpo remoto. Cuatro casos backend/31
  aserciones y los contratos runtime frontend pasaron.
- [ ] **PRODUCT-VALID-007 — Validación operativa de webhooks.** Ensayar receptor
  real aislado, timeouts, DNS cambiante, cola caída y carreras entre entrega,
  configuración y reenvío; revisar teclado, lector y móvil.
- [x] **PRODUCT-008 — Centro de seguridad (`/app/security`).** Resumen de postura,
  sesiones, accesos a contraseña/MFA/recovery/email y actividad personal de
  catálogo cerrado. El endpoint no entrega metadata, IP ni actividad ajena; las
  mutaciones conservan reautenticación backend. Tres casos backend/17 aserciones
  y cobertura del decoder pasaron.
- [ ] **PRODUCT-VALID-008 — Validación E2E del centro de seguridad.** Recorrer
  reautenticación, MFA, recovery, email y revocación de sesión actual/remota en
  navegador real; revisar foco, lector, móvil y expiración.
- [x] **PRODUCT-009 — Papelera de enlaces (`/app/links/trash`).** Listado,
  búsqueda y paginación; fecha de purga del servidor; restore editor+ y borrado
  owner/admin con frase exacta, contraseña y MFA. Usa locks ordenados, cascada
  FK y purga housekeeping a 30 días configurables. Cuatro casos backend/23
  aserciones, decoder y regresión de retención pasaron.
- [ ] **PRODUCT-VALID-009 — Validación E2E/concurrente de papelera.** Revisar
  diálogo/foco/lector/móvil y carreras multiproceso entre clic, restore, purge y
  housekeeping sobre datos desechables; confirmar la retención aprobada. El ciclo
  Playwright ya cubre eliminar y restaurar un enlace; no cubre purge ni carreras.
- [ ] **PRODUCT-010 — Páginas públicas de resolución.** Rediseñar y unificar la
  introducción de contraseña y los estados desconocido, pausado, caducado,
  bloqueado y límite agotado. Deben ser accesibles, `no-store`, resistentes a
  enumeración, sin destino ni datos del propietario, y ofrecer denuncia sólo
  cuando exista una referencia pública válida.
- [x] **PRODUCT-011 — Ayuda técnica (`/help`) y estado público (`/status`).**
  Publicar guías versionadas de enlaces, dominios, API y firma de webhooks, más
  una página de estado alimentada por monitorización externa. El propio proceso
  afectado no puede declararse sano a sí mismo ni exponer topología o versiones.
  El `/api/v1/status` existente sólo informa configuración antiabuso/análisis;
  no se reutiliza como salud. Implementados ayuda versionada, rutas/footer/sitemap
  y `/api/v1/public-status`: acepta sólo feed HTTPS externo acotado, recalcula el
  agregado, no sigue redirects y rechaza destinos locales, cuerpos grandes,
  fechas futuras/caducadas y campos inválidos sin exponer URL, bearer, topología
  o versión. Cinco casos backend/28 aserciones y tres de decoder pasaron.
- [ ] **PRODUCT-VALID-011 — Activación del monitor público externo.** Provisionar
  el monitor fuera de UVH, guardar su bearer en secretos, configurar el feed y
  ensayar caída de UVH y del monitor. Hasta entonces `/status` muestra de forma
  segura “desconocido”. Runbook: `docs/public-status-feed.md`.

## 4 — Roadmap opcional — Productividad y escalado

- [ ] **PRODUCT-012 — Acciones masivas seguras.** Selección persistente por IDs
  opacos y operaciones de pausar, archivar, etiquetar o mover a papelera con
  previsualización del alcance, confirmación, resultado parcial explícito,
  idempotencia y auditoría por lote.
- [ ] **PRODUCT-013 — Importación/exportación de enlaces.** Importar CSV mediante
  carga privada asíncrona, dry-run, mapeo de columnas, validación por fila,
  límites de tamaño y rollback definido. Exportar sólo el workspace autorizado,
  generar el archivo fuera de la petición y purgarlo con TTL; proteger contra
  fórmulas CSV, URLs peligrosas, ZIP bombs y agotamiento de memoria.
- [ ] **PRODUCT-014 — Colecciones y gestor de etiquetas.** Añadir carpetas o
  colecciones de un solo nivel inicialmente, junto a una vista para renombrar,
  fusionar y eliminar etiquetas sin perder enlaces. Todas las claves y
  restricciones de unicidad deben incluir `workspace_id`.
- [ ] **PRODUCT-015 — Plantillas de enlace.** Guardar presets versionados de UTM,
  dominio, expiración y reglas para reducir errores repetitivos. Mostrar siempre
  una previsualización del destino final y no copiar contraseñas ni bearers en
  una plantilla.
- [ ] **PRODUCT-016 — Exportación de analítica.** Generar CSV/JSON acotado por
  periodo, enlace, dominio o etiqueta, con trabajo asíncrono, expiración corta y
  el mismo aislamiento que la vista. No exportar identificadores de visitante ni
  dimensiones con cardinalidad que faciliten reidentificación.
- [ ] **PRODUCT-017 — Salud de destinos, sólo opt-in.** Comprobar disponibilidad
  sin seguir redirecciones libremente, reutilizando la política SSRF con DNS
  pinning, egress controlado, límites por workspace, timeouts estrictos y cuerpos
  descartados. Informar disponibilidad técnica, no afirmar que una URL es segura.
- [ ] **PRODUCT-018 — Portal para desarrolladores (`/developers`).** Publicar un
  contrato OpenAPI generado y versionado, ejemplos mínimos, scopes, paginación,
  rate limits, errores y verificación de firmas. La consola interactiva debe
  ejecutarse sólo con tokens efímeros del usuario y nunca persistirlos en el
  navegador o telemetría.
- [ ] **PRODUCT-019 — Credenciales de servicio del workspace.** Separar cuentas
  humanas de automatizaciones con propietario, scopes mínimos, expiración,
  rotación solapada, último uso aproximado y revocación. No reutilizar tokens de
  una persona que abandona el workspace.
- [ ] **PRODUCT-020 — Passkeys/WebAuthn.** Evaluar passkeys como acceso y step-up
  resistentes al phishing, con múltiples credenciales, nombres de dispositivo,
  revocación, attestation prudente y recuperación que no degrade MFA. Mantener
  TOTP/recovery hasta validar compatibilidad y ceremonia E2E real.
- [ ] **PRODUCT-021 — Políticas del workspace.** Para organizaciones que lo
  necesiten, permitir exigir MFA, acotar sesiones y restringir quién puede crear
  dominios, tokens o webhooks. Diseñar primero la transición para miembros que no
  cumplen la política y un escape seguro para el último owner.

## 4 — Roadmap opcional — Ideas condicionadas

- [ ] **PRODUCT-022 — Informes programados.** Sólo después de cerrar el outbox y
  las preferencias: destinatarios autorizados, frecuencia acotada, enlace de
  descarga de un uso y cancelación al perder acceso al workspace.
- [ ] **PRODUCT-023 — SSO OIDC/SAML y aprovisionamiento SCIM.** Abrir diseño sólo
  si existen organizaciones que lo requieran; contemplar takeover de dominio,
  enlace de identidades, break-glass, offboarding y auditoría antes de programar.
- [ ] **PRODUCT-024 — Experimentos y conversiones.** No implementar A/B testing,
  píxeles ni atribución hasta definir modelo estadístico, consentimiento LSSI,
  minimización, retención, opt-out y DPIA cuando proceda. Nunca presentarlo como
  una simple extensión de los clics actuales.
- [ ] **PRODUCT-025 — QR avanzado.** Evaluar plantillas accesibles, SVG/PNG,
  corrección de error y previsualización de impresión. Validar contraste y
  escaneabilidad; no permitir logos o estilos que produzcan códigos inservibles.

### Referencias de producto consultadas

Estas referencias sirven únicamente para identificar patrones de producto; no
validan la seguridad, el modelo legal ni el alcance de UVH:

- [Modelo workspace/enlaces/dominios/etiquetas de Dub](https://dub.co/docs/data-model).
- [Contrato de creación de enlaces de Dub](https://dub.co/docs/api-reference/links/create).
- [Modelo de eventos e identificador de webhook de Dub](https://dub.co/docs/webhooks/event-types).
- [Resumen oficial de funciones recientes de Bitly](https://support.bitly.com/hc/en-us/articles/34262355353997-What-s-new-at-Bitly).

## 2 — Validación — Calidad frontend y documentación

- [x] Reorganizar Ajustes en Cuenta, Acceso, Datos y privacidad y Zona crítica;
  añadir navegación local, resumen de identidad, proceso RGPD, expedientes
  legibles y composición responsive sin cambiar los contratos existentes.
- [ ] Completar la revisión visual autenticada de Ajustes/RGPD con datos reales,
  expedientes largos, estados vencidos, error, paginación, tema claro/oscuro y
  anchos móvil/escritorio. El guard impidió revisarla sin una sesión de prueba.
- [ ] Revisar visualmente landing, acceso, MFA, recuperación y cada módulo del
  panel contra el backend real; no declarar el frontend completo sólo por build.
- [ ] Verificar todos los estados `loading/empty/error/forbidden/conflict/offline`,
  foco después de diálogo, anuncios ARIA y recuperación de sesión caducada.
- [ ] Revisar con tecnologías de asistencia la pantalla de reautenticación
  administrativa y confirmar que un `403 mfa_reauthentication_required` nunca
  deja datos administrativos visibles ni crea un bucle de navegación.
- [x] Actualizar documentación de API para challenges MFA, recovery codes,
  dominios, errores `409/429/503`, truncado de listados y semántica webhook al
  menos una vez con deduplicación por `event_id`.
- [x] Ejecutar typecheck, build, suite Angular y PHPUnit sobre `uvh_test`: la
  validación más reciente pasó el 6 de septiembre (253 frontend; 272 backend/2210
  aserciones). Pint, Larastan, ESLint, typecheck, build, Composer audit y npm audit
  también pasaron; ambos gestores informaron cero vulnerabilidades. La base
  `uvh_test` fue efímera y se eliminó; `uvh_local` no se migró.
- [x] Ejecutar migración limpia desde cero en base aislada: las 36 migraciones,
  release check y 12 casos/290 aserciones pasaron; la base temporal se eliminó.
- [x] Ejecutar la base E2E aislada: 15/15 recorridos Playwright pasaron sobre
  `uvh_e2e_test` y la infraestructura efímera se eliminó al terminar.
- [ ] Ejecutar concurrencia multiproceso y ampliar E2E a los gates operativos que
  siguen abiertos. No usar nunca migraciones destructivas contra `uvh_local`.
