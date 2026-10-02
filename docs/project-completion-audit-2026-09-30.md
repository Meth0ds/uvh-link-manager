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

## Continuación01/10 — recuperación y plan por sistemas

| Hallazgo/control | Cambio | Evidencia |
| --- | --- | --- |
| B49 — contraseña validada contra identidad anterior | Cambio autenticado y recuperación aprobada reevalúan PasswordStrength con nombre/email bloqueados antes de consumir factor, bearer o modificar credenciales. | Dos interleavings: cambio de nombre sin rotar versión;422 conserva factor/caso aprobado y sesión. Ambos fallaban antes. |
| B50 — recuperación pierde evento exacto tras el commit | auth.account_recovery_completed se admite junto con rotación de contraseña, retirada de MFA/admin, revocaciones, caso y aviso de seguridad. | Fallo selectivo revierte; historial indisponible conserva evento recuperable una sola vez, sin contraseña/código/bearer. |
| G11 — defensa explícita de cuenta bloqueada | Completion exige deleted_at nulo aun si la versión del caso coincidiera. | Fixture de versión coincidente rechazado y bearer invalidado. El bloqueo administrativo habitual ya rota versión y cancela casos: no se presenta este fixture como bypass demostrado de ese flujo. |

Verificación nueva:956 pruebas backend/7266 aserciones en255,10s, exclusivamenteuvh_test;69 pruebas específicas/671aserciones; red5casos4fallos/1correcto. Pint401 y PHPStan0 errores, diff limpio. Logs recovery-* en .uvh-runtime. Frontend no modificado en este lote;629frontend y navegador del lote anterior conservan su fecha/alcance y no se consideran reejecutados.

El usuario ha pedido revisión sistema por sistema y plan primero. [Plan maestro](superpowers/plans/2026-10-01-system-by-system-review.md) y [matriz por función](superpowers/plans/2026-10-01-system-review-coverage.md) crean13 bloques y un inventario de185 rutas reales (172 APIv1,25controladores). Filas inicialmente por revisar, aun con pruebas históricas. Incluir Jobs/comandos/helpers/frontend antes del cierre; no confundir contar rutas con auditar implementaciones.

S01 es el siguiente bloque. Medidor de contraseña de recuperación con cuatro criterios y política generada aún no conectada al bundle Angular: revisión pendiente, ningún cambio de medidor implementado antes del nuevo plan. Apertura/confirmación de recuperación, incidentes protectores y sesión distinta de propietario siguen pendientes. No se acredita cierre global ni nuevas pruebas productivas.

## S01 — política de contraseñas y presentación (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B51 — medidores califican positivamente claves rechazadas | Registro deja de mantener scoring paralelo y recuperación deja cuatro heurísticas simples. Ambos consumen la política generada desde PHP; los rechazos no superan la banda Débil. Feedback y aria-valuetext describen el estado. | Cuatro regresiones fallaban antes; nueve pruebas adicionales de presentación. Claves habituales, login y repeticiones dejan de mostrarse fuertes. |
| B52 — política/medidor acepta Unicode por encima del máximo en bytes | PasswordStrength y script generado aplican MAX_BYTES=72 además del mínimo en caracteres. Wrapper muestra rechazo y explicación sin detalles innecesarios; validaciones de endpoint ya imponían el máximo en bytes. | Caso de menos72 caracteres y más72 bytes fallaba en PHP y navegador; ahora ambos rechazan. No se presenta como truncamiento explotable demostrado de las rutas, que ya rechazaban esas entradas. |
| B53 — guard de política omite frontend en Docker | EmitPasswordPolicyTest resuelve checkout con RepositoryRoot y exige archivo/comparación. Ya no pasa silenciosamente cuando /app/../frontend no existe. | Guard falla con asset anterior, se regenera desde comando y pasa con comparación real del montaje /repo. |

Verificación final: **957 backend /7271 aserciones** (189,25s, uvh_test), **642 frontend**, Pint401/PHPStan0, lint/tipos/build y diff correctos. Política específica27/64aserciones. Red de medidores70casos4fallos/66correctos; Unicode PHP1fallo, wrapper9casos1fallo/8correctos; guard de drift1fallo antes de regenerar. Logs s01-password-* y s01-policy-drift-red.log.

Navegador: recuperación anónima con auth/me simulado, cero POST; rechazos/clave aceptable/Unicode, token scrubbed,390px sin overflow. Capturas móvil claro/oscuro y escritorio inspeccionadas. Primera captura tras cambio inmediato de viewport tenía un artefacto de captura; visita aislada confirmó un shell/header/footer, sin atribuirlo a bug del proyecto. El primer probe oscuro buscó button en lugar del role switch real y falló; selector corregido y comprobación completada. No nueva pasada universal E2E/release ni auditoría manual completa de accesibilidad.

S01 continúa en progreso. Matriz registra alcance parcial en register/reset/change/recovery y cuatro entradas no HTTP de política/emisión/presentación. No se acredita revisión completa de ninguna de esas rutas por haber corregido su validación; todavía deben cubrirse autorización, CAPTCHA, tokens, correos, sesiones y casos de error del flujo entero.

## S01 — admisión de login sin MFA (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B54 — éxito de login basado en credencial obsoleta | Tras comprobar contraseña fuera del lock, revalida cuenta/versión/hash/email/verificación y ausencia de MFA bajo bloqueo antes de crear sesión. Devuelve perfil actual. | Tres carreras iniciales fallaban; nueve casos finales cubren además cambios sin versión y perfil actualizado. Las versiones antiguas ya impedían usar después la sesión, pero antes la API publicaba éxito y creaba una fila inutilizable. No se describe como bypass de acceso probado. |
| B55 — sesión creada sin admisión del evento exacto | SessionManager::create y auth.login sin MFA comparten transacción. | Fallo selectivo después del INSERT revierte sesión/evento; historial caído conserva evento durable, materializado una sola vez al recuperar. |

Verificación nueva: **966 backend /7309 aserciones** en191,26s, uvh_test; Pint402/PHPStan0 y diff limpio. Log s01-login-full-backend.log. Baseline válido de cinco casos4fallos/1correcto; verde inicial13casos/93aserciones con AuthEmailTokenTest. Tres defensas adicionales y perfil fresco se cubren en suite completa final. Los primeros probes carecían de captchaToken y respondían422: se corrigió fixture y se repitió baseline con rama original temporalmente restaurada, sin atribuir esos422 al proyecto.

Frontend no modificado en este lote;642 y sus capturas pertenecen al lote anterior. Sin nueva pasada visual/E2E/release ni nueva migración. Matriz conserva login parcial: falta revisar admisión TOTP/recovery/challenge y sus límites cache/SQL/auditoría, además de autoridad de registro/reenvío/activación y avisos. S01 no está cerrado.

## S01 — admisión MFA (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B56 — TOTP concede sesión desde una cuenta desactualizada | Revalida cuenta activa, email verificado, MFA habilitado, secreto y generación bajo lock SQL antes de consumir factor/reto. | Cuatro interleavings reproducen cambios de generación, bloqueo, verificación y desactivación; todos rechazan sin consumir TOTP ni crear sesión. Una sesión de generación antigua ya era rechazada por hydrate; no se describe ese caso como bypass probado. |
| B57 — admisión MFA pierde eventos exactos después del commit | TOTP admite auth.login dentro de la transacción de sesión. Recuperación admite auth.mfa_recovery, low/exhausted y auth.login junto con consumo SQL del código y sesión. | Fallo selectivo revierte sesión/evento/código SQL; historial caído conserva evento exacto durable y se materializa una sola vez. Cache mantiene marcas de consumo tras rollback para impedir replay. |

Verde específico:55 pruebas/686 aserciones con ApiParityTest,15,20s, exclusivamenteuvh_test;12 regresiones nuevas. Baseline válido:8 fallos/4 correctos de estas12 regresiones. El log red inicial añadió un decimotercer caso con una expectativa incorrecta: exigía422 por whitespace que la ruta real normaliza antes de validar; ese supuesto fallo de salto de línea se retira y no recibe ID de bug. Primera ejecución green detectó esa discrepancia (1fallo/55correctos); después de retirar el caso, verde completo específico. Logs s01-mfa-login-red.log y s01-mfa-login-green-final.log.

Pint403/PHPStan0 errores en s01-mfa-login-static.log. Suite completa final:978/978 backend,7389 aserciones,167,00s, exclusivamenteuvh_test; s01-mfa-login-full-backend.log. Frontend sin cambios en este lote;no nueva verificación visual/E2E/release, migración o modificación de datos locales. S01 permanece abierto: challenge inicial, autoridad de registro/activación/reenvío y fallos dedicados de cache entre otros.

