# UVH — checkpoint de continuidad

Fecha inicial: 4 de septiembre de 2026. Actualizado: 6 de septiembre de 2026.

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
- La pasada de estabilidad automatizada fue autorizada el 5 de septiembre; usar
  exclusivamente `uvh_test` y mantener E2E/migraciones reales como gates separados.
- No ejecutar preparación destructiva de pruebas contra `uvh_local`; cualquier
  validación futura debe usar una base aislada como `uvh_test`.
- Usar comentarios de código para invariantes, concurrencia y recuperación, no
  para describir literalmente cada instrucción.
- No aplicar las migraciones pendientes a `uvh_local` sin autorización expresa.

## Evidencia de estabilidad del 5 de septiembre

- Continuación de depuración: corregido falso éxito de `Stop-UvhLocal` cuando
  Compose falla. El error ahora aborta también `Restart` antes del arranque.
  `tools/tests/control-stop.tests.ps1` valida cuatro escenarios con dependencias
  simuladas, sin arrancar/detener servicios ni acceder a bases de datos.
- Lote de estabilidad de intenciones: el borrado del bearer se confirma antes de
  responder éxito; la limpieza auxiliar de contadores ya no convierte un consumo
  irreversible en `503`; una revocación fallida conserva su índice para reintento.
  La suite amplia asociada pasa en `uvh_test`: 28 casos y 348 aserciones. Pint
  pasa en los tres archivos de implementación/prueba dedicados.
- Lote de cola webhook: la publicación pendiente adquiere un lease interno en
  `locked_at`, evitando un job duplicado cada minuto si el worker se detiene. El
  lease vence para recuperar jobs perdidos y un fallo inmediato reintenta antes.
  Siete casos de lease, webhook y SSRF pasan con 73 aserciones en `uvh_test`.

- Frontend: typecheck y build correctos; suite Karma/ChromeHeadless completa,
  101/101 casos correctos. Se actualizaron cuatro contratos de prueba obsoletos
  sin relajar comportamiento de producción.
- Backend: lint PHP correcto y suite PHPUnit completa sobre `uvh_test`, 244/244
  casos y 2038 aserciones correctas. Se corrigieron contratos obsoletos de MFA de
  sesión, hCaptcha, DNS/TLS, HSTS y webhooks transaccionales; IPv6 mapped permanece
  bloqueado con política fail-closed y los errores de entrega siguen saneados.
- Esquema aislado: 36 migraciones aplicadas en `uvh_test`, incluida 000034;
  `uvh:release-check` correcto y sin aplicar migraciones. Una segunda base vacía
  `uvh_clean_20260905_1648_test` migró de cero, pasó release check y 12 casos con
  290 aserciones, y se eliminó después. `uvh_local` no se tocó.
- Dependencias bloqueadas: `composer audit --locked` y `npm audit --omit=dev`
  no informaron advisories conocidos. La auditoría npm completa detectó avisos
  transitivos de desarrollo; overrides compatibles a `fast-uri@3.1.7`,
  `less@4.9.1` y `qs@6.16.0` dejaron 0 críticos/altos y 5 moderados sin fix
  compatible en `webpack-dev-server → sockjs → uuid@8`. SockJS usa sólo v4 y el
  servidor se liga a loopback. Typecheck/build/101 casos pasaron tras el cambio.
- Docker Desktop volvió a arrancar tras archivar de forma recuperable los IPC
  dañados como `Docker\\run.stale-20260905-162048` y
  `docker-secrets-engine.stale-20260905-162048`; no se borraron imágenes,
  contenedores, volúmenes ni datos.
- Permanecen abiertos E2E reales, concurrencia multiproceso, fault injection,
  visual/accesibilidad, infraestructura DNS/TLS,
  backups/restauración, secretos/proxy y validación jurídica. Por ello no se
  declara todavía seguridad absoluta ni preparación de producción.

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
  de texto omitida. La suite completa pasó en `uvh_test`; la entrega real y el
  fault injection del proveedor continúan pendientes.
