# Registro parcial S10 — centro de notificaciones, 2026-10-03

Lectura directa por función y pruebas de los fallos concretos; enumeración no equivale a cierre. S10 completo, demás productores/canales/retenciones, UI y gates reales mantienen estado abierto. B140(P2) audit fuera del commit, B141(P2) autoridad obsoleta de peticiones ya en curso y B142(P3) kinds duplicados reproducidos antes del fix. No afirmar bypass de middleware en nuevas peticiones ni silenciado de avisos obligatorios.

Rojo API46fallos/3controles,120aserciones,17,28s; rojo bare B1402fallos/1control,9aserciones,1,58s; rojo consultas2fallos/3controles,23aserciones,2,02s. Filtro final134/1007,37,75s y Pint471/PHPStan0,exit0; incluye54nuevos S10+14NotificationCenter previos+66O24. Full69090 terminado:1793/13590,369,85s,exit0 sólo uvh_test; ninguna edición PHP/tests durante suites. Hashes y anchors revalidados después de full.49 pruebas iniciales más3callers internos y2conteos;15O24 suman69controles nuevos respecto de O22/O23.

GET usa AccountReadContext resuelto por petición, sin FOR UPDATE/TX de negocio; middleware puede escribir heartbeat/budget fuera de la unidad. Las consultas sucesivas no forman snapshot serializable. Commands cuenta→sesión→filas dentro de TX con verified vigente; StaleSecurityContext409. Audit de preferencias va en su propia TX también para callers internos; no nuevo audit/step-up para read/readAll. IP queda hasheada. UI settings emite un único entry; decoder/payload/catalogo no cambian, sin nuevo gate visual/frontend. Vista reduce13SELECT delivery→1scoped por cuenta en GET y PATCH, sin prometer latencia medida.


## backend-laravel/app/Http/Controllers/NotificationController.php

Seis rutas y cuatro helpers completos leídos.42invalidaciones reales tras eager owner SELECT de hydrate (revoked/expiry exacta/sessionSV/owner/bloqueo/verified/accountSV), scopes y snapshots de dos cuentas verifican rechazo401GET/409command sin limpiar cookie ni mutar preferencias/inbox. Limits20/cursor/minimización,404 e idempotencia conservados.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `index` | 32 | B141: contexto SQL vivo antes de proyección; scopes/límite20+1/cursor y campos sin secretos conservados. Siete invalidaciones; paginación/volumen adicionales pendientes. |
| `unread` | 68 | B141: contexto vivo y count propio; siete invalidaciones no filtran contador. |
| `read` | 79 | B141: contexto verified bajo lock dentro de TX, update propio/idempotencia/404 y unread en commit. Siete invalidaciones no marcan filas. |
| `readAll` | 109 | B141: contexto verified bajo lock y update propio en TX; siete invalidaciones no alteran bandeja. No audit/step-up nuevos. |
| `preferences` | 123 | B141: contexto vivo; catálogo completo con batch scoped de deliveries. Siete invalidaciones y conteo1query comprobados. |
| `updatePreferences` | 138 | B140/B141/B142: validación forma/unicidad, autoridad verified dentro de TX y preferencias/sellado/exact audit comparten commit. Dead context, duplicates, admisión/historial/outer rollback y scopes comprobados. |
| `liveReadUser` | 183 | Adaptador completo AccountReadContext, sin autoridad para commands ni locks de mutación; null→401 en callers. |
| `lockedUser` | 189 | Factory SecurityContext exige TX y verified; falta de cuenta/sesión/version/TTL→StaleSecurityContext409. |
| `preferenceView` | 200 | Catálogo mismo orden/shape/category; deliveriesFor batch pasa13a1consultas de delivery en dos rutas. No cachea identidad. |
| `boundedLimit` | 215 | Código completo leído; regex1..3dígitos y cap20/default20 conservados; matriz exhaustiva de paging queda pendiente. |


## backend-laravel/app/Support/NotificationPreferences.php

Catálogo operativo y mandatory se mantienen. Update valida mapa entero; TX comparte preferencias/retirada digest y exact audit incluso sin wrapper HTTP. Bare failure debe lanzar y revertir; historial fallido conserva éxito/evidencia recuperable. Batch hereda misma normalización/default; IP sólo hash.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `deliveryFor` | 42 | Mandatory inmediato y lookup user/kind para otros callers conservados; misma normalización compartida. |
| `deliveriesFor` | 61 | Batch scoped por user; sólo catálogo conocido, mandatory fijo y default inmediato. Una consulta real por vista GET/PATCH; no acota toda operación HTTP a una query. |
| `normalizeDelivery` | 75 | Helper completo: string y allowlist cuatro canales; fallback inmediato, reutilizado en lookup individual/batch. |
| `wantsMail` | 87 | Helper completo: sólo entrega inmediata. Contratos NotificationCenter y digest conservados. |
| `update` | 104 | B140: exact audit dentro de TX de preferencias/sellado, incluidos callers sin TX exterior. Audit ausente/interrumpido rollback/retry, historial recuperable y outer commit/rollback comprobados. Mapa validado; duplicación HTTP se rechaza en controller. |


