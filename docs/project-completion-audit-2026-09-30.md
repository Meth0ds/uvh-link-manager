# Auditoría de código y cierre de UVH — 30/09/2026

## Dictamen

Actualizado el **01/10/2026** tras la corrección. Los hallazgos B01–B19 tienen cambios de código y regresiones. Se añaden B20–B27, encontrados durante la implementación. La deuda implementable se ha abordado; siguen pendientes las comprobaciones que requieren infraestructura, proveedores y responsables reales. Esta revisión parte del commit `6852e11` y conserva los cambios del usuario sin commit. No es una certificación de seguridad ni una afirmación de cobertura exhaustiva.

La lista original contiene **42 entradas: 19 hallazgos, 13 de deuda o decisiones y 10 puertas de lanzamiento**. Las ocho entradas adicionales no se ocultan dentro de ese recuento. La lectura del código identifica las causas; las pruebas corroboran reproducciones concretas. Los límites de cada cierre figuran aquí y en [el runbook de correcciones](remediation-operations-2026-09-30.md).

Prioridades: P1 corregir antes de lanzamiento; P2 corregir antes de dar por terminado el alcance afectado; P3 caso límite/mejora. Un punto de deuda no implica una vulnerabilidad y una puerta sin evidencia no implica que su implementación esté rota.

## Hallazgos de código y dependencias

### B01 · P1 · Invitación explícitamente inválida sustituida por la cookie

**Estado:** Corregido + regresión.

**Evidencia:** [WorkspaceController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/WorkspaceController.php>).

**Causa/escenario:** Antes, token vacío/null/array aceptaba o rechazaba la invitación aparcada. Se confundía ausencia con invalidez.

**Cierre:** Cookie sólo si la clave token está ausente; inválido explícito → 422 y ninguna membresía/invitación cambia.

### B02 · P1 · Intención inválida sustituida por otra intención guardada

**Estado:** Corregido + regresión.

**Evidencia:** [LinkIntentController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/LinkIntentController.php>).

**Causa/escenario:** bodyIntent devolvía null y intentSource recurría al cookie incluso con intent explícito malformado; claim/complete operaban sobre otro bearer.

**Cierre:** Ausente conserva el flujo aparcado; explícito inválido → 404 sin reclamar, completar ni retirar cookie.

### B03 · P1 · Sesión revocada durante I/O todavía recibía exportación privada

**Estado:** Corregido + regresión.

**Evidencia:** [AccountController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/AccountController.php>).

**Causa/escenario:** Tras abrir/validar el artefacto, la segunda transacción comprobaba cuenta y exportación, pero no sesión. Revocar una sesión individual no cambia security_version de la cuenta.

**Cierre:** Revalidar sesión no revocada, no expirada y generación bajo lock antes de preparar entrega. La reproducción revoca al abrir readStream y exige 409 sin download_served_at.

### B04 · P2 · CSV de enlaces descargado después de cambiar workspace/vista

**Estado:** Corregido + regresión.

**Evidencia:** [links.component.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/links/links.component.ts>).

**Causa/escenario:** exportCsv espera el blob y ejecuta downloadBlob y snackbar sin guard de contexto ni DestroyRef. Una respuesta de A puede descargarse mientras la pantalla muestra B.

**Cierre aplicado:** LatestRequest de exportación, sesión/workspace/DestroyRef; respuestas tardías A→B→A y vista destruida no descargan ni publican errores.

### B05 · P2 · Export de analítica obsoleto

**Estado:** Corregido + regresión.

**Evidencia:** [analytics.component.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/analytics/analytics.component.ts>).

**Causa/escenario:** La lectura usa LatestRequest, pero export no. Cambiar workspace o rango durante la descarga deja salir un resultado que ya no corresponde a la pantalla.

**Cierre aplicado:** Exportación invalidada al cambiar sesión, workspace, rango o vista; guard independiente de las lecturas normales.

### B06 · P2 · Contador de notificaciones puede retroceder

**Estado:** Corregido + regresión.

**Evidencia:** [notification.service.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/notification.service.ts>).

**Causa/escenario:** refreshUnread/list/markRead/markAllRead escriben la misma señal después de await sin secuencia. Un GET lento con unread=1 puede llegar después de marcar todo y restaurar 1.

**Cierre aplicado:** Lecturas con revisión y epoch de mutación; escrituras serializadas por generación. Un GET viejo no resucita el contador.

### B07 · P2 · Contador de notificaciones sobrevive al cambio de cuenta

**Estado:** Corregido + regresión.

**Evidencia:** [notification.service.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/notification.service.ts>).

**Causa/escenario:** Servicio raíz, señal sin enlace a AuthService/sessionGeneration y respuestas sin comprobación de sesión. Conserva o publica el contador de la cuenta previa.

**Cierre aplicado:** Contador ligado a identidad reactiva y generación; una escritura encolada de la sesión antigua no se ejecuta usando la cookie nueva.