## S01 — activación por email (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B58 — activación pierde eventos exactos después del commit | acceptRegistrationLegal admite auth.email_verified, auth.terms_accepted y auth.privacy_notice_acknowledged dentro de las dos transacciones de activación. | Seis fallos selectivos reproducidos; rollback conserva registro/cuenta previa y bearer, sin workspace/evidencia legal/eventos parciales. Historial indisponible conserva cada evento y permite materializarlo una sola vez. |
| B59 — bearer heredado cambia una cuenta ya verificada | Bajo bloqueo SQL, la ruta user_id exige email_verified_at nulo antes de consumir token o cambiar nombre/contraseña/versión. | Fixture de token válido sin usar y cuenta verificada devolvía200/reemplazaba credencial; ahora400, todos los atributos intactos y token no consumido. Alcance: datos heredados/manuales con bearer residual; registro moderno elimina tokens por cascade al activar. No se afirma que registro moderno emita ese estado. |

Baseline13 casos:7fallos/6correctos (s01-activation-red.log). Verde con contratos de email y API:64/64,777aserciones,21,36s; exclusivamenteuvh_test (s01-activation-green.log). Pint404/PHPStan0:s01-activation-static.log. Suite completa final:991/991 backend,7489aserciones,178,45s; exclusivamenteuvh_test,s01-activation-full-backend.log. Frontend sin cambios;lectura VerifyEmailComponent confirma formulario/reintento manual y bearer retirado de URL, pero no se acredita nueva prueba visual ni E2E. S01 sigue abierto.

## S01 — registro y edición del email pendiente (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B60 — registro persiste sin admitir su evento exacto | Registro nuevo admite auth.register y avisos legales en TX con pendiente/token/mail_outbox; destino ocupado admite auth.register_duplicate junto con correo huérfano. | Cuatro fallos selectivos reproducidos, rollback sin pendiente/token/correo parcial. Historial caído mantiene eventos recuperables. |
| B61 — corrección de email persiste sin admitir su evento exacto | Movimiento y conflicto admiten el evento correspondiente bajo lock/TX con generación/bearer/correo. La excepción23505 conserva auditoría best effort del rechazo después del rollback, sin mutación comprometida. | Dos fallos selectivos reproducidos, rollback conserva email/generación/bearer previo. Destino libre y ocupado devuelven idéntico JSON500 y sin cookie de edición ante fallo global de admisión, con app.debug=false. |

Regresiones nuevas14. Baseline válido12:6fallos/6correctos;s01-registration-red-final.log. Los dos primeros red tenían errores de fixture: lectura de cookie con descifrado Laravel pese a sello propio, luego mail_outbox global sin truncar; corregidos y repetidos antes de modificar controller. Verde final65/65,775aserciones,18,38s (RegistrationAdmissionTest,ApiParityTest,AuthEmailTokenTest);uvh_test. Primer green2fallos/63correctos por comparar trazas locales de debug entre ramas; prueba de simetría ahora usa contrato productivo sin debug, no borra diferencias de JSON. Suite completa final1005/1005 backend,7587aserciones,169,01s;exclusivamenteuvh_test,s01-registration-full-backend.log. Pint405/PHPStan0:s01-registration-static.log.

Sin cambios frontend,migración,dato local,worker/scheduler,commit/push/deploy o nueva evidencia visual/E2E/release. Lectura RegistrationEdit/RegistrationEditTest/RegistrationEditConcurrencyTest: binding pid/generación,expiración,sello,tamper,decoy y revalidación bajo lock. Suite completa incluye carrera real de dos workers;no se acredita por ella todos los interleavings de activación/reenvío. S01 continúa abierto.

## S01 — entrega de verificación (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B62 — reenvío legacy se encola pero nunca se entrega | MailDeliveryEligibility::emailToken admite verify con registro pendiente vivo o cuenta heredada activa y aún sin verificar. Mantiene kind,hash/generación,vigencia y consumo. | Job real marcaba obsolete la admisión user_id;ahora llega al transporte ArrayTransport y su enlace activa la misma cuenta. Control pending también entrega y activa;el job duplicado no repite envío. |

17 regresiones nuevas. Baseline16:1fallo/15correctos,s01-verification-delivery-red.log. Verde inicial con AuthEmailTokenTest/ApiParityTest/MailTransportTest71/71,781aserciones,21,22s;s01-verification-delivery-green.log. Después se añadió control huérfano y recuperación tras caída de SQL;cubiertos por full1022/1022,7687aserciones,218,60s,exclusivamenteuvh_test;s01-verification-delivery-full-backend.log. Estados rechazados:usado,caducado,owner eliminado,kind/generación distintos,legacy verificado/bloqueado. Caída de consulta guarda envelope y programa retry sin enviar;al recuperar SQL termina sent. Transporte real de Laravel con ArrayTransport,sin contactar proveedor ni buzón real.

Composerquality inicial termina con timeout300s en Pint(s01-verification-delivery-static.log);PHPStan no llegó a ejecutarse. Reejecución con controles sin modificar termina correcta:Pint406/PHPStan0,s01-verification-delivery-static-final.log. Sin cambios frontend/migración/datos locales/workers/scheduler/commit/push/deploy/nueva prueba visual/E2E/release. S01 continúa abierto.

## S01 — reto inicial MFA (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B63 — reto MFA se emite desde credencial/estado obsoleto | Login sin MFA y con MFA revalidan cuenta activa/verificada,generación,hash,email y modalidad MFA bajo el mismo lock SQL. recoveryAvailable se calcula del registro bloqueado. | Seis carreras antes de lock devolvían200/challenge;ahora401 sin evento/reto. Cambio de recovery_codes sin versión ya no publica disponibilidad anterior. Un challenge por sí solo no autentica;no se presenta como bypass completo demostrado. |
| B64 — reto publicado sin admisión exacta | auth.mfa_challenge_issued se admite en TX antes de guardar reto en cache. Cache fallido revierte evento;fallo de TX intenta retirar secreto que nunca se publicó. | Fallo selectivo de admisión ya no responde200/challenge;historial caído conserva evento durable con secreto fuera del evento. Cache falla antes/después de escribir:503,sin sesión/evento/reto publicado;limpieza después de escritura parcial en prueba. Cache y SQL no constituyen transacción distribuida:si cleanup falla,el secreto no publicado queda acotado por TTL. |

11 regresiones nuevas. Baseline10:8fallos/2correctos;s01-challenge-red.log. Verde inicial con LoginAdmissionTest/MfaLoginAdmissionTest/ApiParityTest74/74,776aserciones,19,88s;s01-challenge-green.log. Después se añadió variante cache-after-write;el primer full1032correctos/1fallo detectó un doble de cache que escribía y borraba en repositorios distintos. Ajuste de fixture verifica llamada forget/clave y usa el mismo repository. Primer intento del matcher capturó writtenKey por valor,corregido a referencia. Verde final32/32,179aserciones,s01-challenge-green-final-valid.log. Full final1033/1033 backend,7748aserciones,165,01s;exclusivamenteuvh_test,s01-challenge-full-backend-final.log. Pint407/PHPStan0:s01-challenge-static-final.log. Frontend sin cambios,nueva migración/dato local/worker/scheduler/commit/push/deploy/prueba visual/E2Erelease. S01 continúa abierto.

## S01 — reautenticación y perfil (01/10)

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| B65 — reautenticación consume factor desde sesión caducada/snapshot obsoleto | Bajo lock exige sesión vigente,versión de sesión/cuenta y versión del actor precargado coincidentes antes de MfaStepUp. | Dos casos antes aceptados consumían recovery y refrescaban ventana;ahora409,cuenta/sesión/código intactos. Una sesión expirada seguía siendo rechazada después por hydrate;no se presenta como acceso posterior demostrado. |
| B66 — reautenticación/perfil pierden evento exacto tras commit | auth.mfa_reauthenticated y auth.profile_update se admiten en TX con ventana/recovery_codes o nombre. | Dos pérdidas de admisión reproducidas;fallo revierte SQL,historial caído conserva evento materializable una vez. TOTP consumido permanece marcado tras rollback,evitando replay;recovery SQL se restaura. |
| B67 — perfil usa actor obsoleto o sin verificación | Bajo lock exige email verificado y generación del actor actual además de session/version/expiry existentes. | Dos controles que antes actualizaban nombre ahora409,estado intacto. Remoción de verificación es fixture defensivo;no afirmar que un flujo público normal la produzca ni que un cliente pueda modificar esa columna. |