- BAF-124 incorporó el aviso de incidente al commit de cambio/reset de contraseña
  y finalización de recuperación reforzada. El helper usa al usuario bloqueado,
  propaga el fallo de admisión y ya no abre una segunda transacción independiente.
  BAF-125 excluye el bearer nuevo de la limpieza de enlaces antiguos. Hay casos
  preparados de fallo tras INSERT, repetición de los tres flujos, rollback
  exterior y retención; todos pasaron en la suite aislada.
- BAF-126 incorporó a sus transacciones los avisos de alta/sustitución de MFA,
  regeneración de códigos, desactivación y ambos buzones en cambio de email.
  Un segundo sobre fallido revierte también el primero. `SecurityNoticeAtomicityTest`
  tiene diez casos (ocho MFA y dos de email), ya pasados. Se documentó
  que estos avisos históricos no deben volverse obsoletos por cambios posteriores.
- BAF-127 incorpora los avisos de token API y transferencia/borrado de workspace
  al commit: fallo de admisión devuelve `503` y revierte cambios. BAF-128 evita
  gastar recovery code persistido cuando un webhook ocupado rechaza el borrado.
- BAF-129 admite el aviso de cancelación protectora en un savepoint: comparte
  commit si se admite, pero si falla prevalece detener la eliminación; no se
  promete entrega posterior sin outbox. `WorkspaceNoticeAtomicityTest` tiene
  siete casos, incluidos fallo SQL y segundo aviso, ya pasados.
  Rechazo/aprobación administrativa de recuperación ya usaban su transacción.
- BAF-130 aplica también al receptor de transferencias la cota de 20 workspaces,
  bajo el lock de usuario compartido con creación y antes de MFA. No cuenta
  pertenencias ajenas ni impide transferir hacia fuera con exceso histórico.
  `WorkspaceOwnershipLimitTest` prepara seis casos 19/20/21, incluido reintento
  tras borrar una plaza; los casos pasaron, sin ensayo de carreras multiproceso.
- BAF-131 cierra la rama incompleta de BAF-009: caducidad de pendientes antes de
  reinvitar, renovación transaccional de expiradas, conflictos controlados y
  listado con caducidad efectiva sin escritura. El panel permite reenviar
  expiradas y refresca estado/fecha sin confundir fallo de refresco con correo.
  `InvitationExpiryTest` contiene once casos ya pasados. Aceptar/rechazar
  invalida el enlace también en el instante exacto `expires_at`.
- BAF-132 cancela invitaciones pendientes de admin del owner anterior dentro de
  la transferencia; no toca editor/visor ni otros workspaces. BAF-133 cancela
  las emitidas al programar eliminación, además de las recibidas. Restaurar
  cuenta/autoridad no reactiva enlaces; fallos transaccionales revierten todo.
  Se revisaron degradación, expulsión, salida y bloqueo admin: ya cancelaban.
  `InvitationAuthorityLifecycleTest` contiene seis casos ya pasados; la UI
  advierte del efecto. No se han saneado datos de transiciones históricas.
- BAF-134 estabiliza el presupuesto 20/15 de invitaciones por cuenta/workspace
  sin ceros iniciales, compartido con reenvío; cambiar sesión ya no crea cuota.
  BAF-135 limita a 100 pendientes vigentes bajo lock; renovar una vencida ocupa
  plaza, reenviar una viva la reutiliza. `InvitationBudgetTest` prepara nueve
  casos ya pasados. No se aplicaron migraciones a `uvh_local` ni se borró historial.
  BAF-041 se reclasificó como mitigado: destinatario/IP/volumen diario y alertas
  siguen en `INVITATION-004`; no atribuir esas garantías al throttle existente.
- BAF-136 añade `InvitationMailBudget`: reserva SQL compartida con invitación
  y outbox, destinatario del reenvío desde la fila bloqueada, dimensiones
  cuenta/workspace/destinatario/IP/global y cooldown. Locks ordenados, reloj DB,
  HMAC con keyring, `429` con espera y `503` cerrado; métricas y purga acotada.
  Migración `2026_09_05_000032_create_invitation_mail_budgets.php` aplicada sólo
  en `uvh_test`. Los trece casos de `InvitationMailBudgetTest` pasaron.
  El `TestCase` limpia contadores sin FK tras el guard `*_test`; exige esquema
  completo. Runbook nuevo y solapamiento de claves actualizado a 24 horas.
  `INVITATION-004` sigue abierto por migración, calibración, concurrencia y alertas.