### B08 · P2 · Bandeja permite que una carga vieja sustituya una nueva

**Estado:** Corregido + regresión.

**Evidencia:** [notifications.component.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/notifications/notifications.component.ts>).

**Causa/escenario:** load sólo comprueba busy, no loading ni revisión; llamadas simultáneas publican en orden de llegada. No hay guard de destrucción/contexto en carga/paginación/marcado.

**Cierre aplicado:** Carga, paginación y marcado protegidos por LatestRequest y generación de sesión; no publican después de destruir la vista.

### B09 · P2 · Ver detalle abre el workspace seleccionado, no el del aviso

**Estado:** Corregido + regresión.

**Evidencia:** [notifications.component.html](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/notifications/notifications.component.html>).

**Causa/escenario:** NotificationItem incluye workspaceId, pero routerLink sólo usa route. Un aviso de A conduce al equipo/tokens/dominios de B si B está seleccionado.

**Cierre aplicado:** Se selecciona el workspace del aviso tras comprobar membresía; si ya no existe acceso, se explica sin navegar al workspace equivocado.

### B10 · P2 · La plantilla 201 rompe la carga de plantillas

**Estado:** Corregido + regresión.

**Evidencia:** [LinkTemplateController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/LinkTemplateController.php>) / [scale-response-decoders.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/scale-response-decoders.ts>).

**Causa/escenario:** Laravel crea sin cuota de cantidad y devuelve todas; Angular rechaza arrays de más de 200.

**Cierre aplicado:** Cuota configurable de creación bajo lock (200 por defecto) y lectura sin rechazar catálogos históricos mayores. GET sigue sin paginación remota.

### B11 · P2 · La colección 501 rompe el gestor/selector

**Estado:** Corregido + regresión.

**Evidencia:** [CollectionController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/CollectionController.php>) / [scale-response-decoders.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/scale-response-decoders.ts>).

**Causa/escenario:** Listado sin paginación ni cuota de creación frente a boundedArray(...,500).

**Cierre aplicado:** Cuota configurable de creación bajo lock (500 por defecto) y lectura completa de colecciones históricas por encima de la cuota.

### B12 · P2 · La etiqueta 501 rompe el gestor de etiquetas

**Estado:** Corregido + regresión.

**Evidencia:** [TagController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/TagController.php>) / [scale-response-decoders.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/scale-response-decoders.ts>).

**Causa/escenario:** Tags creados desde enlaces; límite por enlace de 20 no limita el total del workspace. GET devuelve todos y decoder admite 500.

**Cierre aplicado:** Cuota de nuevas etiquetas por workspace bajo lock, reutilización permitida; históricos superiores a 500 siguen legibles. GET completo conserva un riesgo de coste para catálogos enormes.

### B13 · P2 · Unicode aceptado al guardar pero rechazado al leer

**Estado:** Corregido + regresión.

**Evidencia:** [response-decoder-helpers.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/response-decoder-helpers.ts>) / [LinkService.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Support/LinkService.php>).

**Causa/escenario:** PHP usa mb_strlen; text/nullableMultiline de Angular usa string.length (UTF-16). Una etiqueta de 21 emojis tiene 21 caracteres y 42 unidades y supera el máximo de lectura de 40. También nombres de colecciones/plantillas y otros campos.

**Cierre aplicado:** Decoders y validadores de campos Unicode cuentan code points, igual que mb_strlen. Los límites ASCII y de bytes de credenciales conservan su contrato.

### B14 · P2 · Totales y gráficas de analítica pueden contradecirse

**Estado:** Corregido + regresión.

**Evidencia:** [AnalyticsController.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Http/Controllers/AnalyticsController.php>).

**Causa/escenario:** buildOverview realiza count, visitantes, serie, top y seis dimensiones por consultas separadas fuera de un snapshot consistente. Ingestión entre consultas produce distintos conjuntos de eventos.

**Cierre aplicado:** Overview construido en transacción PostgreSQL REPEATABLE READ READ ONLY; regresión con inserción desde una segunda conexión entre consultas.

### B15 · P2 · Credenciales destructivas permanecen al cambiar workspace

**Estado:** Corregido + regresión.

**Evidencia:** [team.component.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/team/team.component.ts>).

**Causa/escenario:** El effect reinicia detalle/páginas y candidatos de transferencia, pero no deleteOpen/deleteConfirmation/deletePassword/deleteFactorCode ni transferPassword/transferFactorCode. El formulario conserva secretos/contexto previo.

**Cierre aplicado:** Cambiar workspace cierra los diálogos destructivos y vacía contraseña, factor y confirmación, incluso con petición pendiente.

### B16 · P2 · Borrado tardío de workspace interrumpe otra pantalla

**Estado:** Corregido + regresión.

**Evidencia:** [team.component.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/panel/team/team.component.ts>).

**Causa/escenario:** El éxito después de api.delete limpia formulario y navega a dashboard sin target.isCurrent ni guard de destrucción. Si el usuario cambió a B durante la petición de A, lo saca de B.