18 regresiones nuevas. Baseline válido16:6fallos/10correctos;s01-reauth-profile-red-valid.log. Primer probe perfil usóPOST en rutaPATCH,respondió404 y se corrigió antes de modificar código;no se cuenta como bug. Verde inicial con suites de step-up/avisos87/87,691aserciones,29,46s;s01-reauth-profile-green.log. Dos pruebas TOTP añadidas:verde final18/18,106aserciones,4,94s;s01-reauth-profile-green-final.log. Fallos de actor:revocada,bloqueada,no verificada,caducada,generación actualizada,session de otra cuenta;se verifica estado SQL y ausencia de eventos. Full final1051/1051 backend,7854aserciones,189,58s;exclusivamenteuvh_test,s01-reauth-profile-full-backend.log. Pint408/PHPStan0:s01-reauth-profile-static.log.

Frontend sin cambios:lectura de manejo de error en mfa-reauthenticate.component y AuthService;no nueva prueba visual/E2Erelease. Sin migración,dato local,worker/scheduler,commit/push/deploy. S01 continúa abierto,quedan lectores/sesiones/incidentes/recuperación restantes y validación UI.


## S01 — lecturas de cuenta, sesiones y cierre (01/10)

La revisión sigue las cuatro acciones GET de AuthController hasta UvhRequest, el modelo de sesión, SessionManager y las vistas de ajustes/seguridad. Las reproducciones de contexto obsoleto invocan el controlador con el snapshot autorizado antes de invalidar SQL: demuestran una carrera tras middleware, no una forma de autenticar una cuenta ajena.

| Hallazgo | Corrección | Evidencia y límite |
| --- | --- | --- |
| B68 — P2 — lectores publican datos desde un contexto invalidado | me, sessions, securityCenter y mfaSessionStatus revalidan owner, cuenta activa/verificada, generación, revocación y caducidad al comenzar la lectura. | 32 casos: cuatro acciones por ocho estados; ahora 401 uniforme, sin datos ni Set-Cookie. La eliminación física de la cuenta ya no provoca ModelNotFound/500 en me/securityCenter. No borrar cookie en este rechazo evita que una respuesta GET antigua borre la de un login posterior. |
| B69 — P2 — fecha MFA tomada del snapshot del middleware | Las dos consultas de seguridad usan mfa_verified_at de la sesión SQL actual. | Dos casos con snapshot de una hora antes y SQL recién reautenticado: fecha actual y fresh=true. Se mantiene el formato ISO público con milisegundos. |
| B70 — P2 — lista acotada puede omitir «Este dispositivo» y promete mostrar el resto tras revocar | Sesión actual primero; otras ordenadas por actividad e ID. Una fila extra determina truncated; máximo público 100. Copy describe ese límite sin prometer que revocar registros conservados descubra el historial omitido. | Volúmenes de 1, 100 y 106 sesiones, con otra cuenta excluida: una sola current, límite/truncated y orden estable. No se añade paginación ni se interpreta la lista como todo el historial. |
| B71 — P2 — cuenta bloqueada entre SELECT de sesión y carga del owner | hydrate comprueba deleted_at también en el owner obtenido mediante la segunda consulta. | Interleaving confirmado mediante QueryExecuted: antes devolvía el usuario bloqueado; ahora null. El guard inicial whereHas permanece. No se afirma que toda lectura posterior sea un snapshot serializable ni que se cancelen peticiones ya autorizadas. |
| B72 — P3 — sesión aceptada en el instante exacto de expiración | hydrate rechaza expires_at <= now, consistente con los lectores y los guards de mutación. | Reloj congelado: pasado y frontera rechazados, futuro aceptado. La ventana demostrada es la igualdad exacta, no una extensión de minutos del TTL. |

45 regresiones nuevas: AccountReadContextTest (38) y SessionHydrationBoundaryTest (7). Baseline de lectores: 36 fallos/2 correctos; s01-account-read-red.log. Dos intentos verdes detectaron una expectativa de fecha incorrecta (+00:00 y después seis decimales frente al contrato Z de tres); se corrigió la prueba, sin cambiar el formato productivo ni contabilizar otro bug. Verde válido 92/92, 817 aserciones; s01-account-read-green-final-valid.log. Baseline de hydrate/logout: 2 fallos/5 correctos; s01-session-boundary-red.log. Verde conjunto final: 99/99, 850 aserciones, 27,86 s; s01-read-session-green.log. SQL destructivo exclusivamente en uvh_test.

Logout conserva su política protectora sin modificar producción: ante fallo de admisión exacta, revoca y borra cookie aunque el evento no pueda conservarse; ante fallo sólo del historial, conserva outbox y lo materializa una vez después. Se comprueba además logout anónimo idempotente. Estas decisiones no equiparan el cierre protector con las mutaciones que deben revertir si no admiten su evento.

Frontend: lint, typecheck y build ejecutados con salida 0; 642/642 pruebas ChromeHeadless en s01-account-read-frontend-tests.log. Sólo cambia el texto de la lista: sin nueva inspección visual ni E2E/release. Suite completa final: 1096/1096 backend, 8014 aserciones, 208,24 s; s01-read-session-full-backend.log, exclusivamente uvh_test. Calidad: Pint 410 archivos y PHPStan sin errores; s01-read-session-static.log. git diff --check correcto. No hay migración ni cambios de datos locales. S01 permanece abierto.


## S01 — apertura y confirmación de recuperación (01/10)

Revisión de código: requestAccountRecovery, confirmAccountRecovery, sus tokens y locks, UvhMail, MailDeliveryEligibility y los componentes públicos de recuperación. La misma comprobación de caducidad se sigue hasta completeAccountRecovery y su dependencia administrativa decideAccountRecovery; esta lectura parcial no cierra S11.

| Hallazgo | Corrección | Evidencia y límite |
| --- | --- | --- |
| B73 — P2 — solicitud/reenvío de expediente persiste sin admitir su evento exacto | auth.account_recovery_requested comparte TX con expediente, rotación de bearer y mail_outbox. AccountRecoveryAdmissionException distingue el fallo de auditoría en esta solicitud pública; tras rollback devuelve el mismo 202 genérico. | Fallos selectivos en solicitud nueva y reenvío: no queda caso/correo parcial ni se publica job; reenvío conserva el bearer anterior. Se compara JSON de cuenta elegible/desconocida ante caída de auditoría. Es uniformidad de respuesta, no una demostración de tiempos constantes ni de todos los fallos SQL posibles. |
| B74 — P2 — confirmación consume token antes de admitir su evento exacto | auth.account_recovery_email_confirmed se admite dentro de la TX que consume el bearer y abre el expediente. | Caída de admisión devuelve error 5xx y deja el mismo token/estado disponibles para reintento. Caída sólo del historial permite operación y conserva outbox materializable una vez. Confirmar prueba email, no crea sesión ni cambia contraseña/MFA. |
| B75 — P3 — recuperación acepta el instante exacto de caducidad | El expediente y los bearers de confirmación/finalización exigen fecha > now. Solicitud retira casos ya vencidos; decisión administrativa rechaza el caso vencido. | Pasado/frontera/futuro con reloj congelado en apertura, confirmación, finalización y decisión. La finalización inválida no cambia credenciales ni revoca sesiones. Alcance demostrado: igualdad exacta de la fecha, no una prolongación amplia del TTL. |
| B76 — P2 — error temporal deja la confirmación sin acción de reintento | La pantalla conserva la acción para conexión fallida,429 y5xx; un 400 definitivo sigue sin repetir el bearer. | Cinco regresiones temporales más un control definitivo. Reintento manual, sin POST al render y con LatestRequest/destrucción preservados. |
| B77 — P3 — actor administrativo acepta el instante exacto de expiración de sesión | eligibleLockedAdminSession rechaza expires_at <= now antes de mutar. | Contexto preautorizado con sesión en pasado/frontera/futuro: vencida devuelve409 sin aprobación ni cambio del expediente. El middleware ya rechaza sesiones vencidas al entrar; se verifica el guard de la mutación, no se presenta como bypass remoto demostrado. Otros llamadores del helper requieren su revisión S11. |
| B78 — P2 — foco de teclado se pierde al desactivar/retirar la acción | Tras render, si la acción tenía foco y éste quedó en body, lo devuelve a Reintentar o a Volver al acceso. Respeta una elección posterior de otro control y una vista destruida. | Fallo observado en Chrome real al intentar reintentar. Tres controles de foco y recorrido teclado en navegador con503→éxito simulado a390/1440px, claro/oscuro. No se atribuye a una vulnerabilidad de autenticación. |