- BAF-137 añade `ReleaseReadiness` y `uvh:release-check` de sólo lectura:
  registro/pendientes, tabla/columnas 000032 y límites compartidos con admisión.
  Entrypoint estándar de producción bloquea PHP-FPM/queue/scheduler, no `migrate`;
  los healthchecks de contenedor repiten el gate. Los nueve casos actuales de
  `UvhReleaseCheckTest` y el comando aislado pasaron. No se probó la imagen real;
  no comprueba todo el esquema ni cambia el endpoint HTTP `/health`.
- `docs/todos.md` ya separa implementación, validación, producción y las 25 ideas
  opcionales `PRODUCT-*`. La radiografía inicial está escrita; no reconstruirla
  desde cero ni usar conteos históricos como medidas de cierre.
- BAF-138 conserva `Retry-After` en promesas/observables/blob y añade cuenta atrás
  en Equipo por workspace/email, con guards crear/reenviar/Enter, cancelación libre
  y sin envío automático. Memoria de componente, timer limpiado al destruir, sin
  persistencia de emails ni coordinación entre pestañas. Diecisiete casos frontend
  preparados (parser/API/servicio/handlers), ya pasados junto con typecheck/build;
  E2E sigue pendiente.
- BAF-143–180 cierran el lote de estabilidad frontend previo a nuevas funciones:
  aislamiento de respuestas por workspace/destrucción en Dashboard, Analítica,
  Dominios, Enlaces, Webhooks, Tokens, Equipo y Detalle; limpieza inmediata de
  datos y secretos; sondeos DNS/TLS acotados; Storage opaco validado sin coerción
  ni resurrección; QR con error controlado; descargas con Object URL durable; IDs
  de workspace enteros seguros y compatibilidad sin `matchMedia`. La suite subió
  a 125 casos y pasó junto con typecheck/build. Detalle y límites en
  `docs/frontend-stability-batch-2026-09-05.md`; E2E/visual sigue pendiente.