**Cierre aplicado:** El resultado del borrado sólo modifica la vista si sigue viva y mostrando el workspace objetivo. La reconciliación global de la lista mantiene su función.

### B17 · P3 · Contador DNS puede superar el máximo admitido por Angular

**Estado:** Corregido + regresión.

**Evidencia:** [VerifyDomainDnsJob.php](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/app/Jobs/VerifyDomainDnsJob.php>) / [domain-response-decoders.ts](</Users/roberto/Downloads/UVH Link Manager/frontend/src/app/core/services/domain-response-decoders.ts>).

**Causa/escenario:** dns_failure_count suma uno sin techo en fallos consecutivos; decoder impone máximo 1000. Alcanzar 1001 invalida el DTO y puede impedir abrir el dominio/listado. No se ha ejecutado un ensayo de 1001 comprobaciones.

**Cierre aplicado:** Contadores DNS/TLS admiten enteros seguros no negativos, sin techo artificial de 1000.

### B18 · P2 · Aviso de XSS en página de debug de Laravel

**Estado:** Dependencia actualizada.

**Evidencia:** [composer.lock](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/composer.lock>).

**Causa/escenario:** Versión inicial 13.26.1 afectada por GHSA-jh5r-qr3c-85q8; requiere APP_DEBUG=true y una interacción concreta. No se ha demostrado explotación en producción.

**Cierre:** Actualizado a 13.34.0; composer audit limpio. Mantener debug deshabilitado fuera de desarrollo.

### B19 · P2 · Aviso de normalización de rutas en Flysystem

**Estado:** Dependencia actualizada.

**Evidencia:** [composer.lock](</Users/roberto/Downloads/UVH Link Manager/backend-laravel/composer.lock>).

**Causa/escenario:** Versión inicial 3.35.2 afectada por GHSA-cxf4-7mrp-vvpr. Rutas de artefactos de UVH ya están acotadas; no se ha demostrado explotación desde una ruta de UVH.

**Cierre:** Actualizado a 3.36.0. La continuación añade también la actualización de CommonMark documentada en B25.