## backend-laravel/app/Support/NotificationInbox.php

Dependencia completa leída; sin modificación. Kind/scope/preferencias/dedupe y campos reducidos. No acredita todos los productores ni carreras entre productores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `record` | 36 | Kind desconocido/scope incompatible rechazados; preferencias, insertOrIgnore/dedupe y sello digest conservados. Casos previos NotificationCenter incluidos. |
| `unreadCount` | 81 | Count propio read_at null; rechazos de contexto y foreign scopes comprobados por caller, sin validar todos los volúmenes. |


## backend-laravel/app/Support/NotificationKinds.php

Catálogo completo y helpers leídos, sin cambiar kinds ni espejo frontend. Obligatorios siempre immediate/no configurables; otros canales operativos. No atribuir revisión de cada productor por conocer su kind.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `all` | 136 | Constante catálogo cerrado; view conserva lista completa y categorías. |
| `exists` | 141 | isset de catálogo; validación de lotes y unknown kind cubierta. |
| `category` | 146 | Categoría o null; propiedad mandatory conservada. |
| `isMandatory` | 151 | Comparación categoría mandatory; preferencia plantada no silencia crítico. |
| `isWorkspaceScoped` | 156 | Boolean declarado; scope de cuenta rechazado en record. |
| `route` | 161 | Ruta interna declarada o null; no interpretar route como bearer ni permiso. |
| `title` | 166 | Texto declarado o null; renderer escapa los campos, sin modificación. |


## backend-laravel/app/Console/Commands/UvhNotificationsDigest.php

Comando completo leído; no modificación. Pruebas existentes cubren preferencias retiradas, outbox+seal, dedupe/retry y201cuentas con cap200. Sólo comando de test aislado; sin worker/scheduler/proveedor real. Candidatos/locks de notificaciones, preferencias/cuenta sólo lectura; no nueva prueba nativa de todas las interacciones ni cierre de email/bloqueo/retención.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 59 | Agrupa candidatos cap200 en orden user; errores por cuenta aislados y siguiente pasada. Caso201conservado. |
| `digestUser` | 92 | TX claim notifications FOR UPDATE cap500, revalida canales, outbox determinista+seal juntos. Fallo admisión conserva pendientes y retry sin duplicar. |
| `digestibleKinds` | 153 | Lookup batch propio y mandatory excluidos; sólo daily_digest vigente admite claim. |
| `render` | 175 | Muestra20, hiddencount y URL interna; escapa title/subject/date. Contratos existentes, sin nueva QA visual. |
| `esc` | 198 | htmlspecialchars ENT_QUOTES/ENT_SUBSTITUTE UTF8, código completo leído; no se acredita contenido de otras plantillas. |


O24/O25 verificados (03/10): full1793/1793 backend,13590aserciones,369,85s exclusivamente uvh_test (`s10-notification-session-full-backend.log`),exit0;69controles nuevos respecto a1724 (15revocación+54notificaciones).134/1007 dedicado final37,75s y Pint471/PHPStan0,exit0. B140(P2) exact audit preferencias en su TX, también bare callers; B141(P2) seis rutas revalidan cuenta/sesión y verified,401GET/409command sin datos/cookies/cambios ante42invalidaciones tras hydrate; B142(P3) duplicate kind422sin cambio. Rojo API46fallos/3controles,120aserciones,17,28s; bare2fallos/1control,9aserciones,1,58s; consultas2fallos/3controles,23aserciones,2,02s. Vista reduce13SELECT delivery→1scoped por cuenta en GET/PATCH, sin atribuir latencia ni una sola query total HTTP. O24tres TX completas comparadas tras format;66/604antes20,06s/después18,79s, policy/logout intactos. AuthController1469→1408líneas; baseline162/151→161findings/150entradas, sólo1retorno resuelto retirado sin nuevos ignores. Inventario467archivos/2211funciones con nombre/1141callbacks/3firmas;467hashes y225anchorsS01/53files+16S03/2files+29S10/5files comprobados después de full. Node--check/diff correctos. No PHP/tests edits durante suites ni frontend/nueva suite/browser/E2E/migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. S01–S13/objetivo global abiertos; siguiente UI de notificaciones ligada a identidad, todavía candidato sin ID, más productores/retención/gates reales y CI billing histórico pendiente sin nueva consulta.


O26 frontend: B143(P2) preferencias de identidad anterior/destrucción; B144(P3) respuestas de preferencias fuera de orden o anteriores a PATCH; B145(P2) inbox antiguo y busy heredado al cambiar de cuenta. Rojo12fallos/47controles en componentes y3fallos/1control con AuthService/ApiService/NotificationService/apiInterceptor/HttpTestingController reales. Definitivo72/72 dedicados;21controles nuevos y916/916 full frontend,exit0. Lint/tipos/build exit0; no PHP cambiado ni nueva suite backend atribuida. UI QA con fixture local, detalles y límites en informe. No dispatch guard global nuevo; frontera CSRF/login pendiente.