32 regresiones backend nuevas: RecoveryOpeningAdmissionTest (20) y RecoveryDeadlineTest (12). Baseline válido de apertura: 7 fallos/13 correctos,125 aserciones; s01-recovery-opening-red-final-valid.log. Los primeros intentos tenían fixtures incorrectos: User recién creado frente a datos recargados de SQL, y fechas de un expediente ignoradas por mass assignment. Se corrigieron antes de aceptar el baseline; se restauraron sólo los dos métodos originales durante esa reproducción y se conservó el resto del árbol. Verde apertura/contratos:130/130,1350 aserciones. Baseline deadlines:4 fallos/8 correctos,52 aserciones; s01-recovery-deadline-red.log. Verde conjunto final:152/152,1569 aserciones,39,99s; s01-recovery-green-final.log. Pruebas destructivas exclusivamente uvh_test, Queue fake y sin entrega real de correo.

Frontend: nueve regresiones nuevas. Primer red temporal:5 fallos/34 correctos; s01-recovery-confirm-ui-red.log. Red foco:1 fallo/41 correctos, además de fallo real de navegador. La primera implementación de foco consultaba el componente Material en vez del ElementRef; se corrigió la lectura y la sobrecarga genérica de Angular22 antes de verificar. Esos intentos fallidos siguen registrados; no se contabilizan como hallazgos adicionales. Verde dedicado:42/42, s01-recovery-confirm-focus-green-valid.log. Ejecución final completa:651/651 frontend, lint/tipos/build correctos, salida0 del terminal83017. Registro resumido, explícitamente no log bruto: s01-recovery-frontend-verification-summary.json.

Navegador: agent-browser confirma enlace ausente sin acción. Para la secuencia de error/éxito se usa el fallback Playwright con interceptación de todas las rutas API, por la limitación de mocks CLI documentada en lotes anteriores. Un intento del harness omitía el GET legítimo pending; se añadió su respuesta simulada, sin cambiar producción. Resultado final:4 contextos independientes y8 POST interceptados, ningún POST llega al backend real; s01-recovery-confirm-browser-final-complete.log. Capturas retry390/1440 claro/oscuro y éxito móvil inspeccionadas: sin corte horizontal, texto legible y foco visible. Esta evidencia de UI no equivale a un ensayo E2E del backend o proveedor.

Suite backend completa:1128/1128,8235 aserciones,216,34s; s01-recovery-full-backend.log. Pint413 archivos/PHPStan sin errores; s01-recovery-static.log. git diff --check correcto. No hay migración, cambio de datos locales, worker/scheduler, commit/push/deploy ni release E2E nuevo. S01 sigue en curso; quedan MFA/incidentes, controles de apertura/confirmación restantes y pantallas antes de cerrar el sistema.


## S01 — decisiones de recuperación y contrato de solicitud (01/10)

Se ha revisado código de decideAccountRecovery/accountRecoveries, el recuento bajo lock de completeAccountRecovery, la solicitud pública Angular y la elegibilidad del correo. Las pruebas reproducen los estados observados antes de corregirlos; no sustituyen la revisión de funciones pendientes de S01/S11/S10.

| Hallazgo | Corrección | Evidencia y límite |
| --- | --- | --- |
| B79 — P2 — decisión administrativa confirma cambios antes de admitir su evento | admin.account_recovery_decision se admite en la TX de primera aprobación, aprobación final, rechazo e invalidación de expediente obsoleto. | Cuatro fallos selectivos revierten expediente, aprobaciones, notificaciones y correo; no publican job. Caída sólo de historial conserva el evento y lo materializa una vez al drenar. El rechazo stale ahora también conserva evidencia exacta. |
| B80 — P2 — revisión acepta una cuenta bloqueada con generación coincidente | El target bloqueado se rechaza bajo lock y su expediente se invalida, sin aprobación ni correo nuevo. | Aprobar/rechazar antes daban200 en fixture de cuenta bloqueada; ahora409. Bloqueo sin rotación representa estado legacy/manual: el flujo normal rota versión. No se afirma recuperación posterior de una cuenta bloqueada: complete ya la rechazaba. |
| B81 — P2 — aprobación propia persistida cuenta como control independiente | Se excluye al propietario al aprobar, al finalizar y al mostrar el recuento administrativo. | Una fila propia y un administrador externo antes permitían aprobar/finalizar; ahora quedan en revisión. Propietario más dos administradores externos sigue siendo válido. Listado pasa de2 a1. El endpoint ya prohibía crear la propia aprobación; fixture legacy/manual permitido por la tabla, sin atribuir exploit público. |
| B82 — P2 — solicitud pública anuncia aceptación ante respuesta inválida | AccountRecoveryRequestComponent usa decodePublicActionMessage y el pipeline de errores sanitizados de ApiService. | Null,HTML,ok=false y mensaje ausente/no textual ya no activan sent. Muestra error genérico sin contenido upstream, limpia CAPTCHA y permite reintento deliberado con un CAPTCHA nuevo. Se conserva respuesta genérica válida sin autenticar ni revelar existencia de cuenta. |
| B83 — P3 — correo de recuperación elegible sin MFA actual | Elegibilidad de confirmación y finalización exige también MFA vigente, además de estado/token/versión/fechas/cuenta activa y verificada. | Dos envíos indebidos reproducidos con generación coincidente. Ahora obsolete y envelope borrado, sin transporte. Estados legacy/manual; los flujos normales rotan versión. No equivale a demostrar acceso sin MFA. |

Baselines: decisión9 fallos/10 correctos,79 aserciones (s01-recovery-decision-red.log); listado1 fallo/2 aserciones (s01-recovery-list-red.log); correo2 fallos/10 correctos,40 aserciones (s01-recovery-mail-red.log); frontend6 fallos/1 correcto (s01-recovery-request-contract-red.log). Tras las correcciones:20 controles de RecoveryDecisionAdmissionTest,12 de RecoveryMailDeliveryTest y7 frontend nuevos. Verde específico final83/83,650 aserciones,17,70s (s01-recovery-decision-green-final.log). Correo usa job real con ArrayTransport y Queue::fake: ningún proveedor ni entrega de red.

Frontend final658/658, lint/typecheck/build exit0 (s01-recovery-decision-frontend.log); 7/7 del contrato (s01-recovery-request-contract-green.log). Sin cambios de layout ni nueva prueba visual/E2E. Suite completa: 1160/1160 backend, 8412 aserciones, 210,00 s, exclusivamente uvh_test (s01-recovery-decision-full-backend.log). Calidad: Pint 415 archivos y PHPStan sin errores, exit0 (s01-recovery-decision-static.log). S01 permanece abierto; S11/S10 sólo revisados aquí como dependencias. No migración, cambio de datos locales, worker/scheduler, commit/push/deploy.


## S01 — configuración MFA y reautenticación del panel (01–02/10)

Revisión de código de los seis mutadores MFA, lockActiveSecurityActor, MfaStepUp, MfaAttempts, consumeTotpCode, los casts de User, AuthService, SettingsComponent, interceptor, AppComponent y MfaReauthenticateComponent. Se han seguido tanto las comprobaciones del backend como la navegación que debe permitir completar una operación con ventana caducada. Este lote no cierra el resto de S01.