- El análisis nuevo de 100 candidatos se conserva en
  `docs/bug-analysis-100-candidates-2026-09-05.md`: tras revalidar el flujo
  completo quedan 69 confirmados por control, 4 probables, 16 gates y 11
  descartados explícitos. Los lotes corregidos abarcan BUG-001–020, BUG-024–029,
  BUG-036, BUG-038–041, BUG-043–046 y
  BUG-070–073: generación monotónica de sesión, aislamiento de 401/403/cabecera
  tenant, última respuesta vigente, mutaciones sensibles separadas de refresh,
  fallback MFA manual y rollback de navegación. Se añadieron specs directas de
  AuthService, interceptor, Ajustes y diálogo de enlaces; typecheck, build y
  148/148 casos pasaron. BUG-042 se descartó al confirmar que el servidor no
  exige un mínimo para la contraseña de enlace; BUG-087 ya tiene spec directa.
  El lote siguiente corrige BUG-047–051 en la pantalla de autenticación con
  revisiones de flujo/configuración/reenvío, destino y challenge capturados,
  guardia de destrucción y navegación única. Siete regresiones añadidas;
  typecheck, build y 155/155 casos pasaron. No se tocaron migraciones ni
  `uvh_local`.
  BUG-070–073 quedan ahora confirmados/corregidos: las cuatro rutas de Ajustes
  tienen regresiones directas para respuestas fuera de orden, contexto de sesión,
  página/total y loading. Tres casos nuevos; typecheck, build y 197/197 pruebas
  frontend pasaron.
  Invitaciones añade bearer/generación/ciclo de vida a inicialización, aceptar,
  rechazar y cambiar cuenta; corrige además el loading perpetuo de `auth.init()`
  fallido y respeta el `false` de `refreshWorkspaces()`. BUG-054–055 confirmados;
  BUG-052–053 endurecidos pero aún probables. Cinco regresiones nuevas;
  typecheck, build y 160/160 casos pasaron, sin tocar `uvh_local`.
  Los flujos BUG-056–067 usan peticiones bearer vigentes y separan reconciliación
  global de UI: `accountSignedOut(expectedGeneration)` no borra logins nuevos,
  pero conserva el signout cuando la respuesta que limpió cookie pertenece a la
  misma generación. BUG-056–065 y 067 confirmados/corregidos; BUG-066 endurecido
  y aún probable. Catorce regresiones nuevas; typecheck, build y 174/174 casos
  pasaron, sin backend ni `uvh_local`.
  BUG-068–069 quedan confirmados y corregidos: denuncia correlaciona por separado
  configuración hCaptcha y submit, y el diálogo de workspace descarta resultados
  posteriores a su cierre. Se restauraron los seis casos históricos del spec de
  denuncia antes de añadir tres regresiones nuevas; typecheck, build y 177/177
  casos pasaron, sin backend ni bases de datos.
  BUG-074–082 quedan confirmados y corregidos en Administración: siete listados
  correlacionan filtros/página/tamaño, overview y operaciones conservan el último
  snapshot, y sólo la revisión vigente de `reloadAll()` finaliza el refresh. Las
  acciones de filas se bloquean durante su recarga. Once regresiones nuevas;
  typecheck, build y 188/188 casos pasaron, sin backend ni bases de datos.
  BUG-083 queda endurecido pero aún probable: `ApiService` acepta decodificadores
  runtime y responde de forma controlada ante contratos inválidos sin exponer el
  cuerpo. `AuthService` ya valida todos los resultados que consume para sesión,
  tenant, MFA, perfil, exportación, eliminación, sesiones y recovery codes antes
  de alterar estado o llegar a la interfaz. Cinco regresiones adicionales elevan
  la suite a 202/202; typecheck y build pasaron. Falta cubrir los DTO sensibles
  consumidos fuera de `AuthService` para cerrar el candidato.
  El sublote siguiente valida en runtime tokens API, webhooks, entregas y el
  handoff de enlaces. Los secretos de una sola visualización, el bearer opaco,
  su caducidad y la URL reclamada se comprueban antes de publicarse o provocar
  navegación; `WebhookDelivery` se alinea además con `next_attempt_at` emitido
  por Laravel. Siete regresiones nuevas; typecheck, build y 209/209 casos pasaron,
  sin tocar backend ni bases de datos. BUG-083 continúa probable hasta cubrir el
  resto de consumidores sensibles.
  Equipo y alta de workspace quedan cubiertos en el sublote posterior: roles,
  miembros, invitaciones y paginación se decodifican atómicamente, y el detalle
  se liga al tenant/páginas/tamaños capturados para rechazar respuestas cruzadas.
  La creación exige rol `owner` antes de cerrar el diálogo. Cinco regresiones
  nuevas; typecheck, build y 214/214 casos pasaron, sin backend ni bases de datos.
  El cierre transversal posterior completa BUG-083: enlaces, reglas, analítica,
  dominios, Administración, privacidad, onboarding, configuración pública y
  confirmaciones públicas se decodifican antes de publicar estado o navegar.
  La auditoría de consumidores deja sólo actividad de workspace, que ya usa su
  lector runtime manual; los cuerpos ignorados no alimentan estado. Diecisiete
  regresiones nuevas elevan la suite a 231/231; 36 casos específicos de decoder,
  typecheck y build pasaron. BUG-083 queda confirmado/corregido. No se ejecutó
  backend ni se tocó ninguna base de datos en este lote.
  BUG-084 queda confirmado y corregido: presupuesto y doce secciones del export
  comparten una transacción PostgreSQL `REPEATABLE READ READ ONLY`, cerrada antes
  de JSON, cifrado, almacenamiento y outbox. El caso dirigido pasó con 8
  aserciones y la suite backend completa con 250 pruebas/2078 aserciones,
  exclusivamente en `uvh_test`; no se aplicaron migraciones ni se tocó
  `uvh_local`.
  El hallazgo posterior BUG-101 queda confirmado y corregido: las claves
  oficiales de prueba devolvían `dummy-key-pass`, pero el backend local exigía
  `localhost`, por lo que una verificación válida terminaba en 422. La excepción
  queda limitada a no producción + sitekey oficial. Login, registro y reenvío
  usan ahora hCaptcha invisible ejecutado al submit con token nuevo, espera del
  iframe, deduplicación y descarte de resultados fallidos. Pasaron typecheck,
  build, 234/234 pruebas frontend y el grupo hCaptcha backend (4 pruebas/18
  aserciones) sólo sobre `uvh_test`; `uvh_local` no se migró ni se probó.
  La revisión final serializa login y reenvío, que comparten widget, para impedir
  dos peticiones con un mismo token. La suite dirigida de Auth pasó 20/20 tras
  incorporar esa regresión; el total anterior 234/234 corresponde al corte previo.