## frontend/src/app/core/services/notification.service.ts

Lectura completa de las funciones enumeradas y callbacks internos. Settings es revisión acotada; no se acredita la clase completa.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `currentGate` | 26 | O26: Generación renueva gate; no cache entre identidades. |
| `readCount` | 41 | O26: Revision/epoch/pending protegen contador; DTO sigue caller, por eso guard UI requerido. |
| `mutateCount` | 55 | O26: Cola serializada, check antes del siguiente POST y contador sólo generación vigente; no abortar writes enviados. |
| `refreshUnread` | 75 | O26: Decoder bounded, unread propio. |
| `list` | 81 | O26: Read options llegan al API/decoder, count no reaparece por respuesta vieja. |
| `markRead` | 86 | O26: Ruta por ID y cola de marks, sin nueva semántica de admisión. |
| `markAllRead` | 91 | O26: Misma cola, old response puede terminar sin publicar contador. |
| `preferences` | 96 | O26: Extiende options opcionales para abortar GET superseded; decoder real preservado. |
| `updatePreferences` | 103 | O26: PATCH/decoder intactos; propietario UI captura identidad antes de await. |


## frontend/src/app/panel/notifications/notifications.component.ts

Lectura completa de las funciones enumeradas y callbacks internos. Settings es revisión acotada; no se acredita la clase completa.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `openDetail` | 40 | O26: Workspace debe existir en lista local; navegación interna decoder. Resto de roles/gates pendientes. |
| `kindLabel` | 60 | O26: Catálogo compartido, sin texto del bearer. |
| `kindIcon` | 64 | O26: Iconos de catálogo. |
| `constructor` | 68 | O26: Effect compara accountContext, vacía snapshot e invalida operación; recarga usuario actual fuera de tracking. |
| `accountContext` | 80 | O26: ID + generación distinguen nueva sesión de A. |
| `resetInbox` | 84 | O26: Limpia items/cursor/error/loading/busy e invalida sólo reads. |
| `load` | 93 | O26: Respuesta/errors/finally sólo request/identity actuales; read cancelable, anónimo no consulta. |
| `loadMore` | 116 | O26: Pagination scoped al snapshot y operación actuales; old busy no bloquea nueva identidad. |
| `markRead` | 136 | O26: POST sigue vivo; respuesta/errors/finally nunca mutan otro snapshot. |
| `markAllRead` | 155 | O26: Mismo ownership local, countdown service por generación. |


## frontend/src/app/panel/settings/settings.component.ts

Lectura completa de las funciones enumeradas y callbacks internos. Settings es revisión acotada; no se acredita la clase completa.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `notificationKindLabel` | 276 | O26: Catálogo compartido. |
| `notificationKindIcon` | 280 | O26: Iconos catálogo. |
| `notificationDeliveryLabel` | 284 | O26: Etiquetas de delivery. |
| `resetNotificationPreferences` | 288 | O26: Vacía DTO/errors/flags e invalida read/revisión en identity/destroy. |
| `loadNotificationPreferences` | 296 | O26: LatestRequest con accountContext/abort; old response/error/finally descartados, no GET durante PATCH. |
| `setNotificationDelivery` | 316 | O26: Write supersedes GET previo; guard anterior a todos los efectos/errores/finally. Mandatory no enviado; PATCH no cancelado. |
| `constructor` | 338 | O26: Callbacks completos de identity/destroy leídos; recarga prefs sólo si usuario. Callers ajenos no acreditados por leer constructor. |
| `accountContext` | 1115 | O26: ID + generación protege A→B→A y misma cuenta/nueva sesión. |
| `toast` | 424 | O26: Se usa sólo si la mutación de preferencias sigue siendo dueña; mensaje ApiRequestError/fallback preservado. |


## frontend/src/app/core/services/notification-response-decoders.ts

Lectura completa de las funciones enumeradas y callbacks internos. Settings es revisión acotada; no se acredita la clase completa.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `timestamp` | 16 | O26: Timestamp ISO/Date.parse bounded, null sólo permitido por contrato. |
| `route` | 25 | O26: Ruta /app/ acotada sin query/hash; no URL absoluta. No nueva prueba roles de destinos. |
| `decodeNotificationInbox` | 40 | O26: Página20/cursor/unread/id/kind/subject/route/timestamps, el mismo shape atraviesa HTTP en nuevas pruebas. |
| `decodeNotificationUnread` | 60 | O26: Integer count bounded por helper. |
| `decodeNotificationPreferences` | 70 | O26: Catálogo/category cruzados y delivery allowed; prueba real de categoría contradictoria preservada. |
| `invalidCategory` | 86 | O26: Rechazo contract drift no publica valor recibido. |