| Hallazgo | Corrección | Evidencia y límite |
| --- | --- | --- |
| B84 — P2 — preparar MFA permite renovar el presupuesto cambiando de sesión | mfaSetup usa MfaStepUp y el propósito mfa-setup: 10 fallos/15 min y límite global 20 por cuenta; incluye contraseña y factor, replay y consumo recovery en TX. | Primera configuración y reemplazo con contraseña/factor incorrectos agotan presupuesto a través de sesiones distintas; otro presupuesto global agotado también responde429. Los límites de middleware por sesión permanecen. Una caída de store falla cerrada y no admite secreto ni mutación. |
| B85 — P2 — activación no carga ni respeta el presupuesto por cuenta | mfaEnable aplica MfaAttempts antes de probar el pendiente/código, carga fallos y limpia su presupuesto tras una activación válida admitida en TX. | Diez códigos incorrectos repartidos entre sesiones bloquean incluso un código correcto nuevo; no entrega recoveryCodes ni cambia cuenta. También rechaza presupuesto global agotado. No se atribuye acceso conseguido por brute force: se reprodujo la ampliación del presupuesto. |
| B86 — P2 — seis mutadores usan una cuenta cuyo email dejó de estar verificado | Los llamadores MFA solicitan el guard de email verificado bajo lock; dueño, generación y sesión vigente siguen siendo obligatorios. | Seis snapshots previamente autorizados antes daban200; ahora409, sin consumo/cambio de estado, avisos ni jobs. Estado manual/legacy, sin demostrar que un endpoint público quite la verificación. El guard es optativo en el helper compartido: tres controles prueban que revocación individual, otras sesiones y todas siguen disponibles como protección. |
| B87 — P3 — pendiente MFA válido en el instante exacto de caducidad | mfaEnable rechaza mfa_pending_expires_at <= now. | Primer alta y reemplazo, antes/frontera/después: dos fallos de igualdad corregidos; rechazo conserva estado y no consume el contador TOTP. TTL permanece diez minutos. |
| B88 — P2 — cancelación/desactivación se presentan como éxito con respuesta inválida | AuthService exige decodeMfaAcknowledgement con ok booleano true; mantiene guard de generación antes de publicar resultado. | Diez respuestas null/HTML/objeto vacío/ok=false/ok textual rechazadas mediante el ApiService real. Dos controles de UI mantienen secreto/QR/estado cuando no hay confirmación, sin toast de éxito ni refresh engañoso. Respuesta válida y respuestas tardías tras reemplazar sesión siguen cubiertas. |
| B89 — P2 — preparar reemplazo se salta la ventana fresca y permite preguntar por la contraseña | Preparación con factor activo aplica MfaStepUp con ventana fresca y respuesta mfa_reauthentication_required antes de comprobar credenciales. | Sesión aparcada recibe el mismo403 con contraseña correcta e incorrecta; no consume recovery ni carga presupuesto. Primera configuración sin MFA activo sigue siendo password-only. La comprobación reciente de reemplazo refresca la ventana, conserva factor activo hasta activar el pendiente y consume recovery una vez. |
| B90 — P2 — remedio de MFA sólo navega desde administración | AppComponent abre reautenticación desde rutas del panel para sesión autenticada y conserva returnTo local. | Baseline: ajustes/enlaces no redirigían y una bandera antigua podía redirigir admin sin sesión. Tres fallos corregidos; no secuestra páginas públicas ni revive sesión anónima. Interceptor prueba POST setup, señal de remedio y ausencia de invalidación de sesión. |
| B91 — P2 — la propia pantalla de remedio rechaza cuentas sin rol admin | Reautenticación general permite cuenta autenticada con MFA; sólo destinos administrativos exigen además isAdmin. Copy, icono y CTA distinguen seguridad general de administración. | Cuenta no-admin con MFA ahora puede verificar y volver a ajustes; destino admin y cuenta sin MFA siguen rechazados. En navegador se completó ajustes→rechazo simulado→reauth→éxito simulado→misma sección. Los guards de roles del backend no se modifican. |

G12 — Calidad de análisis: se declara el campo JSON recovery_codes con arrays y posible escalar legacy, conservando is_array/is_string defensivos. Los tipos de códigos restantes en MfaStepUp reflejan entradas opacas conservadas. Se eliminan 15 entradas obsoletas del baseline; no se añaden supresiones ni se desactiva el control de patrones no coincidentes. El helper recoveryCodeIndex permanece, usado por login recovery. El primer quality dio7 avisos y la primera precisión de tipos11; el análisis definitivo queda sin errores.

Baselines previos a correcciones: backend18 casos,14 fallos/4 correctos,65 aserciones (s01-mfa-configuration-red.log); ventana fresca2 fallos/3 aserciones (s01-mfa-setup-freshness-red.log); respuestas frontend10 fallos/4 correctos (s01-mfa-response-red.log); navegación3 fallos/4 correctos (s01-mfa-reauth-navigation-red-complete.log); pantalla no-admin1 fallo/5 correctos (s01-mfa-regular-reauth-red.log). Se añaden29 controles backend y26 frontend; no se contabilizan fallos de fixture como bugs.

Verde específico148/148,1428 aserciones,35,54s (s01-mfa-configuration-green-complete.log). Suite final1189/1189 backend,8604 aserciones,179,00s, exclusivamente uvh_test (s01-mfa-configuration-full-backend-final.log). Pint416 archivos y PHPStan sin errores, exit0 (s01-mfa-configuration-static-final.log). Frontend final684/684, lint/typecheck/build exit0 (s01-mfa-configuration-frontend-final-verified.log). Browser4 contextos390/1440, claro/oscuro,8 POST simulados sin API real, retorno a la misma sección, sin desbordamiento ni errores de página; capturas móvil oscuro/escritorio claro inspeccionadas tras corregir el CTA (s01-mfa-reauth-browser-final.log).

Browser Playwright como fallback: la CLI agent-browser sólo permite cuerpo/abort en sus mocks y este recorrido necesita un403 condicionado y200 posterior. Cuatro contextos390/1440, claro/oscuro; todos los GET/POST interceptados, sin cuenta real, entrega de correo o petición de mutación al backend. Se conserva evidencia de respuestas simuladas separada de los tests backend. No migración, dato local, worker/scheduler, commit/push/deploy ni nueva suite E2E/release. S01 continúa abierto: incidente, helpers y gates UI/contratos restantes según matriz; S02–S13 conservan su alcance.


## S01 — control de incidente (02/10)

B92 — P2: el bearer de la cuenta A borraba la cookie y la identidad local de B. El backend sólo emite clearCookie cuando la identidad hidratada corresponde al dueño revocado; devuelve current booleano. La SPA valida ese campo antes de reconciliar la generación de sesión. Anónimo y cuenta ajena conservan su contexto. No se devuelve el identificador del dueño.

B93 — P3: expires_at == now seguía aceptando el bearer. Se usa caducidad exclusiva bajo lock, coherente con la elegibilidad del correo. Antes/frontera/después, kind incorrecto, formato inválido y replay cubiertos.

B94 — P2: un error transitorio convertía la pantalla en terminal y retiraba la acción. Se conserva reintento manual para conexión/429/5xx y respuestas inválidas. Confirmación exige ok=true, message válido y current booleano; nunca transforma un cuerpo incompleto en éxito. Foco vuelve al botón tras error y al enlace de recuperación tras éxito, sin interceptar una elección posterior del usuario.

Baselines válidos: backend4 fallos/4 correctos,32 aserciones (s01-incident-red-cookie.log); frontend7 fallos/6 correctos (s01-incident-frontend-red.log). El primer intento de fixture usó freezeTime con argumento Carbon y falló antes de ejecutar aserciones: corregido con travelTo; no se cuenta como defecto del producto. Se añaden15 pruebas backend y15 frontend. Control específico inicial109/956; ampliación15/108; frontend dedicado55/55 antes de añadir dos controles de doble envío y respuesta tardía.

La lectura siguió UvhSession, SessionManager, bearer, revocación SQL, cancelación de recuperación/eliminación/exports, PrivateArtifactCleanup, LinkIntentRegistry y Audit. Auditoría deliberadamente posterior al commit: su fallo de admisión no debe restaurar accesos comprometidos. Historial caído conserva el evento durable y drain repetido produce uno solo. Un fallo en la revocación SQL revierte la transacción y deja el bearer disponible; otro intento explícito funciona. Los tests preservan email, contraseña y factor activo, cancelan sólo pendientes del dueño, invalidan otros bearers de incidente del mismo dueño y retiran el artifact mediante Storage fake. Incidente no autentica ni desbloquea cuentas bloqueadas/ya eliminadas; sí cancela una eliminación aún programada.

Browser4 contextos390/1440 claro/oscuro;8 POST simulados,503→reintento manual→200. Todos los API interceptados, URL sin bearer, sin desbordamiento/error de página; foco de teclado comprobado y capturas390 oscuro/1440 claro inspeccionadas (s01-incident-browser.log). Playwright fallback para statuses condicionados que la CLI no simula. Sin mutación de cuenta real, entrega real, worker/scheduler, migración, commit/push/deploy o gate E2E/release.

S01 permanece parcial; faltan contratos/UI/helpers restantes de identidad y la evidencia de cierre según matriz. Próximo bloque: verificación/reset/cambio de email, incluidos los isPast restantes como candidatos de frontera todavía sin reproducir. S02–S13 conservan alcance completo.