- PRODUCT-001 iniciado por nueva prioridad: `WorkspaceOnboardingController`, GET
  `/api/v1/workspaces/:id/getting-started` verificado y limitado, consulta única con
  autorización/correlación y hechos minimizados. Tipo `WorkspaceGettingStarted`
  en Angular y cinco casos `WorkspaceOnboardingTest` ya pasados. Ahora también
  pantalla `/app/getting-started`, menú y tarjeta compacta en Dashboard; omitir y
  reanudar guarda sólo preferencia por usuario/workspace, no progreso. Al observar
  enlace/redirección/MFA se oculta la tarjeta; dominio/equipo son opcionales.
  Respuestas obsoletas se descartan por contexto/número/destrucción y omitir
  funciona incluso cargando/error. Sus trece casos frontend ya pasaron.
  PRODUCT-001 marcado como implementado; PRODUCT-VALID-001 abierto. No añadió
  migración ni se abrió navegador; detalles en `docs/getting-started-roadmap.md`.
- PRODUCT-002 iniciado: 000033 añade `audit_events.workspace_id` nullable positivo
  sin FK e índice de timeline; migración escrita, NO aplicada. `Audit::write`
  conserva scope explícito en afterCommit y deriva sólo del ID cuando el propio
  recurso es workspace. No infiere actor/metadata/cabecera ni hace backfill.
  Enlaces/dominios/tokens/webhooks, DNS/TLS y moderación de enlaces/denuncias llevan
  el contexto capturado; los eventos workspace ya quedan atribuidos por identidad.
  Fallo de audit sigue no bloqueante, sin reintento quitando scope. Release check
  valida la columna; contrato de esquema actualizado. Los seis casos de atribución
  y los nueve casos release actuales pasaron en `uvh_test`.
  Ya hay GET `/api/v1/workspaces/:id/activity` owner/admin: catálogo cerrado,
  DTO mínimo, sin metadata/email/IP, actor por ID actual o indisponible/moderación,
  resultados explícitos y cursor cifrado `Crypt` (APP_KEY) ligado a cuenta,
  workspace/security_version con TTL 1h no renovable. Páginas 1–100, locks/SQL
  con límites locales 2s/5s, throttle 60/min por cuenta más IP120/min. Sus veinte
  casos API pasaron. Pantalla `/app/activity` y menú owner/admin ya
  implementados: DTO separado, fechas UTC/resultados/cobertura, páginas manuales
  de 25 y cota 500 ajustada tras páginas cortas. Invalida por contexto, ignora
  respuestas tardías/destroy, borra todo ante errores y no reintenta solo.
  Cursor sólo en memoria; proyección de campos acotados sin HTML dinámico.
  Sus 29 casos frontend (18 componente, 5 DTO y 6 navegación) pasaron.
  PRODUCT-002 marcado implementado, PRODUCT-VALID-002 abierto; runbook actualizado.
- PRODUCT-003 implementado: `/app/usage` consume el agregado backend existente
  con decodificación runtime ligada a workspace y rol. Muestra enlaces, dominios,
  miembros, tokens, webhooks, invitaciones y retención según la proyección real;
  no inventa cuotas, precios ni capacidad cuando falta configuración. La vista
  descarta respuestas obsoletas, oculta categorías redactadas y respeta
  `Retry-After`. Diez regresiones nuevas, 245/245 frontend, typecheck y build
  pasaron; `WorkspaceUsageTest` pasó 12 casos/116 aserciones sólo en `uvh_test`.
  PRODUCT-VALID-003 permanece abierto para navegador/accesibilidad/rendimiento.