Los avisos externos se verificaron en sus fuentes: [Laravel GHSA-jh5r-qr3c-85q8](https://github.com/advisories/GHSA-jh5r-qr3c-85q8) y [Flysystem GHSA-cxf4-7mrp-vvpr](https://github.com/advisories/GHSA-cxf4-7mrp-vvpr). Ambos están clasificados como bajos en origen; la prioridad P2 aquí indica mantenimiento previo al lanzamiento, no una nueva valoración CVSS.

## Hallazgos adicionales corregidos durante la implementación

### B20 · P2 · Catálogo frontend incompleto de notificaciones de dominios

Seis kinds que ya emitía Laravel faltaban en Angular; un aviso válido podía invalidar toda la bandeja y sus preferencias. Catálogo sincronizado y regresión que recorre todos los kinds. No se han sustituido los productores de dominios existentes.

### B21 · P2 · Diálogos de colecciones/etiquetas publican en otro workspace

Una mutación tardía podía cerrar, recargar o publicar un error en un contexto nuevo. Los diálogos invalidan irrevocablemente el contexto al cambiar workspace/cerrar y comprueban DestroyRef antes de efectos posteriores a await.

### B22 · P2 · Nuevos avisos en dependencias de frontend

Angular actualizado a 22.2.1 (CLI/build 22.2.0), fast-uri a 3.1.8 y transitivas compatibles actualizadas. npm ci reproducible y npm audit sin vulnerabilidades. El aviso Angular de SSR no demuestra explotación en esta SPA; se actualiza el paquete afectado igualmente.

### B23 · P1 mantenimiento · Imágenes de herramientas locales/ensayo con CRITICAL

Adminer actualizado a 5, CoreDNS a 1.14.7. Pebble se recompila desde el mismo commit upstream verificado con Go 1.27.1, archivo fuente con checksum y runtime scratch. Escaneo separado del binario y prueba ACME/TLS real contra el fixture. No se han añadido excepciones para ocultar estos avisos.

### B24 · P2 · Verificador de digests no falla ante pin imposible de consultar

Una etiqueta que había cambiado ocultaba que el digest fijado no se había verificado. El modo --fail-on-unavailable ahora cuenta ese caso; regresión offline ejecuta el script real y diferencia el pin consultable del desconocido. La deriva del tag por sí sola sigue sin ser un fallo.

### B25 · P2 mantenimiento · Nuevos avisos de CommonMark publicados después de la primera consulta

La consulta del 01/10 detectó dos avisos incorporados a la base el 30/09 por la tarde: bypass de filtrado HTML y coste cuadrático de la extensión de tablas. Se actualiza únicamente league/commonmark a 2.10.3 (la corrección empieza en 2.10.2), conservando el resto del lock. No se encontró uso directo de Markdown de usuarios en app/resources; no se afirma explotación demostrada. Fuentes: [filtrado HTML](https://github.com/advisories/GHSA-97jj-33gv-5xf9) y [tablas](https://github.com/advisories/GHSA-3q6v-r5mr-hxv8).

### B26 · P2 · Resultado tardío de abandono/transferencia cambia otra vista

Los caminos de éxito en Equipo no tenían las mismas guardas que el borrado. Ahora abandono, transferencia y borrado capturan una revisión de mutación, workspace y generación; se invalidan al cambiar contexto o destruir la vista. La reconciliación global sólo se hace dentro de la misma sesión. Regresiones para transferencia tras cambiar workspace y abandono tras destruir la vista.

### B27 · P2 validación · Captura prematura de códigos de recuperación en E2E

Dos recorridos de MFA leían evaluateAll inmediatamente después del HTTP 200, antes del render de Angular; la lista podía estar vacía pese a una activación correcta. Esperan ahora a que el código necesario sea visible antes de capturarlo. Se conservan las aserciones de cantidad/consumo y no se añaden retries ni tiempos mayores.

## Deuda y decisiones con respaldo en el código

### D01 · P2 · Cuota de miembros no implementada

**Estado:** Implementado + regresión.

Cuota de miembros configurable (1000 por defecto) admitida bajo lock tanto al invitar como al aceptar. Rechazar por capacidad conserva la invitación; el endpoint de uso publica el límite efectivo.

### D02 · P2 · Límites sin entitlements de plan

**Estado:** Cerrado por alcance e implementación.

Una modalidad standard sin pagos. entitlements.php centraliza cuotas configurables y el arranque de producción rechaza configuraciones inválidas. No se inventan varios planes comerciales.

### D03 · P2 · Estado de purga no demuestra ejecución

**Estado:** Implementado + regresión.

purgeVerified exige una ejecución reciente que completó las tres purgas y coincide con la política actual. Un fallo de admisión de la prueba de purga no se anuncia como éxito.

### D04 · P1 si se exige auditoría durable · Eventos de auditoría best effort

**Estado:** Implementado para admisión y mutaciones críticas; límite legacy documentado.

audit_outbox se admite con las mutaciones compartidas de workspace, avisos de seguridad y creación/revocación de token y creación de webhook. Recuperación idempotente por housekeeping. Los llamadores legacy que auditan después de su operación mantienen una ventana anterior a la admisión; no se afirma atomicidad universal.

### D05 · P2 · Trazabilidad de peticiones y jobs incompleta

**Estado:** Implementado + regresión.

ID interno nginx→Laravel→cola→outbox/logs/audit; restauración del contexto al terminar callbacks y jobs. El ID recibido del cliente no se considera de confianza.

### D06 · P2 · Latencia medida sólo como petición lenta

**Estado:** Implementado; calibración real pendiente.

Buckets de duración, count y sum de ventana de 60 minutos, con cardinalidad acotada y una escritura por muestra. SLOs iniciales y consultas documentados.

### D07 · P2 · Métrica HTTP no cubre ejecución del cuerpo streaming

**Estado:** Implementado + regresión.

Preparación y callback streaming tienen fases separadas; contabiliza callback completado/fallido. No acredita recepción completa por el cliente.

### D08 · P2 · Contención de la fila link/día de analítica

**Estado:** Medido en fixture local; capacidad de producción pendiente.

Ensayo async 128/128 con dos rondas: mediana flood hot@1 3719ms, hot@4 1362ms y spread@4 1875ms; arrival hot@4 7791ms frente a fillfactor70 745ms. Hay variabilidad importante y recursos locales compartidos: no se elimina el lock de corrección ni se cambia fillfactor global sobre esta evidencia. Debe repetirse en hardware objetivo y carga representativa.

### D09 · P2 · Overview repite agregaciones sobre eventos crudos

**Estado:** Implementado + regresión; escala real pendiente.

Caché de overview 30s por defecto, 0–60 configurable, scope por workspace/enlace/rango y autorización previa. Snapshot coherente al reconstruir; agregados pueden tener hasta un TTL de antigüedad.

### D10 · P2 producto · Avisos operativos faltantes

**Estado:** Implementado + regresión.

Cinco avisos operativos: enlace próximo a caducar/agotar clics, token próximo a caducar, invitación próxima a caducar y webhook agotado. Ledger por generación, destinatarios vivos, preferencias y admisión atómica; si aparece un administrador fuera del conjunto bloqueado se difiere el evento sin consumirlo; lotes de 20 por tipo.

### D11 · P3 decisión · Revocación individual sin aviso de seguridad

**Estado:** Implementado + regresión.

Revocación individual y aviso de seguridad se admiten juntos; fallo de correo revierte la revocación, repetir no duplica aviso.

### D12 · P3 decisión · Revocar otras sesiones no exige step-up

**Estado:** Cerrado por alcance; contrato mantenido.

Revocar otras sesiones conserva sesión autenticada y CSRF sin step-up para permitir contención aun con segundo factor perdido. No cambia credenciales ni concede acceso; no se presenta como reautenticación implementada.

### D13 · P2 · Estado de cierre documental desactualizado

**Estado:** Actualizado en esta pasada.

Informe, backlog y preparación de producción distinguen evidencia actual local, evidencia histórica y verificaciones externas pendientes.

## Puertas de lanzamiento: evidencia local y requisitos externos

Estos diez puntos provienen de los contratos/runbooks del repositorio. No son diez bugs adicionales. Las puertas locales ejecutadas se registran abajo; no certifican un despliegue real ni sustituyen proveedores y responsables externos.

### G01 · CI y siete puertas adicionales

**Estado:** Puertas locales ejecutadas; CI remoto pendiente. **Fuente:** [verify-local.mjs](</Users/roberto/Downloads/UVH Link Manager/scripts/verify-local.mjs>).

Resultados actuales de las siete puertas en el runbook de correcciones. Navegador final 31/31 después de corregir la captura de MFA; resultados finales de backend/frontend y smoke de release en el runbook. El bloqueo remoto de facturación está documentado históricamente, pero no se ha comprobado su estado actual en GitHub.

### G02 · DNS/TLS/ACME reales

**Estado:** Verificación del entorno real pendiente. **Fuente:** [production-readiness.md](</Users/roberto/Downloads/UVH Link Manager/docs/production-readiness.md>).

Validar hosts públicos y personalizados, ownership, CAA, pérdida/recuperación de routing, emisión, renovación y retirada en infraestructura real.

### G03 · Correo y captcha reales

**Estado:** Verificación del entorno real pendiente. **Fuente:** [production-readiness.md](</Users/roberto/Downloads/UVH Link Manager/docs/production-readiness.md>).

Recorridos con proveedor y claves definitivas: confirmación, reset, cambios de seguridad, correo fallido/reintentado y CSP del iframe. Mailpit y fakes no prueban entregabilidad real.

### G04 · Backups y restauración operativa

**Estado:** Verificación del entorno real pendiente. **Fuente:** [backup-and-restore.md](</Users/roberto/Downloads/UVH Link Manager/docs/backup-and-restore.md>).

Programación, almacenamiento independiente, retención y restauración medida de DB y volúmenes/secretos necesarios; dejar RPO/RTO y alertas con responsable.

### G05 · Migración y rollback de release

**Estado:** Verificación del entorno real pendiente. **Fuente:** [deployment.md](</Users/roberto/Downloads/UVH Link Manager/docs/deployment.md>).

Copia representativa, tiempo/bloqueo de migraciones actuales y rollback con dos releases reales y artefactos compatibles; no limitarse a migrate:fresh de test.

### G06 · Alertas y SLOs con guardia

**Estado:** Verificación del entorno real pendiente. **Fuente:** [current-backlog.md](</Users/roberto/Downloads/UVH Link Manager/docs/current-backlog.md>).

Destino de alertas, responsable y ensayo de worker/scheduler caído hasta alerta recibida y recuperación; monitor externo de status con umbral y escalado.

### G07 · Secretos, proxy y conexión de producción

**Estado:** Verificación del entorno real pendiente. **Fuente:** [production-readiness.md](</Users/roberto/Downloads/UVH Link Manager/docs/production-readiness.md>).

Custodia y rotación de claves, red real de proxies de confianza, TLS de PostgreSQL y persistencia/failover de Redis; comprobar cabeceras/cookies contra dominio definitivo.

### G08 · Provenance y promoción de imágenes

**Estado:** Verificación del entorno real pendiente. **Fuente:** [image-provenance-runbook.md](</Users/roberto/Downloads/UVH Link Manager/docs/image-provenance-runbook.md>).

Digest, firma/provenance y promoción verificables sobre las imágenes exactas que se despliegan, incluidas arquitecturas soportadas.

### G09 · Matriz UX y accesibilidad manual

**Estado:** Verificación del entorno real pendiente. **Fuente:** [production-readiness.md](</Users/roberto/Downloads/UVH Link Manager/docs/production-readiness.md>).

Móvil/escritorio, claro/oscuro, navegadores soportados, teclado y VoiceOver/NVDA/JAWS. Esta pasada de código no certifica calidad visual ni lector de pantalla.

### G10 · Titular, soporte y procesos de privacidad

**Estado:** Verificación del entorno real pendiente. **Fuente:** [production-readiness.md](</Users/roberto/Downloads/UVH Link Manager/docs/production-readiness.md>).

Cerrar datos reales del prestador, proveedores/regiones, buzones y responsables, revisión externa de textos y procedimiento de derechos/incidentes. El código no sustituye esta aprobación.

## Qué ya existe y no debe aparecer como trabajo nuevo

Se revisaron guardas de workspace y mutaciones, idempotencia por tenant/arriendo, ledger CSV, artefactos v3 autenticados, autorización/step-up de exportación, outbox de correo, admisión DNS/TLS, SSRF para fetch de webhooks, tokens de acciones públicas y productores de dominios. Hay implementación sustancial en estas áreas; los hallazgos anteriores señalan huecos concretos y no afirman que todo el sistema esté mal.

Los destinos http/https que guarda un enlace no equivalen a un fetch del servidor; aceptar un destino local no demuestra por sí mismo SSRF. La métrica daily_pseudonyms está declarada y no debe confundirse con personas únicas entre días. Ni B07 ni B09 prueban que el backend permita leer otro tenant.

## Evidencia de la corrección — 01/10/2026

Resultados definitivos y comandos reproducibles: [runbook de correcciones](remediation-operations-2026-09-30.md). Logs locales en `.planning/2026-09-30-completion-audit-remediation/`. Las cifras de suites se actualizan después de terminar su ejecución; un job remoto no ejecutado no se declara verde.

## Lo que impide declarar producción finalizada

G02–G10 conservan sus requisitos externos. Falta ejecutar CI remoto en la cuenta real, validar DNS/correo/captcha definitivos, operación de backups y alertas recibidas, custodia/provenance, migración con datos representativos, accesibilidad manual y aprobación de datos legales. El código y los ensayos locales reducen riesgo; no sustituyen esta evidencia.

## Continuación de código — 01/10: invitaciones y auditoría de webhooks

| Hallazgo | Causa y corrección | Evidencia |
| --- | --- | --- |
| B28 — sesión desconocida presentada como cerrada | `AuthService.init` absorbe errores de transporte/5xx y deja `loaded=false`. Invitación ahora distingue ese estado, conserva el enlace pendiente y permite reintentar; sólo ofrece login tras comprobación anónima definitiva. | Regresión falló antes; recuperación autenticada y anónima probadas. Navegador con transporte simulado y posterior 401. |
| B29 — eventos exactos de webhook fuera del commit | Update, delete y resend podían responder OK pese a fallo de admisión de auditoría. Los tres eventos ahora se admiten dentro de la transacción; reenvío se encola después de commit. | Seis pruebas: fallo de admisión revierte las tres operaciones; fallo de historial conserva evento y drenaje idempotente. |
| B30 — carrera de sesión durante invitación | Una sesión nueva podía recibir un POST iniciado antes de terminar la confirmación del park; errores tardíos podían modificar el estado de la pantalla o esconder otra invitación. Se revalida contexto antes del POST y al manejar errores. | Cuatro regresiones fallaron antes y pasan después, para aceptar y rechazar. |

Se añadió acceso por teclado al formulario de cuenta usando foco, sin modificar fragmentos de credenciales. Suite actual: frontend 604, backend 860 (6558 aserciones), lint/tipos/build/Pint/PHPStan correctos. Los ensayos visuales cubren esta pantalla en escritorio y móvil, con capturas claro/oscuro; las respuestas de fallo de sesión del navegador son simuladas y se documentan como tales.

Queda revisar la admisión de eventos exactos en cambios de cuenta/MFA, además de los requisitos externos ya registrados. Esta continuación no certifica que todo el proyecto esté terminado ni libre de vulnerabilidades.

## Continuación de código — 01/10: MFA

| Hallazgo | Corrección | Evidencia actual |
| --- | --- | --- |
| B31 — seis mutaciones MFA confirmadas antes de auditoría exacta | Preparar, cancelar, activar, reconfigurar, regenerar códigos y desactivar ahora admiten el evento dentro de la transacción. Sin admisión no se confirman cambios, códigos nuevos, avisos ni callbacks. Historial indisponible mantiene recuperación durable. | 12 nuevas regresiones de admisión/historial; 22 pruebas en SecurityNoticeAtomicityTest. |
| B32 — MFA administrativa pide credenciales sin comprobar acceso | Estado desconocido y fallo de consulta MFA muestran error recuperable; formulario sólo tras requisitos comprobados. Envío y resultados ligados a generación validada. | 3 nuevas regresiones y navegador con transporte/status simulados; recuperación sin POST y móvil sin desbordamiento. |

Verificación después de estos cambios: backend **872** pruebas y **6678** aserciones; frontend **607** pruebas; lint, tipos, compilación, Pint398 y PHPStan correctos. Logs .uvh-runtime/mfa-*. Las capturas sólo acreditan las pantallas ensayadas, no una revisión visual universal.

Sigue pendiente revisar eventos exactos de revocación múltiple de sesiones y otras operaciones de cuenta, además de los requisitos externos anteriores. El objetivo global de calidad y seguridad continúa abierto.

## Continuación de código — 01/10: revocación y Ajustes

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B33 — revocar accesos con autorización obsoleta | Individual y masiva ahora revalidan usuario, sesión actora, revocación, caducidad y versión bajo bloqueo, antes de modificar destinos. Conservan el contrato de contención sin pedir un nuevo factor. | Nueve interleavings con snapshot autorizado previo; ocho fallaban antes. |
| B34 — revocación masiva sin evento exacto en el commit | Se admiten auth.sessions_revoked_others/all con su contador dentro de TX. Aviso durable y audit genérico ya existían; el hueco era el evento exacto. | Fallo selectivo de ese INSERT revierte sesiones/avisos; fallo de historial conserva evento recuperable una vez. |
| B35 — secretos y confirmaciones MFA de otra cuenta en Ajustes | Operaciones ligadas a cuenta/generación/vista, revalidación tras confirmación y esperas, limpieza reactiva de clave/URI/QR/códigos/contraseñas y descarte de avisos tardíos. Texto de desactivación reconoce códigos de recuperación. | Tres carreras reproducidas antes, cinco nuevas regresiones pasan; incluye limpieza por retirada de identidad y fallo de refresco tardío. |

Verificación actual del lote: **885** pruebas backend (**6760** aserciones), **612** frontend, Pint398/PHPStan0, lint/tipos/build y diff sin errores. Logs locales .uvh-runtime/sessions-* y settings-mfa-*. No se presenta este lote como una nueva pasada visual de navegador ni una ejecución nueva de release.

Pendientes: revalidación de sesión al cancelar configuración MFA y otras acciones de cuenta, eventos exactos de exportación y efectos tardíos restantes de Ajustes. El objetivo global sigue abierto.

## Continuación de código — 01/10: vigencia de MFA y Ajustes

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B36 — MFA continúa tras caducidad o snapshot obsoleto | Preparar/cancelar/activar/reconfigurar/regenerar/desactivar revalidan usuario y sesión actora bajo bloqueo, incluyendo expiración y versión del snapshot. Cancelar ya no modifica configuración con sesión cerrada. | 18 interleavings; 13 fallaban antes, todos pasan después. Estado de factor/códigos/sesiones y avisos permanece intacto cuando se rechaza. |
| B37 — efectos de Ajustes publicados en otra cuenta | Perfil, abrir workspace y revocar sesión ligan respuesta, rollback de navegación y avisos a cuenta/generación/vista. Perfil se reinicia al cambiar identidad. Autocierre actual permite su transición intencional al login; un login más reciente impide redirección vieja. | Tres fallos reproducidos antes, cinco regresiones nuevas después; incluye autocierre legítimo y respuesta tardía tras nuevo acceso. |

Verificación actual: **903** pruebas backend/**6904** aserciones, **617** frontend; Pint398/PHPStan0, lint, tipos, build y diff correctos. Evidencia local .uvh-runtime/mfa-session-* y settings-account-*. No se acredita una pasada visual nueva ni nuevas puertas release en este lote.

Pendientes: eventos exactos de exportación, revalidación de vigencia en otras operaciones de cuenta/recuperación, mensajes de conflicto específicos en activación MFA, revisión visual ampliada y requisitos externos previamente documentados. El objetivo global permanece abierto.

## Continuación de código — 01/10: exportaciones, MFA y accesibilidad

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B38 — exportaciones con autorización obsoleta | Solicitar, cancelar, preparar descarga y acusar recepción revalidan cuenta verificada/snapshot/sesión activa y caducidad bajo bloqueo. No modifican estado, códigos ni archivo con autorización inválida. | 12 interleavings; diez fallaban antes. |
| B39 — eventos de exportación fuera del commit | Requested/cancelled/served/downloaded se admiten en su transacción. Fallo revierte transición; cancelación/acuse preservan archivo. Historial indisponible mantiene recuperación durable e idempotente. | Cuatro fallos selectivos reproducidos antes; cuatro casos de recuperación, con actor/recurso correctos y ausencia de contraseña/códigos en evento. |
| B40 — sesión cambiada descrita como código MFA incorrecto | Activar/reconfigurar devuelve409 y mensaje de sesión cambiada;403 queda para configuración/código inválidos. | Seis interleavings verifican la distinción de respuesta. |
| B41 — acciones de filas ambiguas para lector de pantalla | Copiar, QR, editar y menú incluyen URL del enlace en su nombre accesible. | Revisión de plantilla, lint, tipos y compilación; pendiente prueba manual de lector de pantalla. |

Estado verificado final: **923** pruebas backend/**7006** aserciones, Pint398/PHPStan0, frontend lint/tipos/build y diff limpios. Logs .uvh-runtime/export-security-*-final.log y export-ui-build.log. No se presenta el resultado anterior de617frontend como una nueva ejecución ni se acredita nueva pasada visual/E2E.

La revalidación después de I/O de descarga ya comprobaba caducidad antes de esta continuación; se conserva. El step-up inicial consume el factor al autorizar: un fallo posterior sigue dejando la exportación reintentable, pero exige un factor válido para la siguiente descarga. Served acredita preparación; downloaded sigue siendo el acuse del navegador.

Corrección de referencia histórica: este árbol implementa requestExport en AccountController, no en un DataExportService. Pendientes: ciclo de borrado de cuenta y otros cambios/recuperación, revisión visual ampliada y requisitos externos anteriores. Objetivo global aún abierto.

## Continuación de código — 01/10: borrado de cuenta y recuperación de errores

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B42 — solicitud de borrado con sesión caducada o snapshot obsoleto | Revalida cuenta verificada, versión del actor, sesión activa y caducidad bajo bloqueo antes del step-up y de cualquier modificación. | Tres interleavings; caducidad y snapshot fallaban antes. |
| B43 — solicitud/confirmación de borrado sin evento exacto en su commit | Requested y scheduled se admiten en la transacción del estado y de los avisos. La reconciliación externa de intenciones conserva un evento posterior separado. | Dos fallos selectivos de admisión revierten estado, sesiones y correo. |
| B44 — cancelación protectora pierde su auditoría al fallar la admisión | Restauración y marcador durable comparten transacción; admisión aislada por savepoint. Housekeeping recupera hasta100 filas por pasada. No se reutiliza una solicitud mientras su registro siga pendiente. | Fallos PHP/SQL conservan la cuenta restaurada; fallo al limpiar marcador revierte admisión; recuperación repetida genera un único evento. Historial indisponible conserva outbox. |
| B45 — errores temporales eliminan el botón en enlaces de borrado | Cancelar/confirmar permiten reintento manual tras conexión fallida,429 o5xx, conservando el token sólo en memoria.400 permanece definitivo. | Seis regresiones fallaban antes; ocho nuevas pasan. Navegador simulado503→200 recupera cancelación en móvil;400 de confirmación no ofrece reintento. |

Verificación nueva: **932** pruebas backend/**7066** aserciones, **625** frontend; Pint401/PHPStan0, lint/tipos/build y diff limpios. La suite frontend inicial detectó un selector de prueba desactualizado tras añadir la URL al nombre accesible del menú; se actualizó manteniendo las aserciones de navegación y teclado. La suite final pasa completa.

La migración2026_10_01_000001 añade cancellation_audit_pending y está aplicada a uvh_local conservando sus datos y a uvh_test. Readiness comprueba la columna. Esta garantía cubre nuevas cancelaciones; no reconstruye eventos históricos que ya se hubieran perdido. Recuperación requiere housekeeping operativo. Inspección visual móvil390px: error y reintento visibles, sin overflow. Las respuestas de borrado del navegador fueron simuladas; no se borraron/restauraron cuentas reales. No nueva ejecución E2E/release en este lote.

Pendientes: ventanas de auditoría en cambios de identidad/recuperación y compensación/ejecución automática de borrado, revisión visual ampliada y requisitos externos del informe. El objetivo global sigue abierto.

## Continuación de código — 01/10: contraseña e identidad

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B46 — cambiar contraseña, solicitar/cancelar email con autorización obsoleta | Revalidan cuenta, versión del snapshot y sesión no revocada ni caducada bajo bloqueo antes de consumir el factor. | Nueve interleavings: los seis de caducidad/versión fallaban; revocación ya se rechazaba. Estado, sesiones y reserva permanecen intactos. |
| B47 — evento exacto de contraseña/email fuera del commit | Password change/reset y email requested/cancelled/confirmed admiten su evento en la transacción de negocio. Conservan metadatos del factor y de revocación sin secretos. | Fallo selectivo después del INSERT revierte la operación, factor de recuperación, sesiones, bearer y correo; cinco casos de historial caído se recuperan una sola vez. |
| B48 — confirmar email queda bloqueado tras un fallo temporal | Reintento manual para conexión fallida,429 y5xx;400 mantiene respuesta definitiva. Un fallo no publica cierre de sesión. Token sólo en memoria, URL saneada. | Tres regresiones fallaban antes, cuatro nuevas pasan. Navegador móvil con503→200 simulado e inspección de captura sin desbordamiento. |

La recuperación por email conserva sus límites: no se convierte en login ni permite saltarse MFA. No se limpia el contador TOTP consumido en cache por un fallo posterior de SQL; la protección frente a replay permanece. Para reintentar con TOTP puede ser necesario el siguiente código.

Pendientes del objetivo amplio: ciclo de recuperación con aprobación de soporte, revocación protectora de incidentes, auditoría de compensación/ejecución automática, otras superficies visuales y requisitos externos. No se acredita nueva ejecución E2E/release ni mutaciones reales mediante el navegador de este lote.

Verificación final de este lote: **951 pruebas backend /7220 aserciones** en194,95s, exclusivamente uvh_test; **629 frontend**. Pint401 archivos y PHPStan sin errores; lint, tipos, compilación y git diff --check correctos. Regresiones de avisos y seguridad:59 pruebas/524aserciones. Captura móvil390px inspeccionada; recuperación de confirmación de email con respuestas simuladas, sin cambiar ninguna identidad real. Logs identity-* en .uvh-runtime.