Verificación final del lote de incidente:1204/1204 backend,8712 aserciones,183,75s (s01-incident-full-backend.log,exit0); Pint417 archivos/PHPStan sin errores (s01-incident-static.log,exit0).699/699 frontend y lint/typecheck/build exit0 tras el último ajuste de copy (s01-incident-full-frontend-final.log).Browser4 contextos,8 POST simulados, foco tras503/200, sin desbordamiento/error de página (s01-incident-browser-final.log,exit0); capturas390 oscuro/1440 claro inspeccionadas en el estado definitivo. git diff --check correcto. S01 sigue abierto; pruebas verdes de este lote no cierran la revisión de otras funciones ni los sistemas S02–S13.


## S01 — acciones de email, contexto de navegación y optimización (02/10)

| Hallazgo | Corrección y evidencia |
| --- | --- |
| B95 — P3 — igualdad de caducidad acepta activación pending/legacy, reset y confirmación email | Cuatro ramas usan expires_at <= now bajo lock;12 casos antes/frontera/después y replay. Rechazo conserva usuario/pending y no genera avisos/eventos. |
| B96 — P2 — confirmar email de A borra la sesión del navegador B | current booleano refleja dueño frente a identidad hidratada; sólo clearCookie del dueño. Cuenta ajena conserva sesión utilizable. UI sólo reconcilia si current true y misma generación. |
| B97 — P2 — reset del propio usuario deja identidad local/cookie obsoletas | Reset declara current, retira cookie propia y SPA reconcilia; anónimo/otra cuenta conservan contexto. Respuesta tardía tras destrucción reconcilia únicamente la identidad afectada. |
| B98 — P2 — tres pantallas declaran éxito con cualquier HTTP2xx | Decoders compartidos exigen ok=true y, para reset/cambio, current booleano. ApiService real convierte cuerpo inválido en502 sin exponerlo;15 cuerpos malformados y casos de current ausente/textual. |
| B99 — P3 — enlace rechazado por backend sigue pidiendo credenciales y reenvíos | Activación y reset retiran formulario tras400 y ofrecen Solicitar otro enlace;422 conserva corrección del formulario y errores temporales permiten reintento manual. |
| B100 — P2 — una segunda navegación conserva bearer/estado de la primera | Política de reuse renueva11 rutas auth con autoridad capturada y alias canónico de invitación.13 regresiones de router:12 fallaban antes; formulario forgot-password sigue reutilizándose. DestroyRef/LatestRequest existentes invalidan UI/tareas anteriores. Browser reproduce abrir otro enlace tras éxito y usa el nuevo bearer en lugar de mantener la pantalla del primero. |
| B101 — P3 — ayuda larga solapada con el siguiente campo en móvil | Material subscriptSizing=dynamic en activación/reset y copy de nombre simplificado; captura390oscuro mostraba solapamiento, captura definitiva ya no. Comprobación geométrica de hints contra campo siguiente en12 recorridos. |

O01 — Optimización: credentialChangeResponse centraliza una regla de privacidad/cookie y formato para incidente/reset/cambio de email, sin consultas adicionales; evita tres implementaciones divergentes. Decoders ack/current compartidos entre consumidores reales. O02 — Política de navegación central evita suscripciones/reset manual repetidos en cada pantalla con snapshot; los formularios normales conservan la política base. No se afirma ganancia de velocidad sin medición. El usuario pidió explícitamente incorporar optimización a todos los sistemas: el plan maestro se amplía sin reducir seguridad/diseño/alcance.

Baselines:18backend10fallos/8correctos,55aserciones (s01-email-actions-red.log);31frontend25fallos/6correctos (s01-email-actions-frontend-red-complete.log);router13,12fallos/1correcto (s01-auth-route-reuse-red.log). Se añaden18backend y44frontend. Verde específico108/940 y90frontend;13 casos router prueban cierre/reemplazo de instancia y la excepción normal.

Primera suite backend1fallo/1221correctos,8810aserciones: PasswordPolicyTest esperaba el ack anterior sin current; fixture actualizado a contrato actual, sin debilitar validación de contraseña. Primer frontend específico4 fallos en spies que no entregaban current; actualizados a respuesta de éxito vigente y pruebas reales de cuerpos inválidos retenidas. PHPStan detectó tipo de array extra sin elementos; se añadió shape message?:string. Pint exigió espacio de PHPDoc y se formateó; no supresión añadida.

Browser Playwright fallback para503→200 condicionado:12 contextos (tres pantallas x390/1440 xclaro/oscuro),32POST todos interceptados;400 adicional para activación/reset, foco de teclado tras error/éxito, URL sin bearer, nuevo enlace en misma pestaña, sin overflow/error de página/solapamiento. El primer browser expiró esperando formulario del segundo enlace y confirmó B100; no se sorteó con reload ni se eliminó ese paso. Capturas definitivas390oscuro de verificación y1440claro de reset inspeccionadas; comparación antes/después del hint. Sin API real ni cambios en cuentas, correo real, workers/scheduler, migraciones, commit/push/deploy o nuevo gate E2E/release.

S01 continúa parcial: solicitudes/reenvíos, cambios autenticados, helpers y gates pendientes según matriz. S02–S13 conservan alcance; optimización acompaña cada revisión, no sustituye correcciones ni permite marcar cierre por suite verde.


Verificación definitiva S01 email/navegación/optimización:1222/1222 backend,8810aserciones,252,21s, uvh_test (s01-email-actions-full-backend-final.log,exit0). Pint418 archivos y PHPStan sin errores (s01-email-actions-quality-final.log,exit0); el ajuste posterior al lanzamiento de la suite fue sólo tipado/formato PHPDoc, sin cambiar comportamiento.743/743frontend y lint/tipos/build exit0 en el árbol final (s01-email-actions-full-frontend-layout-final.log). Browser12 contextos/32POST simulados con revisión visual y geometría (s01-email-actions-browser-layout-final.log,exit0).git diff --check correcto. No cierre global ni producción acreditada. Siguiente lectura: solicitudes forgot/resend, contrato público/timing, y fronteras restantes mfaReauthenticate/updateProfile; isPast en esos dos helpers sigue siendo candidato sin regresión nueva ni ID.


## S01 — solicitudes públicas, caducidad y consultas (02/10)

| Hallazgo | Corrección y evidencia |
| --- | --- |
| B102 — P3 — perfil y reautenticación aceptan expires_at == now | Las dos operaciones usan el contexto bloqueado compartido, que exige expires_at > now. Seis casos antes/frontera/después; rechazo sin cambio de perfil, sello MFA ni consumo de recovery code/evento. |
| B103 — P2 — forgot/resend confirman cualquier HTTP2xx | Ambos consumidores usan decodePublicActionAcknowledgement: ok debe ser booleano true. ApiService convierte cuerpos vacíos/HTML/ok falso o textual en502. Forgot preserva formulario y requiere CAPTCHA nuevo para reintento; un submit posterior al éxito no repite el POST. |
| B104 — P2 — recuperación de contraseña sin compensación temporal | Forgot aplica un suelo configurable de250ms por defecto a todas sus respuestas genéricas, igual que resend. Unknown, envío, cooldown, usuario eliminado y fallo de admisión cubiertos. Mitiga el oráculo temporal; latencias que superen el suelo pueden seguir variando, no se afirma indistinguibilidad absoluta. |
| B105 — P2 — solicitud y consumo de reset desalineados con elegibilidad de correo | Sólo cuenta activa y verificada puede admitir o consumir reset. Antes se generaba bearer/outbox para cuentas heredadas sin verificar, que MailDeliveryEligibility descartaba. Un bearer heredado fabricado en fixture también cambiaba su contraseña; no se ha demostrado entrega ni bypass público de verificación. Ahora se rechaza400 sin consumirlo ni mutar cuenta. Verificación/reenvío conservan su flujo propio. |

O03 — Contexto bloqueado devuelve User y UvhSession una sola vez. Siete operaciones eliminan su segunda consulta SELECT de sesión (setup/enable/regen/disable MFA, request/cancel email, changePassword); profile devuelve el modelo actualizado y elimina un SELECT de usuario. Reauth comparte el mismo guard sin cambiar su coste. Medición SQL en nueve operaciones con respuesta200: sesiones2→1 en siete; usuario2→1 en profile. Request/cancel email retienen la recarga posterior al commit de su DTO (usuarios2); no se vende como mejora de tiempo total. Locks/orden/versión/revocación/verificación y política protectora de cierres se conservan. Temporizador y decoder se reutilizan en los dos flujos públicos.