- PRODUCT-006/007/008/009/011 implementados el 6 de septiembre. Ya existen el
  diagnóstico de dominio con calendario compartido, inspector de webhook
  paginado/redactado, centro de seguridad minimizado, papelera con restore/purge
  reforzado y ayuda/estado públicos. `/api/v1/public-status` sólo consume un
  monitor externo HTTPS y falla a `unknown`; su despliegue externo se documenta
  en `docs/public-status-feed.md`.
- La validación integral posterior pasó **271 pruebas backend/2.204 aserciones**
  exclusivamente sobre `uvh_test`, y **253/253 pruebas frontend**, incluidas las
  regresiones de dominio/papelera/seguridad/estado público. Typecheck y build de
  producción pasaron. No se migró ni se probó `uvh_local`.
- Resumen técnico, garantías y límites en
  `docs/product-surfaces-completion-2026-09-06.md`. Permanecen abiertos los gates
  PRODUCT-VALID-006/007/008/009/011; código verde no acredita DNS/TLS, receptor,
  concurrencia, accesibilidad ni monitor externo reales.
- La base Playwright aislada ejecutó 18/18 recorridos en 16,3 minutos sobre
  `uvh_e2e_test`: a los quince ciclos críticos se añadieron Uso y límites, Centro
  de seguridad con revocación de sesión actual y purga irreversible con doble
  confirmación. La pila efímera se eliminó al terminar y `uvh_local` no se tocó.
  PRODUCT-VALID-003/008/009 avanzaron, pero siguen abiertos por roles, sesión
  remota, MFA de purga, accesibilidad, rendimiento y carreras multiproceso.
- El 7 de septiembre PRODUCT-VALID-003 avanzó con dos E2E de navegador real:
  owner/admin/editor/viewer recorrieron registro, verificación, invitación,
  aceptación, login y proyección de Uso; teclado, enlace de salto, reflow móvil
  390×844 y Axe WCAG 2.0/2.1 A/AA también pasaron. Se corrigieron el salto que
  abandonaba `/app` sin mover el foco y el contraste insuficiente de la etiqueta
  superior. `WorkspaceUsageTest` pasó 13 casos/120 aserciones en PostgreSQL
  efímero, incluido el agregado de 10.000 enlaces en una consulta y menos de 5 s.
  La suite reveló y corrigió contaminación de `RateLimiter` entre métodos al
  reiniciar IDs. El gate continúa abierto sólo para la revisión manual con lector
  de pantalla; las pilas efímeras se desmontaron y `uvh_local` no se modificó.
- La PR #17 conserva estos cambios en `test/playwright-e2e`. GitHub Actions y
  CodeQL no iniciaron ningún step porque GitHub informó que la cuenta estaba
  bloqueada por facturación; esa señal externa no sustituye la validación local.
- BAF-116/118/120 añadieron señales de antigüedad e incidentes; BAF-119 minimizó
  el listado webhook. BAF-121 documentó la rotación existente de `APP_SECRET` y
  añadió contratos pendientes. Los contratos operativos de API se actualizaron.
- La consola local `UVH Control` inicia y observa Docker, backend y frontend sin
  bloquear la GUI. Incluye reparación elevada y recuperable de sockets IPC de
  Docker Desktop, sin borrar imágenes, contenedores, volúmenes ni datos.
- La depuración posterior añadió manejo de salida/stderr vacío, detalle de
  proceso/archivo y lectura defensiva de `Exception.Response` bajo StrictMode.
  El modo `Status` terminó correctamente a las 16:46; falta validar visualmente
  la GUI, su cierre durante operaciones y los botones de parada/reinicio.
- La reparación local archivó runtimes corruptos de Docker como directorios
  `.stale-*`. En la comprobación actual Docker 29.7.2 y PostgreSQL estaban sanos;
  backend y frontend estaban detenidos, por lo que sus HTTP figuraron como no
  disponibles sin provocar una excepción del panel.