Baselines válidos: perfil/reauth + solicitudes8casos4fallos/4correctos (s01-public-session-red.log); requests completo3fallos8aserciones (s01-public-password-red-complete.log); frontend13casos11fallos/2correctos (s01-public-mail-frontend-red.log). Baseline de consultas9operaciones200,8 incumplían el presupuesto inicial (s01-security-context-query-before.log); presupuesto final distingue las dos recargas de DTO necesarias. Se añaden21casos backend y14frontend. Específico73/429 antes de ampliar solicitudes; ampliación6/52 (s01-public-password-expanded-green-final.log). Frontend completo757correctas y lint/typecheck/build exit0 (terminal22542; build s01-public-session-build.log). Quality420archivos Pint/PHPStan0 (s01-public-session-quality.log).

El primer test ampliado de fallo de admisión fijó created_at por mass assignment, pero EmailToken no permite ese campo: ejecutaba cooldown sin tocar outbox. Se corrigió el fixture con DB::update y un flag que exige que la inserción realmente falle; no hubo cambio adicional de producción. Test final6/52 pasa. Quality precede sólo a ese ajuste de fixture, sin cambio posterior de código productivo.

Sin cambio de layout ni browser nuevo en este lote: confirmaciones verificadas mediante componentes/servicios reales y HttpClient simulado. No se acredita nuevo E2E/release, entrega real, migración o datos locales. La suite backend completa está en ejecución en uvh_test; S01 sigue parcial y el objetivo global activo.


Cierre de verificación del lote: suite backend completa1242correctas/1fallo,8840aserciones,216,03s (s01-public-session-full-backend.log). Único fallo EnvTemplateContractTest: faltaba declarar por qué PASSWORD_RESET_MIN_DURATION_MS se omite de la plantilla de producción. Añadido al contrato por la misma política del suelo resend: conservar el valor seguro sin exponerlo en plantilla. No se modificó código productivo tras esa suite. El contrato reejecutado pasa4/395 (s01-public-session-env-contract-final.log,exit0); Pint sobre los dos fixtures finales pasa (s01-public-session-fixture-pint-final.log,exit0). No se presenta la ejecución completa original como verde ni se suma el filtro al total de casos. La revalidación específica cubre el único archivo corregido tras el fallo; resto de1242casos y código productivo permanecen como en la ejecución completa.

Frontend757correctas/lint/typecheck/build exit0; Pint420/PHPStan0 y diff limpio. Regresiones y medición del lote verificadas. S01 continúa parcial, S02–S13 pendientes; objetivo activo. Siguiente bloque: helpers de CAPTCHA/guards y cierre de inventario/estados de S01. Sin reset de datos locales, workers/scheduler, entrega real, migraciones, commit/push/deploy o gate release/E2E.


## S01 — CAPTCHA, navegación y foco (02/10)

| Hallazgo | Corrección y evidencia |
| --- | --- |
| B106 — P2 — resultados de un reto retirado completan otro intento | El canal cambia con cada documento/reload y los mensajes se ignoran mientras el iframe no está cargado. Invisible sólo acepta verified con ejecución despachada y estado verifying. Cancelación/caducidad/reload retiran la autoridad anterior; un retry espera ready del nuevo documento. No se demuestra bypass: backend continúa validando cada token con el proveedor. |
| B107 — P3 — ready duplicado y cierre dejan estado de carga incoherente | Ready no reemplaza un verifying ya despachado ni un verified confirmado. Cierre con ejecución pendiente la rechaza, marca expired y limpia token; cierre posterior al éxito conserva verified. |
| B108 — P3 — token con controles aceptado en widget | Empty/no string/límite8192 y controlesASCII se rechazan antes de emit/resolve; mismo límite semántico del servidor. No se interpreta el token como HTML. |
| B109 — P3 — navegar el iframe conserva credencial visible del documento anterior | onFrameLoad emite token vacío y revalida la ejecución pendiente. Reset comparte la recarga de documento y canal; nuevo resultado visible funciona. |
| B110 — P3 — guard administrativo usa rol previo a await MFA | adminGuard vuelve a leer isAdmin después de la respuesta. AuthService ya protege el cambio de generación; el caso añadido cubre actualización del DTO con rol retirado sin cambiar sesión. Backend conserva la autoridad y no se acredita acceso administrativo por API. |
| B111 — P3 — cancelar CAPTCHA pierde foco de teclado | El widget recuerda el control que inició execute y restaura tras render al cerrar/error/reset/timeout, si sigue conectado y habilitado. Sólo actúa cuando el foco quedó en body/iframe; respeta otra elección, ejecución posterior o destrucción. Browser reproduce ausencia de foco y verifica retorno al CTA tras cancelar/error y conservación del campo Email elegido durante la espera. |

O04 — Mantenimiento: reset y retry comparten reloadFrame; foco reside en el widget usado por login/registro/reenvío y no en tres implementaciones divergentes de formulario. URL de reload usa el canal aleatorio en lugar de Date.now: dos retries en el mismo milisegundo mantienen documentos distintos. No se afirma reducción de latencia; aislamiento requiere una nueva carga de iframe al retirar una comprobación, con coste de red potencial que el SDK-reset previo no tenía. Suelo120s de ejecución/12s de carga no se amplió, ni se reintenta un POST automáticamente.

Lectura server: HCaptcha::configured/developmentFallbackAllowed/verifyAuthentication/verify/hostnameMatches/verificationUrl/result/credentials/logUnavailable, AuthController::captchaError y OperationalMetrics::increment. Secret/sitekey esperado se verifican en backend; token single-use sin retry de red, hostname/origen, sentinel de test fuera de producción y fallback sólo local/debug/opt-in/loopback ante outage. Métricas son auxiliares y no revierten decisiones ante fallo. Controles actuales20/63,4,12s (s01-captcha-backend.log,exit0); no cambio PHP, nueva suite completa backend o proveedor real en este lote.

Lectura frontend: widget completo, hcaptcha-frame.v1.js/.html, authGuard/adminGuard/safeReturnTo y consumidores execute/reset/AuthService::mfaSessionStatus. Sandbox sin same-origin conserva aislamiento; postMessage exige source y canal. Frame mantiene soporte de mensajes reset para clientes anteriores; nuevo cliente retira documento para evitar callbacks queued. La ruta y el servicio complementan el guard del servidor; no se vende navegación como frontera de autorización.

Baselines:15widget,7fallos/8correctos (s01-captcha-widget-red.log);12guard,1fallo/11correctos (s01-auth-guard-red.log); browser toBeFocused falla tras cancelar (s01-captcha-browser-focus-red.log). La prueba guard original recibía true y serializeUrl fallaba: ese true es el resultado indebido reproducido, no un fallo de transporte. Se añaden19widget+12guard=31controles frontend;33específicos correctos (s01-captcha-guard-targeted-final.log). La suite completa definitiva tras el helper de foco:788correctas y lint/typecheck/build exit0 (s01-captcha-full-frontend-final.log). No supresión añadida.

Browser final4contextos390/1440 claro/oscuro,16POST simulados: cancelar=0POST, dos login401 con tokens distintos, forgot ack inválido→CAPTCHA nuevo→ack válido. Foco vuelve al iniciador, otra elección Email se conserva; challenge-close posterior al éxito no borra resultado. Todos los API y documentos CAPTCHA interceptados: no cuenta real ni red al proveedor. Navegación/foco/estado estable sin overflow/error de página; capturas390oscuro login/1440claro forgot del árbol final inspeccionadas (s01-captcha-browser-keyboard-final.log,exit0). Playwright fallback porque la CLI agent-browser sólo ofrece body/abort y estos recorridos requieren401/200 condicionados, además del iframe aislado.

Harness: el primer mock sin charset interpretó mal los acentos; se añadió UTF-8. addInitScript de tema corría también en sandbox y causaba SecurityError: se limitó a ventana principal, sin relajar sandbox. Un chequeo de overflow antes del cierre renderizado fue transitorio; gate espera cierre del reto antes de medir, no oculta overflow persistente. El mock dejaba botones del reto terminado activos y podía actuar sobre el documento previo: ahora oculta el reto completado/cancelado y el recorrido espera challenge-open, resuelve con teclado y comprueba callback/POST. Se conservan logs de fallos; no se cuentan esos problemas de harness como bugs adicionales del producto.

S01 permanece parcial: inventario de helpers/jobs, UI de MFA/registro y cierre de funciones pendientes según matriz. S02–S13 conservan alcance. No migración, datos locales, worker/scheduler, entrega real, commit/push/deploy ni gate E2E/release acreditados. Próximo bloque: consolidar inventario y cerrar UI de MFA/registro/cambios autenticados, sin repetir pruebas correctas por ajustes sólo documentales.


Ampliación final de B106: revisión de todos los message types detectó ready/challenge-open posteriores al deadline. Dos regresiones adicionales fallaban (s01-captcha-retired-red.log:2fallos/21correctas). frameAttemptUsed se fija al despachar y sólo se retira en onFrameLoad: un ready tardío no revive el documento, execute reutilizado exige nuevo iframe y challenge-open requiere ejecución verifying vigente. No se cambió TTL ni política de backend.21widget+12guard=33pruebasfrontend nuevas,35controles dedicados incluidos en full790. Las cifras788/33 del primer cierre son evidencia anterior a esta ampliación, no el estado final.

Verificación definitiva del árbol:790/790frontend, lint/typecheck/build exit0 (s01-captcha-full-frontend-definitive.log,terminal89637). Browser4contextos/16POSTsimulados, foco tras cancelación/error y elección Email conservada, todos los tokens distintos y sin overflow/error de página (s01-captcha-browser-definitive-keyboard.log,terminal10098,exit0). El harness visible espera aria-busy=false y el invisible challenge-open antes de resolver por teclado; evita actuar durante recarga y sobre un documento retirado. Los fallos intermedios de click de mock se conservan, sin aumentar timeout ni eliminar controles. Backend20/63 y diff limpio; no nuevo código PHP ni nuevo full backend. Objetivo global activo, S01 parcial. Próximo paso: consolidar inventario de helpers/jobs y cerrar los gates UI/estados restantes del sistema.


## S01 — contratos de mutaciones, optimización e inventario (2026-10-02)

Lectura directa: AuthService completo (todas sus llamadas post/patch y protecciones de generación), ApiService::decodeResponse/retryOnRejectedCsrf/request, AuthController::register/changeRegistrationEmail/logout/changePassword, AccountController::cancelExport/acknowledgeExportDownload y sus respuestas. Callers: AuthComponent::onRegister, PanelComponent::logout, PasswordChangeDialogComponent::submit, SettingsComponent::cancelDataExport y DataExportDialogComponent. El tipo genérico TypeScript de post no comprueba JSON en ejecución. Seis operaciones omitían decoder; cualquier 2xx completaba el Promise y habilitaba estados de éxito aunque el cuerpo fuera null/HTML/vacío o una negación explícita.

| Hallazgo | Corrección y límite |
| --- | --- |
| B112 — P2 — registro/corrección de email muestran verificación pendiente sin confirmación válida | register exige objeto con user exactamente null, coherente con la respuesta uniforme y sin sesión del backend. changeRegistrationEmail exige ok booleano true. No autenticar ni distinguir dirección ocupada; frontend mantiene formulario/email anterior ante respuesta inválida y permite retry manual con CAPTCHA nuevo. |
| B113 — P2 — logout borra identidad/workspace y anuncia cierre a otras pestañas ante cuerpo inválido | Exigir ok:true antes de clearLocalAuth/announceInvalidation; conservar estado local al fallar la confirmación. El servidor puede haber revocado la sesión aun con respuesta inválida: el mensaje indica resultado no confirmado, no garantiza sesión vigente. Generación posterior continúa impidiendo que un resultado tardío borre otra cuenta. PanelComponent elimina la afirmación «Tu acceso sigue abierto» del error de logout; no puede saberlo tras una confirmación fallida. |
| B114 — P2 — cambio de contraseña avanza a pantalla de éxito ante respuesta inválida | Exigir ok:true; error502 saneado sin adjuntar cuerpo sensible y sin repetir automáticamente la mutación. No inferir rollback de una respuesta perdida/inválida; servidor conserva step-up, transacción y avisos existentes. |
| B115 — P2 — cancelación/acuse de exportación pueden mostrarse confirmados ante respuesta inválida | Mismo decoder ok:true en ambos endpoints. Dependencia parcial S02 leída para su contrato; no acredita revisión completa de cifrado, generación, descarga, privacidad o limpieza. |
| O05 — mantenibilidad — confirmaciones compartidas | Reutilizar decodePublicActionAcknowledgement en las cinco operaciones que comparten ok:true; un decoder pequeño distinto para registro, cuya forma es user:null. No añadir reintentos, checks duplicados en componentes ni validadores divergentes. Sin ganancia de velocidad cuantificada. |

Regresión real de transporte: HttpClient simulado + ApiService/AuthService reales; auth-mutation-response.spec.ts contiene44controles. Baseline final34fallos/10correctas (s01-account-mutations-red-final.log); todos los34 rechazos de cuerpos indebidos fallaban porque el Promise se resolvía. Primera ejecución no compilaba por createdAt omitido en un Workspace fixture; corregido el fixture antes de tomar baseline, no contado como bug de la aplicación. Green44/44 (s01-account-mutations-green.log). Comprueba seis contratos, normalización502 sin secretos, un solo POST, identidad/workspace retenidos ante rechazo, anuncio cross-tab sólo al confirmar logout y cuatro respuestas tardías tras reemplazo de cuenta ignoradas.

Verificación definitiva del árbol frontend después del ajuste de copy de logout:834/834, lint/typecheck/build exit0 (s01-account-mutations-full-frontend-definitive.log). La primera ejecución s01-account-mutations-full-frontend.log también pasó834; no se presenta como verificación posterior al último cambio. Backend66/915aserciones,20,97s, exclusivamente uvh_test (s01-account-mutations-backend.log): RegistrationAdmission/RegistrationEdit/Concurrency, PasswordNoticeAtomicity, DataExportDownloadLifecycle y EnvTemplateContract. No nuevo código de aplicación PHP ni nueva suite backend completa. La ejecución completa anterior1242correctas/1fallo y posterior corrección del contrato config permanecen descritas como tales; no sumar filtros para atribuir una suite completa verde.

Browser final4contextos390/1440 claro/oscuro,16POST simulados (s01-registration-contract-browser-definitive.log): registro201 con cuerpo indebido mantiene formulario, respuesta user:null pasa a verificación; corrección ok:false conserva formulario y sólo ok:true actualiza destino mostrado. Cuatro CAPTCHA distintos por contexto, foco restaurado al botón tras error, sin overflow ni errores de página. Todo API y documento CAPTCHA interceptado; Playwright fallback documentado porque agent-browser ofrece mock de body/abort sin status201/401 condicionado. Capturas finales390oscuro error y1440claro confirmación inspeccionadas. El skip-link parecía visible en una primera captura fullPage con scroll avanzado: el rectángulo real termina fuera del viewport y no tiene foco. Es un artefacto de captura de un elemento fixed; se captura desde scroll0, sin modificar CSS ni contar otro bug.

Inventario reproducible: docs/superpowers/plans/2026-10-02-source-function-inventory.md/.json.440archivos,2141funciones/métodos con nombre,1128callbacks/closures anónimos y3firmas sin cuerpo. PHP token_get_all(TOKEN_PARSE) y AST TypeScript, con línea/hash y sistema propuesto S01–S13; no ejecutar Laravel ni consultar DB. Todas las propuestas se deben conciliar por consumidor; enumerar no cierra revisión. Includes app/bootstrap/config/routes, frontend src/public, resources y scripts. HTML/Blade/SCSS/Python y script PHP auxiliar son superficies sin análisis de expresiones; migraciones/infraestructura/dependencias siguen pendientes S13. El cotejo lexical de métodos PHP sólo difiere en EmitPasswordPolicy porque el regex cuenta funciones JavaScript dentro de strings; tokenizer las distingue correctamente. Sin archivos duplicados. Node --check y php -l correctos, generación exit0. S01 tiene555entradas propuestas, incluidas closures y dependencias compartidas: no son555funciones cerradas.

Lectura adicional RegistrationEdit y HostOnlyCookie completa: secreto sellado/opaco, señuelo0/0, versionado bajo lock, atributos host-only/HttpOnly/Lax; preserve comportamiento. La comparación del deadline del claim usa < en milisegundos: candidato de frontera exacta pendiente de reproducción determinista; sin ID ni cambio por conjetura. SessionManager sólo enumerado/relectura parcial en este lote; conserva evidencia anterior en matriz.

S01 sigue parcial; inventario ampliado no sustituye conciliación de helpers/roles/estados ni cierre UI MFA/cambios autenticados. S02–S13 abiertos. Próximo bloque: conciliar las funciones S01 con evidencia existente y completar estados UI MFA/registro/cambios de cuenta pendientes, registrar dependencias compartidas y pasar a S02 sólo con gate de código explícito. No DB local alterada, workers/scheduler, correo/proveedor real, migración, commit/push/deploy ni release acreditado.