- `uvh_local` tiene 33 migraciones aplicadas y 3 pendientes (000032–000034) en
  la comprobación de las 16:46. Sólo se consultó; no se aplicaron automáticamente.

## Próximo punto exacto de continuación

1. Mantener pausadas nuevas funciones mientras se completan los gates de estabilidad
   que no cubre la suite actual: revisión visual/accesible, roles y sesiones remotas,
   concurrencia multiproceso, fault injection y dependencias externas, siempre en
   entornos aislados. Migración limpia y 18 E2E autenticados ya tienen evidencia.
2. PRODUCT-001/002/003/006/007/008/009/011 están implementados, pero continúan
   abiertos sus gates `PRODUCT-VALID-*`. La siguiente prioridad segura es ampliar
   roles/accesibilidad/concurrencia y validar dependencias reales, no el roadmap.
3. Para estado público, provisionar primero el monitor realmente externo y ejecutar
   el ensayo de independencia de `docs/public-status-feed.md`; sin configuración
   `/status` debe seguir mostrando `unknown`.
4. Mantener abiertos `MAIL-002` y los gates de validación/producción: alertas,
   retención aprobada, fault injection y proveedor real no se han acreditado.
5. Las suites están autorizadas únicamente con el guard `*_test`. No aplicar
   migraciones a `uvh_local`; PHP sigue sin estar en PATH y las verificaciones se
   ejecutaron dentro del contenedor reproducible.

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
  regresiones de transporte pasadas (rutas bajo backend-laravel).
- `backend-laravel/tests/Feature/PasswordNoticeAtomicityTest.php`: tres flujos con
  fallo tras INSERT y reintento, rollback exterior y limpieza del bearer nuevo;
  pasado sobre el esquema completo en `uvh_test`.
- `backend-laravel/tests/Feature/SecurityNoticeAtomicityTest.php`: MFA y fallo del
  segundo aviso de email; usa caché de prueba para conservar la marca TOTP fuera
  del rollback SQL. Pasado sobre el esquema completo en `uvh_test`.
- `backend-laravel/tests/Feature/WorkspaceNoticeAtomicityTest.php`: tokens,
  propiedad/borrado, webhook ocupado y cancelación protectora con savepoint.
- `backend-laravel/tests/Feature/WorkspaceOwnershipLimitTest.php`: cuota de
  propiedad al crear/recibir, exceso histórico y plaza liberada por borrado.
  Ambos pasaron sobre el esquema completo en `uvh_test`.
- `backend-laravel/tests/Feature/InvitationExpiryTest.php`: once casos de
  caducidad/renovación y rollback. Pasó sobre el esquema completo en `uvh_test`;
  también pasó la compilación, pero no el E2E del panel modificado.
- `backend-laravel/tests/Feature/InvitationAuthorityLifecycleTest.php`: seis
  casos de pérdida/retorno de autoridad, rollback y restauración de eliminación;
  pasado sobre el esquema completo de `uvh_test`.
- `backend-laravel/tests/Feature/InvitationBudgetTest.php`: nueve casos de
  presupuesto/capacidad; usa la caché array declarada en PHPUnit y requiere
  esquema completo en `*_test`. No ejecutado, no es ensayo multiproceso.
- `backend-laravel/app/Support/InvitationMailBudget.php`, migración 000032 y
  `backend-laravel/tests/Feature/InvitationMailBudgetTest.php`: presupuesto SQL,
  trece casos pasados. `docs/invitation-mail-budget-runbook.md`
  documenta límites iniciales, atomicidad, despliegue, keyring y validación pendiente.
- `backend-laravel/app/Http/Controllers/AuthController.php`: avisos de contraseña,
  MFA y cambio de email corregidos estáticamente; no hay evidencia runtime nueva.

## Regla para reanudar

Antes de continuar desde otra tarea, inspeccionar las fechas y el contenido de
los archivos anteriores. No marcar una casilla ni afirmar que algo está acabado
basándose solamente en este checkpoint.
