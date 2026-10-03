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


## S01 — edición OTP, flujo MFA y revisión por función (2026-10-02)

Lectura de código: OtpCodeInputComponent completo, AuthComponent::onOtpCompleted/onOtpModalKeydown/onMfa/onRecovery/goRecovery/backToMfa/restartMfaLogin y templates MFA/recovery; SettingsComponent::stageMfaSetup/enableMfa/disableMfa/cancelMfaSetup y protección LatestRequest, sin cerrar todavía toda esa UI. Backend: MfaAttempts, MfaStepUp, MfaFreshness, Totp, SessionManager y middleware UvhSession/UvhAuth/RequireMfa completos; revocaciones individuales/otras/todas y sus callers/avisos bajo TX. Registro por función en docs/superpowers/plans/2026-10-02-s01-function-review-ledger.md:52funciones leídas en11archivos, con gates pendientes explícitos.

| Hallazgo | Corrección y alcance |
| --- | --- |
| B116 — P2 — borrar/editar OTP conserva un código distinto del mostrado | writeDigits no vaciaba el slot ante texto vacío; recomponer desde string compacto desplazaba dígitos si había huecos. Slots locales conservan posiciones; control sólo recibe los dígitos existentes y queda inválido mientras falte cualquiera. Padre reset/write reemplaza slots y reinicia completado. Erase/refill permite emitir otra vez; repetir código completo sin edición no repite submit. Autofill queda acotado a6, como paste. No bypass de validación backend demostrado. |
| B117 — P2 — cambiar de método mientras se verifica MFA puede abandonar la respuesta válida | Botones de método quedan disabled durante POST; enlace a recuperación reforzada carece de routerLink mientras está ocupado. goRecovery/backToMfa también comprueban busy. La revisión anterior permitía cambiar flowRevision/step mientras AuthService todavía podía autenticar; el callback luego descartaba navegación y showAuthForms podía desaparecer. Reset local forzado/destrucción siguen ignorando callbacks antiguos; no se quita ese guard. |
| B118 — P3 — pérdida de foco y teclado tras envío/error/caducidad MFA | Modal tabindex=-1/aria-busy recibe foco antes de desactivar inputs. Tab sin controles habilitados permanece en diálogo. Error retira código OTP y devuelve foco al primer slot después del render; cambiar método enfoca recovery y caducidad/Escape vuelven al email. Helper deferred verifica revisión/paso/busy/destroy y conserva elección posterior. OTP mueve foco antes de completed.emit para no pisar el foco que reclama el padre al verificar. |
| O06 — mantenibilidad — proyección OTP y foco de pasos compartidos | Un único signal de slots, sin mirror/computed redundante; edición no reinterpreta la string compacta en cada evento. projectControl concentra escrituras externas y reset; focusAuthStep concentra restauración lógica con guard. Sin mejora de latencia cuantificada ni política de autenticación cambiada. |

Regresiones:8casos nuevos de OTP (baseline7fallos/1correcto en s01-otp-editing-red.log; green8);6casos nuevos de flujo MFA (baseline6fallos/37correctos en s01-mfa-ui-lifecycle-red.log). Primera corrección conjunta51/51. Un caso integrado adicional descubrió que el hijo OTP recuperaba foco después de completed.emit y lo perdía al deshabilitarse; baseline1fallo/43correctos (s01-mfa-completion-focus-red.log). Reordenado foco antes de emit; final52/52 (auth.component44+OTP8, s01-mfa-ui-lifecycle-green-final.log). Una ejecución green no pudo arrancar Chrome por CHROME_BIN mal formado; se corrigió la ruta instalada y se ejecutó de nuevo, sin contarlo como fallo de producto. Los nuevos casos usan DOM/formulario/eventos; no sólo spies sobre helpers. La prueba antigua de abandonar recovery se conserva mediante reset local explícito: cambiar método durante busy ahora está bloqueado por contrato.

Verificación definitiva frontend:849/849 y lint/typecheck/build exit0 (s01-mfa-ui-full-frontend.log). Browser4contextos390/1440 claro/oscuro,32POST simulados (s01-mfa-ui-browser.log): borrar hueco→refill conserva129456 como body; errores401/503 limpian código y restauran foco; pegar123456; método/foco retenidos durante respuesta controlada por gate, no sleeps; recovery incorrecto y challenge caducado, Escape, tres login con CAPTCHA distintos y éxito a /help con654321. Sin overflow ni errores de página; capturas390oscuro y1440claro inspeccionadas. API/documento CAPTCHA íntegramente mock; no entrega/proveedor/cuentas reales. Playwright fallback por respuestas condicionadas y code-gated status401/503, no disponibles en mock body/abort de agent-browser.

Backend sin cambio productivo:77/541aserciones,37,11s (s01-mfa-ui-backend.log: MfaLoginAdmission/MfaChallengeAdmission/MfaConfigurationBoundary/MfaStepUpBudget/SessionsRevocationNotice), y14/82,3,61s (s01-mfa-session-helpers.log: SessionManager/UserAgent/Hydration/Totp). Filtros separados sobre uvh_test, ejecutados de uno en uno; no sumarlos como una suite completa. No nueva suite completa ni Pint/PHPStan PHP en este bloque, porque no se modificó aplicación PHP. La evidencia anterior del full1242correctas/1fallo de configuración y corrección específica conserva sus límites.

Inventario actualizado:440archivos,2143funciones con nombre,1127callbacks anónimos y3firmas. Refinada propiedad propuesta: invitation-accept→S03, auth-shell→S12; decoder token→S07, webhook/delivery→S08, helpers compartidos→S13 y confirmación de borrado→S02. Antes algunas entradas estaban agrupadas por ubicación auth/nombre credential en S01; eran propuestas no cierres. S01 ahora522entradas propuestas, no522funciones revisadas.52funciones poseen lectura registrada en ledger, sin sustituir el resto de la matriz. Generación/parser/diff correctos; hashes comprobados contra árbol actual. No perder evidencia previa al regenerar.

Pendientes reales: fronteras exactas MfaFreshness::isFresh (comparación >= y expiresAt) y RegistrationEdit::claim (milisegundos<) con regresión determinista, sin nuevos IDs antes de probar; referencia independiente/vectores TOTP; comandos locales/promoción; conciliar funciones restantes y modelos/DTOs; completar UI enrolment/regeneración/desactivación MFA, centro de seguridad, cambios autenticados y finalización de recuperación. SessionManager last-used ahorra writes según snapshot, pero la promesa de una sola escritura bajo concurrencia necesita análisis específico S13. Config/router/cookie/store/crypto/mail/outbox compartidos mantienen gates S13/S10/S02; revisar otras llamadas en sus sistemas. S01 continúa parcial, S02–S13 y objetivo abiertos; no reclamar totalidad por este lote. No DB local alterada, worker/scheduler, envío real, migración, push/deploy ni release ejecutados por este trabajo.


Siguiente lectura identificada en cierre por función: onLogin/onMfa/onRecovery esperan router.navigateByUrl dentro del try de credenciales; false no se maneja y una rejection comparte catch con errores del factor, pese a que AuthService puede haber establecido ya user. Revisar el estado visible/reintento después de autenticación confirmada ante navegación fallida. Es candidato sin reproducción nueva/ID; ledger conserva ese gate pendiente, no se declara UI completa.


## S01 — navegación autenticada y frontera de caducidad MFA (2026-10-02)

Revisión de código: AuthComponent::constructor/onLogin/onMfa/onRecovery/returnTo y navegación del Router; AuthService::login/verifyMfa/recoverMfa/sessionGeneration; MfaFreshness::isFresh y sus consumidores mfaSessionStatus/MfaStepUp/RequireMfa. La enumeración de funciones sigue separada de esta lectura.

| Hallazgo | Corrección y alcance |
| --- | --- |
| B119 — P2 — sesión iniciada, pantalla bloqueada tras fallo de navegación | Los tres callbacks ignoraban navigateByUrl=false y trataban su rejection como error de credenciales/factor, aunque AuthService ya había confirmado la identidad. También afectaba al visitante con sesión existente. Un helper absorbe exclusivamente el fallo de navegación y ofrece reintentar el mismo destino, conservando sesión; no vuelve a enviar contraseña/CAPTCHA/TOTP/recovery. El intento se liga a revisión del flujo, generación de sesión y vida del componente. Se serializan reintentos y una navegación antigua no borra el busy de la siguiente. El estado y el foco permanecen accesibles mientras se reintenta. |
| B120 — P3 — MFA vigente justo en expiresAt | isFresh aceptaba igualdad en el límite inferior. La regresión obtuvo fresh=true y regeneración de recovery=200 en la fecha de caducidad exacta. Comparación estricta >: antes del límite funciona; en el límite y después requiere reautenticación y conserva el factor y timestamp sin consumirlos. No se demuestra acceso sin MFA ni una ampliación indefinida de la ventana. |
| O07 — mantenibilidad — navegación autenticada compartida | Login, TOTP, recovery y sesión ya existente usan una sola función para cancelar/fallar/reintentar navegación. Desaparecen los cuatro tratamientos divergentes; revisión/generación y foco están en el mismo lugar. Optimización de estructura y duplicación, sin atribuir mejora de latencia no medida. |

Regresiones frontend: seis reproducciones iniciales (cancelación/rejection por tres métodos) fallaban antes del fix: s01-navigation-red.log, 6 fallos/44 correctas. Con la corrección inicial,50 correctas. Añadidos sesión existente, reintento sin credenciales, busy/foco/deduplicación, fallo repetido sin bucle automático, invalidez/generación, destrucción y navegación vieja frente a login nuevo. Final67 controles dedicados (Auth59+OTP8), s01-navigation-lifecycle-final.log;15 casos nuevos respecto al lote anterior. La primera versión del último test dependía de contar microtareas y no recreaba el formulario tras invalidar sesión: falló su harness. Se corrigió con render y gate explícito de entrada al Router, sin tocar producto ni aumentar timeout. Frontend completo definitivo864/864: s01-navigation-full-frontend-final.log. Lint/typecheck correctos y build correctos (s01-navigation-build.log); no cambio runtime después.

Backend: baseline específico de estado al límite1 fallo/2 correctas (s01-mfa-freshness-red.log); baseline adicional3 fallos/2 correctas (s01-mfa-freshness-boundaries-red.log) demuestra operación200 y fronteras de microsegundo/zona horaria. Ocho casos nuevos en total. Filtro final85/572 aserciones,20,58s (s01-mfa-freshness-green.log); Pint3 ficheros y calidad global Pint421/PHPStan0 correctos (s01-navigation-freshness-quality.log). Suite completa Laravel definitiva:1251/1251,8941 aserciones,209,09s, exit0 (s01-navigation-freshness-full-backend.log), sobre uvh_test. Esta ejecución completa sustituye la evidencia full antigua de1242correctas/1fallo de plantilla, que conserva su registro histórico y corrección específica.

Browser definitivo:12 recorridos,390/1440 × claro/oscuro × login/TOTP/recovery;20 POST simulados en total, tres intentos de navegación por recorrido (false, rejection, éxito /help). No repetición de credenciales/factores por reintentar ruta, sin overflow ni errores de página; foco de estado y Tab a botón verificados. API/documento CAPTCHA íntegramente interceptados. Inyección de fallos en Router real de Angular sólo en el harness, sin hook productivo. Playwright por controles condicionados/gates que exceden route body/abort del CLI agent-browser. Primer harness comprobaba botón habilitado antes de llenar credenciales; segundo intentaba llenar seis dígitos en un campo maxlength=1 y tenía un nombre de botón incorrecto. Corregidos a contrato real/paste/nombre actual; ningún ID adicional por errores de harness ni aumento de timeout. Evidencia definitiva: s01-navigation-browser-definitive.log; capturas390oscuro/1440claro inspeccionadas.

Inventario regenerado:440 archivos,2146 funciones con nombre,1128 callbacks y3 firmas;S01 tiene526 propuestas de propiedad, no526 funciones revisadas. Ledger59 funciones con lectura registrada en11 archivos, con pendientes explícitos. S01 permanece parcial y S02–S13 conservan alcance. Siguiente revisión: destinos de retorno que apuntan al propio formulario (candidato sin reproducción/ID), RegistrationEdit en milisegundos, vectores TOTP independientes, comandos locales y UI/configuración MFA/centro de seguridad/cambios autenticados/finalización de recuperación. Stores/cookies/config/mail/infraestructura/producción permanecen en sus gates. No cuentas reales, worker, scheduler, migraciones, publicación ni entrega de correo real ejecutados.


## S01 — reautenticación, promoción y referencia TOTP (2026-10-02)

Este turno produjo progreso: código de reautenticación/promo corregido, destino de retorno consolidado, nuevas regresiones y referencia independiente. Lecturas adicionales: MfaReauthenticateComponent completo, safeReturnTo y su caller de login, AuthRouteReuseStrategy, DevTotp y PromoteAdmin completos; algoritmos Totp confrontados con referencias oficiales. La revisión global no se reduce a estos archivos.

| Hallazgo | Corrección y alcance |
| --- | --- |
| B121 — P2 — reautenticación MFA sin salida/reintento tras navegación fallida | navigateOnce marcaba terminal antes de await y no trataba false. Una rejection se confundía con fallo de verificación; el reintento de comprobación quedaba bloqueado por terminalNavigation. Después de verificar, podía solicitarse otro factor aunque el destino seguía sin poder abrirse. Se guarda sólo la operación de navegación y su predicado de contexto; retry no repite comprobación ni factor. Formulario se retira tras éxito; terminal impide otro POST. Se aplican también ramas login/forbidden/no-MFA, con sesión cambiada→nueva comprobación explícita y destrucción→resultado ignorado. Estado/foco/busy accesibles; copy, espacio18px y botón48px verificados. |
| B122 — P3 — promoción de administrador admite MFA inutilizable | La presencia de mfa_secret bastaba aunque fuera ciphertext corrupto o secreto inválido. Bajo lock se descifra mediante UvhCrypto y se comprueba formato con Totp antes del cambio de rol/auditoría. Errores de cifrado dan rechazo uniforme, sin detalles del material. Se mantiene lectura de keyring/legacy del proyecto y la idempotencia. Superficie CLI con acceso del operador; no se ha demostrado una escalada remota ni bypass de MFA HTTP. |
| O08 — mantenibilidad — regla de retorno compartida | AuthComponent::returnTo usa safeReturnTo con fallback vacío y conserva prioridades de contexto/destino. Se elimina la copia del filtro de URLs; la misma regla bloquea absoluto/protocol-relative, backslash, controles y valor >1024. Siete regresiones del caller prueban destinos internos/fragmentos y rechazos. No se cambia la política ni se atribuye ahorro de latencia no medido. |

Candidato returnTo=/auth: no reprodujo bloqueo. Browser real mostró /auth → /app → /app/dashboard con un único POST de login; AuthRouteReuseStrategy recrea el componente (renewAuthContext) y la segunda vista usa destino por defecto. s01-self-return-browser.log. No ID nuevo ni bloqueo de rutas legítimas por asumir un bucle. Queda una navegación adicional, sin fallo confirmado en este caso; no declarar probadas todas las variantes de URL por esta muestra.

TOTP:19/23 aserciones (s01-totp-vectors.log),17 casos nuevos. Diez vectores HOTP de RFC4226 AppendixD, seis vectores SHA1 de RFC6238 AppendixB reducidos a seis dígitos y el decode exacto del secreto base32 en ambas cajas. Se invocan métodos privados por Reflection en tests, sin abrir API de generación histórica ni cambiar reloj productivo. Fuentes primarias: https://www.rfc-editor.org/rfc/rfc4226.html#appendix-D y https://www.rfc-editor.org/rfc/rfc6238.html#appendix-B. Prueba el algoritmo en los contadores publicados; no completa el reloj público/window/replay/contadores fuera de32bits. Lectura identifica pack de parte alta cero en hotp como siguiente frontera de formato64bits, sin ID nuevo antes de reproducción.

Regresiones frontend: baseline reauth4 fallos/6 correctas (s01-reauth-navigation-red.log), corrección inicial73 controles junto con login/guard. Añadidos estados de sesión/roles, generación, busy/teclado, doble click, no consumo extra, destrucción;83 correctas (s01-reauth-navigation-lifecycle.log), después siete casos de destino compartido verificados por suite completa. Definitivo885/885 y lint/typecheck/build exit0 tras ajuste visual final: s01-reauth-navigation-full-frontend-definitive.log y s01-reauth-navigation-build-definitive.log. Son21 casos nuevos en este bloque;20 casos actuales del componente reauth.

Regresiones promoción: fixtures de éxito/idempotencia ahora cifran un secreto real. Primera baseline incluía una expectativa errónea de rechazo de plaintext válido; lectura de decryptAtRest mostró compatibilidad legacy explícita y se corrigió esa expectativa antes de producto. Baseline definitiva5 fallos/6 correctas (s01-promotion-factor-red-definitive.log), cubre ciphertext malformado/tag ilegible, plaintext descifrado inválido/corto/vacío; seis casos nuevos incluyendo legacy utilizable admitido. Filtro53/184 aserciones,21,53s (s01-reauth-commands-backend.log). Pint/PHPStan global correctos,421 archivos (s01-reauth-commands-quality.log). Full Laravel definitivo1274/8983 aserciones,242,52s (s01-reauth-commands-full-backend.log), en uvh_test, ejecutado solo y sin cambio PHP posterior. No sumar filtros para simular full.

Browser definitivo: ocho recorridos390/1440 × claro/oscuro × MFA ya fresh/confirmación por POST; una sola comprobación status por recorrido y cuatro POST en total. Cada uno navega false/rejection/éxito /help; teclado, foco, formulario retirado, ausencia de overflow/error y geometría18px/48px comprobados. s01-reauth-navigation-browser-definitive.log; capturas390oscuro/1440claro inspeccionadas en árbol final. API completamente interceptada y fallo inyectado en Router real sólo en harness. Primera ejecución omitía mock GET/pending al entrar en Help y se corrigió; no se atribuye a bug del producto ni se aumenta timeout. Playwright por gates condicionados de la sonda/fallo de navegación. Sin proveedores/cuentas reales.

Inventario actual440 archivos/2148 funciones con nombre/1129 callbacks/3 firmas;S01 tiene529 propuestas de propiedad, no cobertura cerrada. Ledger77 funciones leídas/16 archivos, con pendientes explícitos, hashes actualizados. Próximos gates: RegistrationEdit en milisegundos; DevTotp stage con expiry ausente/exacta (backend mfaEnable rechaza null/lte, comando usa isPast sólo si no null); Totp contador64bits y reloj público; UI/config MFA/centro de seguridad/cambios autenticados/finalización recuperación; conciliación de funciones restantes y S02–S13. watch CLI se leyó sin arrancar stream ilimitado; ciclo de señales/tiempo vivo queda pendiente. No worker/scheduler, DB local, migraciones, correo real, commit/push/deploy ni release ejecutados. Objetivo activo y S01 parcial.


## S03 — autoridad y auditoría; trazabilidad/CI S13 (2026-10-02)

B123 (P2): doce mutaciones explícitas de WorkspaceController publicaban éxito antes de admitir su auditoría. Ante fallo de admisión se conservaban permisos/cambios sin el evento. Admisión ahora dentro del commit de negocio; fallo revierte cambios, avisos y credenciales SQL. Se conserva recuperación del historial inaccesible y señales informativas externas.
B124 (P2): transferencia/borrado no revalidaban caducidad de sesión después del middleware. WHERE expires_at > now() bajo lock, antes de factor; fronteras -1/0/+1s reproducidas y corregidas. No declarar todas las sesiones de S03 revisadas.

56 casos WorkspaceAuditAtomicityTest y4 RequestCorrelationTest nuevos. Baseline admisión24fallos/12correctos; baseline expiry4fallos/6correctos. Conjunto definitivo131/954 aserciones,34,22s en uvh_test; Pint423/PHPStan0 con baseline. CorrelateRequest no reproduce el fallo propuesto en ruta/middleware posterior: Laravel captura report/render dentro del pipeline. Se conserva código y registra alcance parcial. Contrato escrito en docs/SECURITY_MUTATION_CONTRACT.md y ledger docs/superpowers/plans/2026-10-02-workspace-authority-review-ledger.md. Full backend en curso; no se acredita por sumar filtros.

CI remoto HEAD b93185d confirmado por API/página pública: tres runs failure; CI36950477409 nueve jobs sin steps, con bloqueo de facturación explícito en GitHub. Fuente https://github.com/Meth0ds/uvh-link-manager/actions/runs/36950477409. Requiere intervención de cuenta y nueva ejecución; no re-run, push ni modificación de billing/workflows. Gh ausente y fetch de job no admitido por wrapper; alternativa conector/página pública verificada. Primer harness de correlación colisionaba con catch-all API (cuatro404); corregida sólo fixture, no producto.

Desviación de orden justificada por defecto compartido de autoridad antes de extraer Auth. Resto de revisión/roles/UI/concurrencia S03 y S01–S13 pendientes; no migración, DB local, workers/scheduler ni entrega real. No se atribuye ganancia de rendimiento a mover llamadas; futuras extracciones y optimización siguen el contrato y mediciones.


Cierre de verificación del lote B123/B124 (02/10): Suite completa definitiva:1334/1334 backend,9474 aserciones,279,36s en uvh_test (s03-workspace-audit-full-backend.log), exit0. Pint423/PHPStan0 con baseline activo;diff--check0. No modificación PHP posterior. Frontend no modificado en este bloque, no se acredita nueva ejecución de su suite. Inventario440 archivos/2148 funciones con nombre/1129 callbacks/3 firmas;440 hashes actuales comprobados. S03/S13 parciales y objetivo global activo.


## B125 / O09–O10 — sesión concreta y primera extracción Auth (02/10)

B125 (P2): una sesión revocada después del middleware podía confirmar diez mutaciones de workspace porque la cuenta conservaba su security_version. Baseline60:50 fallos/10 controles (transferencia/borrado ya protegidos). SecurityContext ahora revalida cuenta verificada/generación y sesión exacta, owner, revoked_at y expiry bajo locks dentro de las doce TX. Contexto stale responde409 sin borrar cookie; invitación pendiente se conserva para nueva sesión, bearer terminal mantiene400. No se afirma acceso con una cookie ya revocada en una petición nueva.

O09: contexto con constructor privado/factory transaccional, usuarios multi-actor ordenados, modelos reutilizados por WorkspaceAccess sin nuevo SELECT de cuenta. Doce controles positivos miden un SELECT FOR UPDATE de usuarios y uno de sesión; no se afirma ahorro global/latencia porque la comprobación de sesión añade trabajo necesario. El API-token gate antiguo se conserva para otros callers. Readonly no hace modelos inmutables ni extiende locks; sólo usar el contexto en la TX original.

O10: separación gradual Auth solicitada por el usuario. App\Support\Auth\LoginAdmission concentra la TX de login: snapshot de contraseña comprobada por caller, revalidación, concesión y auditoría juntas, cleanup del reto no publicado. MfaChallengeStore recibe seis helpers; AuthController mantiene HTTP/CAPTCHA/hash/publicUser/cookie y los flujos finales TOTP/recovery por ahora. Traslado mecánico de cuerpos contrastado con original; rutas, respuestas, TTL300s y namespaces de cache se conservan. No hay nueva capa de DTO/estados ni cambio de comportamiento disfrazado de refactor.

Verificación: extracción de SecurityContext conservando Auth111/880 antes de tocar workspaces. WorkspaceAuditAtomicityTest133 casos actuales, LockedSecurityContextTest16 (dos PDO reales independientes) y cuatro nuevas caracterizaciones MFA: TTL exacto, put=false, cleanup huérfano fallido con TTL, marker consumido que impide replay por recovery. Antes de separar LoginAdmission:38/237 aserciones,11,77s. Después:251/1636,61,68s en uvh_test (s01-auth-extraction-s03-contracts-final.log). Pint428/PHPStan0 con baseline activo (s01-auth-extraction-quality.log); no nuevo ignore ni ampliación de baseline. Suite completa final1431/10041,249,51s verificada tras el ajuste de ID0; no inferida de sumar filtros.

Inventario444 archivos/2158 funciones con nombre/1130 callbacks/3 firmas,444 hashes actuales; ledger S01 95 lecturas en19 archivos con pendientes. Namespace Auth y contexto propuestos S01 con consumo workspace S03; enumeración sigue sin acreditar revisión. Documentación/ledger registran errores de harness y pruebas corregidas, sin IDs de bug ficticios.

Pendiente: admisión final TOTP/recovery, registro/recuperación y funciones S01 restantes; otros consumidores del contexto, roles/UI y concurrencia entre controladores S03; resto S02–S13. CI remoto sigue bloqueado por facturación GitHub previamente confirmada, no resuelta con código. No migración, DB local, worker/scheduler, proveedor real, commit/push ni deploy. Este lote no declara finalizado el proyecto.


Revisión final de migración: ID de miembro0/000 aceptado por la ruta no es un relatedUserId válido de la factory. Baseline de la regresión introducida2fallos/1control; caller evita ese lock imposible y conserva target_inactive409.3/15 aserciones correctas (s03-context-zero-target-green.log). Full anterior1428/10026,260,56s correcto; después del último cambio PHP1431/10041,249,51s también correcto. No atribuir este hallazgo de QA a un bug histórico ni cerrar el árbol final con evidencia anterior.


Verificación definitiva del árbol final B125/O09–O10:1431/1431 backend,10041 aserciones,249,51s en uvh_test (s01-auth-extraction-full-backend-final.log), exit0. Pint428/PHPStan0 con baseline existente y sin ampliación (s01-auth-extraction-quality-final.log), exit0. Último cambio PHP ID0/000 incluido en esta suite. Inventario444/2158 con nombre/1130 callbacks/3 firmas;444 hashes y anchors de ambos ledgers actuales, Node --check y git diff --check correctos. Backend97 regresiones nuevas frente al full1334 anterior; frontend no modificado en este lote y no se acredita nueva ejecución de su suite. S01–S13 y objetivo global abiertos; siguiente extracción admisión final TOTP/recovery según plan. CI billing permanece externo pendiente. No DB local, migración, proveedor, worker/scheduler, commit/push ni despliegue.


## S01 B126/O11 — admisión MFA y factores compartidos (02/10)

O11: MfaLoginAdmission agrupa ambas callbacks SQL de TOTP/recovery: cuenta vigente/generación/factor/reto/sesión y todos los eventos en su TX. Controller conserva los preflight, presupuesto, lock distribuido y replies; la precondición de owner/version/challenge bajo lock está documentada y no se presume garantizada por un futuro caller arbitrario. MfaFactorVerification recibe decryptSecret/consumeTotp/recoveryIndex y elimina duplicación con StepUp; mfaEnable usa los mismos helpers. Fuente/cuerpos comparados con snapshot anterior al traslado: sólo capture/owner/nombres. Retos300s, replay180s, namespace y mapping propios de cada superficie preservados. Sin dependencia nueva, DTO artificial ni refactor masivo.

Primero congelado con89/606 aserciones antes/después,26,02s/29,10s; luego B126 (P2), independiente del traslado: recovery trataba un cambio de cuenta concurrente como código incorrecto, cobrando un intento de propósito/global y publicando auth.mfa_failed. Cuatro cambios (security_version/deleted/verified/MFA enabled) reproducen conteo1 cuando debía0; baseline4 fallos/2controles,46 aserciones (s01-mfa-recovery-stale-budget-red.log). Account stale ahora challenge401/caducada antes de código/reto; no se consume credencial ni se cobra. Controles de códigos incorrectos siguen cobrando1 por nivel y registrando el fallo. Tipos corruptos no-array de recovery_codes mantienen contrato previo y requieren revisión propia.

Diez controles nuevos:4 recovery races,2 cross-method consumption con cookie/profile/flags,2 replay cruzado login/step-up,2 intentos de factor realmente incorrecto. MfaLoginAdmissionTest23 actuales. Se corrigió fixture de reauth que enviaba code en vez de factorCode: produjo403 y no probaba replay; source y contrato leídos, parámetro corregido antes de producto. No se contabiliza como bug de app. Primer red B126 comprobó copy; red definitivo ordena contador antes del copy para probar el coste erróneo directamente.

Final91/640 aserciones,24,08s (s01-mfa-admission-contracts-final.log) y Pint430/PHPStan0 con baseline (s01-mfa-admission-quality-final.log). Baseline191→188 por tipos resueltos de dos endpoints y parámetro hashes trasladado; ninguna entrada añadida ni ignore nuevo. AuthController2980→2880 en este paso; ahorro de duplicación/mantenibilidad, no mejora de latencia acreditada. Inventario446 archivos/2160 funciones con nombre/1130 callbacks/3 firmas,446 hashes actuales; ledger S01 101 lecturas/21 archivos, todavía parcial. Full actual en curso, sin sumar filtros para inferirlo. Frontend/proveedor/DB local sin cambios de este lote.

Pendientes globales: orquestación de MFA/HTTP, registro/verificación/password/recovery y conciliación de funciones restantes S01; S02–S13 y release externo. CI billing previo sigue pendiente de cuenta, no frena el trabajo local. Hipótesis de failover reset del replay por usar cache.default no se reproduce bajo guard productivo actual: CACHE_STORE permite sólo store compartido canónico, excluye failover; sólo CACHE_LIMITER de disponibilidad permite cadena. El drill de pérdida/reinicio real de Redis y durabilidad/clock del proveedor sigue en S13; no se modifica configuración por una hipótesis. Fuentes locales ProductionSecurity226–234/config cache; fixture de boot usa Redis default y limiter failover/database separados.


Verificación final B126/O11:1441/1441 backend,10137 aserciones,269,95s en uvh_test (s01-mfa-admission-full-backend.log), exit0; incluye10 casos nuevos frente a1431 anterior. Pint430/PHPStan0, baseline191→188 con sólo3 entradas resueltas retiradas (s01-mfa-admission-quality-final.log), exit0.91/640 contratos dedicados y traslado89/606 antes/después. Inventario446 archivos/2160 con nombre/1130 callbacks/3 firmas;446 hashes y101/16 anchors S01/S03 comprobadas. Ledger S01 101 funciones/21 archivos, todavía parcial. Node --check y git diff --check correctos, sin cambio de PHP después de la suite. Frontend no modificado ni nueva ejecución/browser atribuidos a este lote. Auth y objetivo global S01–S13 siguen abiertos; siguiente RegistrationEdit/registro/verificación antes de extraer su admisión. CI billing conocido y gates de producción permanecen externos. Sin migración, DB local, proveedor, worker/scheduler, commit/push ni despliegue.


## S01 B127/O12 — separación gradual de registro y activación (02/10)

B127 (P3) reproducido: el permiso de edición de registro admitía exactamente su deadline (un milisegundo de frontera), tanto con sello actual como legacy. Red2fallos/4controles,16aserciones,3,63s en s01-registration-deadline-red.log. Rechazo <= corregido conservando microtime productivo, formato opaco, fixed-length, decoy y caller bajo lock. Reloj namespace exclusivamente en subprocess aislados PHPUnit; la igualdad no depende de carreras de tiempo. No es un bypass de verificación de email.

O12: RegistrationAdmission extrae registro y activación conservando juntos tokens, mail/outbox, identidad, contraseña, workspace, consentimientos y auditoría. Se trasladan tres helpers y EmailAddressLock sin duplicar el advisory que usan cambios de email. Las versiones legales se definen una sola vez en el servicio y ambos formularios HTTP las validan como antes. Cuerpos de SQL/callbacks/helpers comparados mecánicamente; sin nuevas dependencias, DTOs ni alteración funcional en el traslado. Controller mantiene CAPTCHA/input/errors/cookies y compatibilidad legacy.2880→2637líneas,243menos, sin ahorro medido de consultas o latencia y aún lejos del tamaño objetivo.

142/1199 contratos antes del traslado con fuente previa estable (s01-registration-before-extraction-verified.log),43,11s;146/1257 después,50,02s (s01-registration-contracts-final.log). Cuatro nuevos controles: pending/legacy establecen una sola identidad sin sesión y conservan bearer al rechazar password personal contra mailbox vivo. Primera ejecución nueva tuvo2 fallos de fixture por usar workspace_quotas en vez de quotas; corregido sin tocar comportamiento productivo. Pint434/PHPStan0 (s01-registration-quality-final.log); baseline188→186, sólo2 return types resueltos eliminados, sin ignore nuevo. La primera calidad se detuvo en Pint del test y se repitió completa tras corregir formato.

Inventario448/2162con nombre/1130callbacks/3firmas; ledgers S01 117funciones/24archivos y S03 16anchors. Inventario no acredita revisión. Suite completa de este árbol verificada; resultado al final de este informe. Siguiente: cambio de dirección pendiente y reenvío de verificación, revisando caller locked/secret/cooldown/outbox antes de extraer. S01–S13 y gates externos continúan abiertos. Frontend sin cambio ni nueva ejecución/browser atribuidos a este lote.


B127/O12 verificados (02/10):1451/1451 backend,10213 aserciones,257,75s exclusivamente uvh_test (s01-registration-full-backend.log), exit0.146/1257 contratos dedicados (s01-registration-contracts-final.log) y142/1199 antes del traslado con fuente estable. Pint434/PHPStan0 (s01-registration-quality-final.log), exit0; baseline188→186 hallazgos ignorados,175 entradas, sólo2 return types resueltos eliminados. Inventario448 archivos/2162 funciones con nombre/1130 callbacks/3firmas;448 hashes y117anchors S01 en24archivos/16anchors S03 comprobados. AuthController2880→2637líneas. Diez controles nuevos (6deadline +4activación), sin frontend cambiado ni nueva suite/browser atribuida. S01–S13 siguen abiertos; siguiente revisión de corrección de email pendiente y reenvío de verificación antes de extraer esos flujos. CI billing conocido/gates de producción conservan su estado externo. Sin cambio de uvh_local, migración, proveedor real, worker/scheduler, commit/push o despliegue.


## S01 B128/O13 — corrección/reenvío y rangos de cookie (02/10)

Lectura del código primero: callbacks completos de corrección/reenvío/helperlegacy y lifecycle de mail.15 nuevos controles de cooldown59/60/61 ambos propietarios, fila terminal/cooldown entre preflight-lock, mail no admitido y retry:154/1351 antes,48,59s. B128(P3): sv recortada a999 y anchuras insuficientes para bigint/integer. Red5fallos/2controles,14aserciones,1,31s (s01-registration-database-ranges-red.log); HTTP primera corrección999→1000 correcta y siguiente403. Parser/emisor v3 cubren19PID/10sv, sin recortes; lector v2 vigente conservado. Límites int64/int32 explícitos impiden cast de19dígitos saturar y autorizar otra fila.12deadlines v2/v3 modern/legacy,5rangos,overflow y HTTP antiguo cookie999→nuevo1001 comprobados. Crypto seal v2 y versión de payloadv3 son conceptos distintos; clave/TTL/reloj/cookies base no cambian, no migración.

O13 extrae RegistrationEmailCorrection y VerificationResend sin fragmentar las transacciones; callback/helperlegacy comparados con snapshot.168/1396 antes/después del movimiento (65,67s/53,33s). Luego unifica sólo emisión común pending/legacy (101→64líneas), conserva las comprobaciones de owner específicas y revalida después de lock; final168/1396,47,82s (s01-registration-lifecycle-contracts-final.log). AuthController2637→2488líneas. PHPStan encontró un nullsafe ahora imposible en catch tras guard de owner; sustituido por acceso directo, sin ignore. Calidad437/PHPStan0, baseline186→184 findings (173 entradas), sólo dos return types resueltos eliminados. Inventario450/2163con nombre/1130callbacks/3firmas;121anchors S01/26archivos y16S03. Suite completa habitual verificada, con B129 explícitamente pendiente; evidencia al final. Frontend sin cambio ni nueva ejecución atribuida.


## B129(P2), hallazgo abierto el02/10 — oráculo de existencia al combinar signup/login/corrección

Prueba real sólo uvh_test, mismos cuerpos201 user:null y cookie opaca recibidos por cliente anónimo, sin acceso al buzón ni contraseña correcta: dirección de User verificado y pending ajeno producen login401/corrección403; dirección libre produce login403 reason=pending_registration/corrección200. Por tanto el recibo de signup comunica ocupación mediante sus permisos y respuestas posteriores. No requiere descifrar cookie, SQL ni acceso admin. CAPTCHA/limites encarecen el sondeo pero no eliminan esta diferencia. No implica takeover de cuenta ni bypass de verificación.

Probe exploratorio fuera de la suite habitual: .uvh-runtime/RegistrationEnumerationProbeTest.php; s01-registration-enumeration-probe.log,1fallo esperado/10aserciones,1,42s. Traza concreta {verified:401/403,foreign-pending:401/403,free:403/200}. El full normal verde no cierra B129 ni certifica privacidad de registro. Este hallazgo cambia la siguiente acción: resolver composición de rutas antes de seguir extracciones de reset/forgot. No se transforma el fallo en éxito ni se cierra S01 por los contratos actuales verdes.


O13/B128 verificados (02/10):1480/1480 backend habitual,10386aserciones,258,44s sólo uvh_test (s01-registration-lifecycle-full-backend.log), exit0.29 controles nuevos frente a1451;168/1396 dedicados antes/después/unificados. Pint437/PHPStan0 definitivo (s01-registration-lifecycle-quality-definitive.log), exit0; baseline186→184 findings,173entradas, sin nuevo ignore.450 hashes,121anchors S01/26archivos y16S03 actuales comprobados. AuthController2488líneas; VerificationResend64. Node --check/diff correctos, frontend sin cambio ni nueva ejecución/browser atribuida.

Estado histórico02/10 (sustituido por O14 al final): B129 seguía sin corregir; probe de privacidad compuesto fuera de suite habitual falla1/10aserciones (s01-registration-enumeration-probe.log). Full verde NO incluye ni cierra este nuevo requisito; hay evidencia contraria a privacidad de signup/login/corrección. Próximo bloque corregir el protocolo, luego reset/forgot y restantes S01–S13. Gates de producción/CI billing externos siguen pendientes. Sin migración ni cambio de uvh_local/proveedor/worker/scheduler/commit/push/deploy.


## B129(P2) — composición de registro/login/corrección corregida en código (03/10)

Causa: el recibo cifrado era real para alta libre y señuelo para destino ocupado. Aun con201 idéntico, sus capacidades posteriores distinguían401/403 en login y403/200 en corrección. Se crea ahora registration_attempts para TODOS los desenlaces. La v4 sella el intento/generación/deadline exacto, nunca la cuenta ni el pending. El contexto guarda dirección elegida y sobrevive al consumo del pending, sin adquirir User, contraseña, workspace ni evidencia legal.

La corrección vuelve a comprobar autoridad en TX bloqueada y rota cada ACK, incluido conflicto. Un intento virtual sólo crea un pending nuevo si está libre; un pending propio conserva dirección/bearer al encontrar ocupación. El contexto adopta la dirección solicitada para una corrección siguiente indistinguible. Login orienta por contexto propio para contraseña incorrecta independientemente del ocupante; contraseña correcta conserva sesión/MFA o verificación heredada. Reenvío mantiene200 genérico y cooldown/floor/mail elegible anteriores. La SPA ya no anuncia «Cuenta creada» ni entrega segura en un recibo anónimo.

Compatibilidad: v2/v3 conservan expiración original y namespace pending, con lineage privada del backfill después de activación. Un decoy autenticado se vincula una vez por digest al contexto propio; no adjunta filas preexistentes. Una corrección gasta también la generación pendiente previa y la autoridad legacy. Cookie host-only/HttpOnly/opaca/fixed-length conservada; v4 no se puede usar como legacy aun si IDs coinciden. Mutex de raíz inmutable antes de contexto/pending/bearer; los contextos virtuales no cambian raíz al crear pending. FK SET NULL exige contexto antes del padre en activación y retención.

Pruebas: RegistrationAttemptPrivacyTest26 casos incluye la reproducción original y siete ocupaciones (libre, verified, unverified, deleted, pending ajeno, reserva vigente/caducada), secuencias login/corrección/reenvío/replay, prioridad de contraseña correcta, activación/legacy antes del primer uso y rechazo missing/tampered/expired/deadline. RegistrationAttemptSchemaTest11 comprueba precisión, ausencia de identidad, constraints SQL23514/23505, SET NULL y rollback protector/rebuild/backfill. RegistrationEditDeadlineTest18 cubre versiones2/3/4 × crypto vigente/legacy × -1/0/+1ms. RegistrationEditConcurrencyTest5 usa procesos separados y overlap real para single-use nativo/virtual, activación/edición y retención durante renovación. Mail/audit fail-admission/historial y retry amplían snapshots del contexto; control del pending/bearer ajenos intacto.

## B130(P3) — contexto renovado eliminado por retención mientras esperaba su lock

Detectado durante integración O14, antes de cerrar el lote. El helper genérico seleccionaba IDs con expiry antiguo y eliminaba luego sólo por ID. Otra TX podía renovar la fila mientras el DELETE esperaba y éste la borraba al liberarse el lock, invalidando la cookie recién confirmada. Prueba roja contra el comando real con dos procesos:1fallo/3assert,1,45s (s01-registration-attempt-retention-renewal-red.log); el worker observó una espera real de lock. La purga dedicada repite expiry en el DELETE exterior y conserva la renovación. La retención del padre revalida antigüedad bajo locks ordenados. El patrón genérico en otras tablas renovables queda para conciliación individual S13; no se presenta como corregido globalmente.

Incidencias del harness, no de producto: primera comparación de snapshots usaba identidad de stdClass y falló pese a valores iguales; se convirtió cada fila a array conservando igualdad estricta. El trigger lento inicial retornaba NEW al DELETE y cancelaba artificialmente el borrado; retorna OLD en DELETE y NEW en UPDATE. La prueba de contraseña correcta inicialmente usó «password» mientras UserFactory guarda otro fixture; se utiliza la contraseña real sin relajar login/reason/session. No se aumentan retries ni se esconden fallos. Probes fijan MAIL_MAILER=array y DB *_test; no entregan correo real.

O14/B129/B130 (03/10): intento de registro durable independiente de ocupación, cookie v4 y compatibilidad v2/v3, corrección coherente y single-use para todos los ACK. El aviso de login describe la solicitud; contraseña correcta conserva prioridad. Activación y retención comparten raíz estable/contexto antes de pending; purga conserva una renovación confirmada durante su espera. Probe original B129 ahora es regresión permanente; B130 reproducido rojo y corregido. Suite completa1527/1527 backend,11020aserciones,348,85s sólo uvh_test (s01-registration-attempt-full-backend.log), exit0;47 casos nuevos frente a1480.198/2255 contratos dedicados (98,94s, s01-registration-attempt-contracts-definitive.log). Pint442/PHPStan0 (s01-registration-attempt-quality-final.log), exit0, baseline sin ampliar. Frontend885/885 y lint/tipos/build correctos, sin nueva revisión visual manual/browser de API local. Inventario452/2176con nombre/1134callbacks/3firmas,452hashes y136anchors S01/28archivos más16S03/2archivos verificados; captura actual03/10, nombre histórico02/10. AuthController2488→2438líneas; no se atribuye ahorro de latencia global. Migración aplicada/verificada sólo uvh_test con guard explícito; NO aplicada uvh_local. Esquema y recambio coordinado de código/procesos pendientes antes de usarlo en otro entorno. S01–S13 y objetivo global siguen abiertos; próximo bloque admisión forgot/reset y helpers compartidos, más gates externos/CI billing sin cambio. Sin entrega real, worker/scheduler productivo, commit/push ni despliegue.

Pendientes inmediatos: extraer las admisiones completas de forgot/reset después de caracterizar cooldown exacto, cambios de cuenta entre lookup/lock, bearer usado/caducado/reemplazado, eventos/notice y respuesta current por sesión concreta. Leer admitPasswordChangedNotice/credentialChangeResponse y sus otros callers antes de mover helpers. Se leyó el cuerpo HTTP de esos dos métodos y el adyacente revokeCompromisedAccess; no se acredita aún cierre de esas dependencias/ramas. Revocación protectora audita después del commit: conciliar garantía de evidencia/compensación sin impedir revocar accesos ante caída del audit store. Gate S04 adicional: la copia de URL guardada anuncia24h desde registro, pero hay que contrastarla con la caducidad real del intent; no se atribuye todavía un bug sin reproducción. Proveedores, volumen, coherencia de despliegue/migración y resto de módulos siguen pendientes.


## S01 O15 y S04 B131 — recuperación de contraseña y promesas de caducidad (03/10)

Lectura del código antes de trasladar: forgot/reset completos, helpers de aviso/current y sus consumidores reset/changePassword/completeAccountRecovery/revokeSession/bulk/confirm-email/incident. PasswordRecovery conserva User→bearer bajo lock y todas las escrituras de credencial/generación, sesiones/API, cancelación recovery, notice y exact audit en un único commit. La solicitud revalida dirección/verified/deleted y cooldown60s antes de emitir/sustituir bearer y guardar outbox. HTTP/CAPTCHA, cálculo de hash fuera del lock, floor público y traducción de errores siguen en controller. SecurityIncidentNotice mueve juntos los tres helpers comunes y el callback individual; exige TX, conserva bearer24h/inbox/audit/mail/retención y no captura fallo de admisión. CredentialChangeResponse conserva identidad estricta, extras y cookie sólo del usuario afectado; no concede sesión.

17 caracterizaciones adicionales:59/60/61s con bearer usado/sin usar; dirección/verificación/borrado entre lookup y lock; bearer consumido/kind/dueño/deadline y cuenta borrada/sin verificar/nombre vivo después del preflight; generación9→10 y replay. Se reutilizan contratos ya existentes de expiry exclusivo/current owner/foreign/anonymous, aviso/admisión/audit/history/recovery/pruning/rollback.151/1246 antes (36,96s, s01-password-recovery-contracts-before-final.log) y después (39,80s, s01-password-recovery-contracts-after.log). Estas garantías ya eran válidas: no etiquetar la extracción como vulnerabilidad corregida ni inventar mejora de tiempo. Comparación mecánica de seis cuerpos completos correcta (s01-password-recovery-body-comparison.log). Primer control tuvo7 fallos de fixture: snapshot extranjero de UserFactory aún sin cargar de DB; refresh antes de comparar normaliza campos/timezone. El código de producto no cambió para esa incidencia.

B131(P3), incoherencia de estado/tiempo en copy: onRegister anunciaba otras24h a un enlace cuya expiración ya se fijó en LinkIntentController.issue. El alta no la renueva y el aparcado sólo conserva un bearer con forma válida, sin consultar existencia; la fecha de cookie tampoco garantiza el deadline del recurso original. Dos casos frontend (1min restante y park no confirmado) reproducen la promesa falsa en info/banner. Rojo2fallos/66controles (s04-intent-retention-promise-red.log). ACK unificado sin plazo inventado; contexto indica retomar antes de caducar y verificación condiciona recuperación a disponibilidad. Sin cambios de TTL/cookies/API ni claim. Verde68/68 (s04-intent-retention-promise-green-final.log); primer verde detectó una aserción antigua del título, actualizada conservando la comprobación de contexto visible. No es un bypass de verificación ni cierre del lifecycle S04; otras pantallas/retención y estado caducado requieren revisión propia.

O15/B131 (03/10): PasswordRecovery extrae completas las transacciones de solicitud/reset, SecurityIncidentNotice reúne los avisos de contraseña y sesiones, y CredentialChangeResponse conserva la limpieza de cookie sólo para la cuenta afectada. Seis cuerpos comparados sin cambios de orden/política. AuthController2438→2289líneas; mejora de organización, sin ahorro de latencia/consultas medido.17 nuevas caracterizaciones;151/1246 antes y después. Full1544/1544 backend,11155aserciones,336,31s sólo uvh_test (s01-password-recovery-full-backend.log), exit0. Pint446/PHPStan0 (s01-password-recovery-quality.log), exit0; baseline184→182 findings/171entradas, sólo dos return types resueltos retirados. B131(P3): registro prometía otras24h y disponibilidad de URL sin renovar su deadline ni confirmar existencia. Rojo2fallos/66controles; texto condicionado a caducidad/disponibilidad, sin cambiar TTL/bearer/API; Auth68/68 y frontend887/887, lint/tipos/build correctos. Inventario455/2179con nombre/1134callbacks/3firmas,455hashes y150anchors S01/31archivos más16S03/2archivos comprobados. No nueva revisión visual/browser/E2E atribuida. S01–S13 y objetivo global siguen abiertos; siguientes fronteras: revocación protectora con evidencia recuperable y recuperación de cuenta, luego módulos restantes. CI billing y gates reales externos siguen pendientes. Sin migración, modificación de uvh_local, correo real, worker/scheduler productivo, commit/push ni despliegue.

Próxima acción segura: caracterizar fallo de admisión SQL/PHP y recuperación exact-once del evento auth.emergency_access_revoked, conservando revocación protectora aun sin audit general. Cuerpo incident y AccountDeletionAudit leídos, pero sin prueba nueva de esa frontera; no marcarla corregida ni mover audit a TX ingenuamente (revocación no debe revertirse por caída del outbox). Seguir separación de request/confirm/complete recovery con locks/aprobaciones/bearers/artefactos y sus gates, antes del resto S01–S13. DELETE genérico de housekeeping sobre otros registros renovables sigue como candidato individual, no resuelto por B130 ni por este full.


## O16/B132/B133 — revocación y fallback protector (03/10)

B132(P2) confirmado en código y reproducido: revocación de emergencia confirmaba protección, pero Audit::write posterior al commit podía perder auth.emergency_access_revoked ante fallo de admisión SQL o PHP. Replay400 y dos pasadas reales de housekeeping no lo recuperaban. Rojo definitivo4fallos/48aserciones,1,74s (s01-incident-audit-recovery-red-final.log), cuentas activas/bloqueadas; no bypass de bloqueo ni pérdida de la protección. SecurityIncidentAudit guarda ahora receipt mínimo en commit protector; audit general y DELETE del receipt comparten savepoint. Reconciliación cuenta→receipt,100por pasada, original incident_at/incident_correlation_id, FK SET NULL tras borrar cuenta. Fallback logging contenido; no bearer/hash/password/email/URL ni backfill histórico.

B133(P2) confirmado: AccountDeletionAudit::admit capturaba fallo general, pero su Log::warning podía lanzar otra excepción y revertir la cancelación protectora. Rojo2fallos/4aserciones,1,26s (s02-protective-cancellation-logging-red.log), SQL/PHP combinados con logger roto;200 esperado devolvía500. Warning protegido conserva cancelación/marker y posterior recuperación exacta. No cambia la política estricta de admisiones obligatorias de credenciales.

O16 extrae la TX completa a CompromisedAccessRevocation después del fixB132; comparación mecánica mantiene statements/orden/política salvo wrapper y cast string tras filtro ya existente. Controller2289→2220líneas; organización/tipado, sin ahorro de latencia medido. Receipt INSERT fallido revierte mutación/bearer; audit general caído no lo hace.14 casos de recovery y6 schema, más2 de logger y2 readiness: SQL/PHP/DELETE/historial/rollback/replay/batch101/usuario eliminado/trace original y dos procesos realmente solapados. Dos casos de tabla/columna faltante rechazan readiness; métrica privada uvh_security_incident_audits_pending y alerta15min. YAML validado7 reglas completas únicas, sin promtool ni alerta real atribuida.

Contratos dedicados99/1105,22,28s (s01-incident-contracts-definitive.log), exit0; tras último ajuste sólo se retiró fallback imposible artifacts??[] y su ignore resuelto. Calidad definitiva Pint452/PHPStan0 (s01-incident-quality-final-fixed.log), exit0, baseline182→180 findings/169entradas, sin nuevo ignore. Migración2026_10_03_000002 sólo uvh_test con guard realAPP_ENV/DB; uvh_local sin modificar. Down rechaza receipts pendientes. Inventario457archivos/2183con nombre/1137callbacks/3firmas y158anchorsS01/35archivos más16S03/2archivos; enumeración no equivale a revisión completa.

Incidencias de harness/estático documentadas: primer snapshot comparaba identidad Carbon en vez de scalar DB; primer output de housekeeping debía capturarse con BufferedOutput inmediato. Corregidos sin relajar contrato. PHPStan detectó el fallback imposible y un ignore viejo con path:mixed tras tipar path:string; se eliminaron, sin añadir supresiones. Primer intento de script de limpieza abortó por count supuesto2 y no editó fuente; los99contratos verdes de esa ejecución se conservaron y calidad fallida no se presentó como éxito. Full backend del árbol definitivo verificado después:1568/11349,337,83s y exit0; evidencia detallada al final.

S01–S13/objetivo global abiertos. Recuperación request/confirm/complete se ha leído de nuevo, pero no extraída ni cubierta por nuevas caracterizaciones todavía. Housekeeping stage leído, no todo comando; metrics sólo tramo de gauge, no función completa. Cleanup de artefactos bajo TX exterior y resto de retenciones/roles/proveedores/gates reales conservan requisitos. EsquemasO14/O16 pendientes fuera de uvh_test; recambio coordinado de procesos necesario. CI36950477409 sigue bloqueado por billing previamente verificado. Sin frontend cambiado/nueva suite/browser, correo real, proveedor/worker/scheduler productivo, commit/push/deploy.


O16/B132/B133 verificados (03/10): full1568/1568 backend,11349aserciones,337,83s exclusivamente uvh_test (s01-incident-full-backend.log), exit0;24 controles nuevos frente a1544.99/1105 dedicados,22,28s (s01-incident-contracts-definitive.log), exit0. Pint452/PHPStan0 (s01-incident-quality-final-fixed.log), exit0; baseline182→180 findings/169entradas, dos supresiones resueltas retiradas y ninguna añadida. B132 conserva evidencia recuperable sin revertir revocación por audit general; B133 impide rollback de cancelación por logger de fallback. TX incidente completa comparada tras extracción, AuthController2289→2220líneas; sin latencia/consultas ahorradas medidas. Inventario457archivos/2183con nombre/1137callbacks/3firmas,457hashes y158anchorsS01/35archivos más16S03/2archivos comprobados tras full. YAML7reglas completas únicas validado, Node--check/diff correctos; no promtool/monitorización real atribuida. Migración2026_10_03_000002 aplicada sólo uvh_test con guard; uvh_local intacta, sin backfill histórico. Frontend sin cambio/nueva ejecución/browser atribuidos. S01–S13/objetivo global activos: siguiente separación request/confirm/complete recovery con caracterización previa y resto de funciones/roles/gates externos pendientes. CI billing conocido permanece externo. Sin proveedor real, worker/scheduler productivo, commit/push/deploy.


## S01 O17/B134 — separación de recuperación y aislamiento del navegador (03/10)

Turno anterior O16/B132/B133 clasificado progreso verificado: full1568/11349 y fuente modificada. Este lote revisa directamente request/confirm/completeAccountRecovery, AccountRecoveryRequest, AccountRecoveryLifecycle, listado/decisión admin y eligibleLockedAdminSession, elegibilidad mail accountRecovery, caller SPA/decoders/AuthService.accountSignedOut y PrivateArtifactCleanup. Dependencias S02/S11/S13 no equivalen a cierre de sistemas completos; no atribuir lectura de todo MailDeliveryEligibility ni AuthService.

29 nuevas caracterizaciones antes de extraer: request59/60/61s y cuatro cambios email/bloqueo/verified/MFA entre lookup-lock; confirm siete cambios hash/owner/status/version/bloqueo/verified/MFA; complete14 cambios de roles/MFA/verified/bloqueo de aprobadores, approval set removido/reemplazado, ownergen/bloqueo/verified/MFA, case status/hash/deadline y bearer deadline. Outer rollback con gen9→10/retry/replay, sin artefacto físico. Contratos103/765 antes (23,16s, s01-account-recovery-contracts-before.log) y103/765 después (36,29s, s01-account-recovery-contracts-after-extraction.log), exit0. Cambios deterministas en API real, sin nueva prueba multiproceso de recuperación; no presentarlos como concurrencia PostgreSQL real.

AccountRecoveryAdmission mueve tres TX completas, comparación mecánica de cuerpos/callbacks después de Pint. Wrapper result y appUrl→FrontendUrl::base existente, sin cambiar policy/SQLorder/locks/avisos/exact audit. Todas las cuentas conocidas en ordenID→case para complete; approval set cambiado no adquiere lock tardío. Credenciales/retirada admin-MFA/revocación/operaciones/bearer/notice/audit en mismo commit. HTTP/hash/input/CAPTCHA/resultados/cleanup externo quedan en controller. Resultado union documenta statuses. JsonResponse3 métodos; sólo3 ignores de return resueltos retirados:180→177 findings/166entradas. AuthController2220→1985líneas; organización/tipado, sin latencia ni consultas ahorradas medidas.

B134(P3) confirmado después de extracción, no confundido con refactor: complete siempre emitía clearCookie, incluso browser ajeno o anónimo. RojoAPI2fallos/1control/9assert,1,57s (s01-account-recovery-cookie-red.log). La SPA sólo decodificaba ok/message y no reconciliaba identidad local; aceptaba current faltante/no booleano. Ocho controles nuevos: rojo5fallos/3controles (s01-account-recovery-identity-frontend-red-definitive.log). Fix usa CredentialChangeResponse tras commit: current booleano y cookie sólo propia. Decoder recovery compone validadores existentes. SPA captura generación y reconcilia sólo current antes de guard de UI; destroy no deja credenciales visuales nuevas y AuthService real conserva identidad posterior ante ack tardío. No takeover ni revocación de sesiones ajenas en servidor; bug de aislamiento del navegador/estado local.

Final dedicado139/991,36,63s (s01-account-recovery-contracts-final.log), exit0, incluye32 casos nuevos y controles de email/incident/notice/decisión/deadlines/delivery. Frontend dedicado50/50 (8nuevos+42async), s01-account-recovery-identity-frontend-green.log, exit0. Pint454/PHPStan0 (s01-account-recovery-quality-final.log), exit0. Tipos/build y fullfrontend895/895 correctos; lint inicial detectó una expresión ternaria de assert sólo en test, corregida por if/else tras terminar backend. Full backend definitivo1600/11589,338,08s; frontend y lint/tipos/build definitivos reejecutados después, todos exit0. PHP intacto tras full.

Harness: primer intento de escribir spec usó path relativo con frontend duplicado y no creó archivo; include vacío ejecutó0casos/exit1 (s01-account-recovery-identity-frontend-red.log), no evidencia de bug ni éxito. Spec correcto produce5fallos/3controles. Lint detecta ternario de assert, sin fallo de producto, no relajar regla. Calidad/static y reproducción API verificadas. No nuevo browser visual/E2E/proveedor real; no cambiar esquema/uvh_local, workers/scheduler/commit/push/deploy. Frontend/servidor deben coordinar nuevo current; no fallback que dé por válida respuesta incompleta.

Inventario458archivos/2187con nombre/1137callbacks/3firmas;458hashes y176anchorsS01/42archivos más16S03/2archivos comprobados tras full, sin cerrar global por esas cifras. Cleanup de artefactos sigue frontera pendiente: filesystem no revierte con TX exterior; logging/metrics de fallback pueden lanzar y deben reproducirse por caller antes de cambiar. Resto Auth/S01–S13/roles/volumen/proveedores/gates reales permanece abierto. CI billing36950477409 sin cambio externo.


O17/B134 verificados (03/10): full1600/1600 backend,11589aserciones,338,08s exclusivamente uvh_test (s01-account-recovery-full-backend.log), exit0;32 casos nuevos frente a1568.103/765 antes/después del traslado,139/991 dedicado final,36,63s; Pint454/PHPStan0 (s01-account-recovery-quality-final.log), exit0. Baseline180→177 findings/166entradas, sólo3 retornos resueltos eliminados. AccountRecoveryAdmission conserva tres TX completas comparadas; AuthController2220→1985líneas. B134 cookie sólo propia/current booleano y SPA con generación/validación/destruction/nueva identidad: redAPI2fallos/1control, redfrontend5fallos/3controles;50dedicados pasan. Fullfrontend895/895 definitivo (s01-account-recovery-full-frontend-definitive.log), lint/tipos/build definitivos exit0. Lint inicial señaló ternario de assert; sustituido por if/else sin relajar regla ni tocar PHP. Inventario458archivos/2187con nombre/1137callbacks/3firmas;458hashes y176anchorsS01/42archivos más16S03/2archivos verificados tras full. Node--check/gitdiff--check correctos. Sin ganancia de latencia/SQL medida ni nueva concurrencia multiproceso/QA visual/E2E/proveedor atribuida. No nueva migración/uvh_local/worker/scheduler/commit/push/deploy. Objetivo yS01–S13 abiertos; siguiente frontera cleanup físico/fallback en callers Auth y resto de mutaciones/lecturas/frontends/roles por función. CI billing conocido y gates reales externos mantienen estado.


### O18 — cleanup de exportaciones y diagnósticos auxiliares (03/10)

Hallazgos confirmados al leer código y reproducir la frontera en `uvh_test`:

- **B135 (P2): borrado físico anterior al commit exterior.** Incidente, recuperación y cancelación abrían una transacción anidada de limpieza después de su transacción de negocio, pero el archivo se borraba aunque después revirtiese la exterior. Seis casos API con artefacto realmente cifrado fallaban antes. Los callers HTTP de Auth/Account/Admin usan ahora `afterCommit`; bajo bloqueo se revalidan estado terminal y ruta esperada. Un rollback exterior o de savepoint conserva el archivo. El método booleano `attempt` de workers sigue informando del resultado inmediato real, sin fingir éxito por haber programado un callback.
- **B136 (P2): un log fallido convierte una protección confirmada en 500.** El disco rechaza DELETE y el fallback de cleanup lanza; credenciales/bearer/revocación ya están confirmados, así que el reintento no repite esa protección. El diagnóstico queda contenido y la fila cancelada conserva la ruta concreta hasta el reintento. Cuatro variantes incidente/recovery, con métricas disponibles/ausentes, fallaban antes. No se oculta una pérdida de archivo ni se borra el puntero sin confirmación de almacenamiento.
- **B137 (P2): fallback de métricas no auxiliar.** `logFailure` reiniciaba su guarda en finally pero dejaba escapar el error de Log, incluso desde middleware o callback posterior al commit. Se contiene el transporte fallido y batch captura errores al registrar afterCommit, como increment. Seis controles de single/batch inmediato, commit y rollback, con SQL y Log fallidos, comprueban resultado de negocio, reinicio de la guarda y recuperación del contador. No se afirma una nueva reproducción específica del fallo al registrar callbacks.
- **B138 (P2): exportación lista/aviso sin admisión de auditoría.** El evento exacto `account.data_export_ready` se escribía fuera de la TX de publicación. `Audit::write` absorbe el fallo fuera de TX: dos repros PHP/SQL confirman ready, archivo y aviso presentes con cero evento, sin excepción. No confundirlo con archivo perdido o ready sin puntero: eso no ocurrió en estos repros. Ahora la admisión exacta comparte commit con ready/notificación/mail. Ante el fallo se revierte la publicación y la generación se puede reintentar; el segundo intento produce un archivo y un evento.

Control suplementario: callbacks obsoletos ready/processing/ruta cambiada/fila ausente, selección de retry que cambia antes del lock, rollback de savepoint, resultado de worker, puntero que no pudo limpiarse, cuatro rutas inválidas con logger roto y dos pasadas reales de retención por housekeeping. Todos esos vectores usan fixtures aisladas; no equivalen a multiproceso o volumen de producción.

Verificación dedicada final:123/123,869 aserciones,30,51s (`s01-artifact-contracts-final.log`), exit0. Calidad Pint456/PHPStan0 (`s01-artifact-quality-definitive.log`), exit0; baseline177 findings/166 entradas sin nuevos ignores. Suite completa posteriormente verificada:1631/11741,357,71s; ver nota final O18. Fuente de producto no modificada durante suites.

Límites y transparencia: el primer intento de pruebas tenía un mock que impedía restaurar una tabla de métricas; el esquema fixture se restauró con guard APP_ENV=testing/DB exacta uvh_test. Sólo el rojo definitivo se usa como evidencia:6 borrados prematuros y4 errores500; B138 se caracterizó después en2 repros con13 aserciones. Cuatro controles extra usaron inicialmente dos exports activos del mismo usuario, rechazados por el índice; fixture cambiada a otro dueño. El primer control housekeeping omitía su ciclo heavy; dos pasadas finales fuerzan retención. No son bugs adicionales de producto. La sospecha de puntero perdido en failTooLarge no se confirma: sus límites se disparan antes de escribir el archivo. failed/failTooLarge todavía escriben su evento fuera de TX y requieren reproducción/política propia; otros stages, callers, locks y rotación mantienen gates. Ningún cierre universal S02/S13 por este bloque.

No cambio frontend ni nueva suite895/QA visual atribuida; sin migraciones/uvh_local/proveedor real/worker o scheduler productivo/commit/push/despliegue. Resto Auth y objetivo global S01–S13 siguen abiertos. Continúa caracterización y separación gradual de cambios autenticados, manteniendo TX de autoridad completas.


O18/B135–B138 verificación final (03/10): full1631/1631 backend,11741 aserciones,357,71s exclusivamente uvh_test (`s01-artifact-full-backend.log`), exit0;31 controles nuevos.123/869 dedicado final y Pint456/PHPStan0 definitivos, exit0. Baseline177 findings/166 entradas conservado sin nuevos ignores. Inventario458 archivos/2190 funciones con nombre/1138 callbacks/3 firmas;458 hashes y192 anchors S01/45 archivos más16 S03/2 archivos comprobados tras full. Node--check y gitdiff--check correctos. No edición de PHP/tests durante suite ni cambio frontend/migración/uvh_local/proveedor real/worker o scheduler productivo/commit/push/deploy. La revisión global y gates reales siguen abiertos; siguiente caracterización/separación de contraseña autenticada, email y MFA con TX completas, más fronteras export pendientes.


### O19 — separación de cambio de contraseña autenticado (03/10)

Código de changePassword releído completo, con SecurityContext, MfaStepUp, lifecycle de casos y notice/auditoría compartidos. Se extrae la única TX a `Support/Auth/AuthenticatedPasswordChange::admit`. Validación/preflight, hash bcrypt costoso y respuestas/catches permanecen en AuthController. La comparación mecánica del cuerpo anterior con el trasladado, repetida tras format, conserva todas las sentencias y su orden; sólo adapta lockActiveSecurityContext a SecurityContext::lock y sus propiedades. No nuevo cambio de política de MFA, cookie, API/TTL ni revocación de tokens: conserva exactamente el alcance anterior de esta operación.

18 caracterizaciones nuevas:14 estados SQL cambiados después de hidratar el snapshot y antes del lock (bloqueo/generación/hash/identidad y sesión revocada/caducada/en igualdad/otra versión/otro dueño/frescura, recovery retirado y MFA recién activado),2 outer commit/rollback con retry y2 éxitos password_only/recovery. El hook QueryExecuted del last_used_at existente no modifica código productivo y no se presenta como prueba multiproceso. Carbon de la fixture fija la igualdad expiresAt; el reloj TOTP de producción no cambia. En éxito se comprueba hash a transactionLevel0 y orden account antes de session; el hash real sigue calculándose por el driver. Outer rollback conserva credencial/code/bearer/case/sesiones; notice, mail y ambos eventos (security_notice_admitted y password_change) se admiten en TX y queue/materialización esperan commit.

No se asigna nuevo B: la caracterización definitiva93/873 pasa antes (19,32s) y después (22,95s), sin modificar comportamiento. El primer intento tuvo5 fallos de fixture: MFA recién activado con sesión nunca verificada da409, no403; hay2 eventos de auditoría, no1; un partialMock sin constructor perdía configuración de HashManager. Corregidos contra fuente, conservando driver real mediante proxy y sin relajar garantías. Esos fallos no son bugs de producto. Contratos previos PasswordNoticeAtomicity/SecurityNoticeAtomicity/CredentialStepUp siguen incluidos.

AuthController1985→1937líneas. JsonResponse explícito permite retirar sólo el ignore missingType.return de changePassword: baseline177→176 findings y166→165 entradas, ninguna supresión añadida. Pint458/PHPStan0 (`s01-password-change-quality.log`), exit0. Full posteriormente verificado1649/11925; ver nota final O19. Organización y mantenibilidad mejoran, sin ahorro de latencia/SQL medido.

Frontend sin cambios/nuevas pruebas/QA visual atribuida; sin migración/uvh_local/proveedores reales/worker/scheduler productivo/commit/push/deploy. La revisión global sigue activa: request/cancel/confirm email leídos para próxima caracterización/separación, más MFA/lecturas/resto S01–S13 y gates reales. Export failed/failTooLarge, volumen y proveedores conservan gates propios.


O19 verificación final (03/10): full1649/1649 backend,11925 aserciones,310,68s sólo uvh_test (`s01-password-change-full-backend.log`), exit0;18 controles nuevos.93/873 antes (19,32s) y después (22,95s), exit0. Comparación del cuerpo trasladado repetida tras format conserva orden/policy; AuthController1985→1937líneas. Pint458/PHPStan0 (`s01-password-change-quality.log`), exit0; baseline176 findings/165 entradas, sólo1 ignore resuelto retirado. Inventario459 archivos/2191 funciones con nombre/1138 callbacks/3 firmas;459 hashes y196 anchors S01/46 archivos más16 S03/2 archivos verificados después de full. Node--check/gitdiff--check correctos. No PHP/tests editados durante suites, ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Fuente de los tres flows email releída para siguiente fase; posible deadlock al intercambiar reservas sigue candidato sin B/prueba, se reproducirá con dos procesos antes de corregir. Auth/S01–S13 y gates globales continúan abiertos.


### O20 — separación del cambio de email y B139 (03/10)

**B139 (P2, disponibilidad): deadlock entre reservas activas cruzadas.** Dos cuentas con destinos ya reservados solicitan el destino de la otra. Cada transacción autorizaba el factor, tomaba un mutex distinto y borraba su reserva antes del INSERT. Los índices únicos aguardaban el DELETE de la otra transacción: dos procesos reales, dos step-ups y DELETEs confirmados, pg_blocking_pids recíprocos y SQLSTATE40P01; respuestas409+500. El repro definitivo previo falló1/6 (2,45s) y después de la extracción seguía fallando1/6 (2,37s). Esta evidencia confirma disponibilidad, no corrupción o toma de cuenta.

Ahora EmailChangeAdmission::request comprueba la reserva ajena vigente tras step-up y advisory, antes de cualquier DELETE. Una excepción controlada revierte también freshness, preserva la reserva anterior y el recovery code, y se traduce al mismo409/cuerpo de23505; el constraint SQL permanece como guard final. Expiry usa >now para reserva viva; igualdad permite reclamar. El comentario del mutex ya no promete ausencia global de ciclos entre direcciones diferentes.

O20 separa las TX completas request/cancel/confirm; controller retiene input/preflight/token/url/HTTP. Comparación de los tres cuerpos tras format confirmó sólo la adaptación SecurityContext. AuthController1937→1782líneas. Tres JsonResponse explícitos permiten retirar exclusivamente los tres ignores resueltos: baseline176/165→173/162, sin supresiones nuevas. No se mide ganancia de latencia/SQL.

22 caracterizaciones nuevas cubren expiry -1/0/+1, cancel con/sin pendiente, siete cambios después del lookup, conflictos User/Pending, seis outer commit/rollback/retry y factor erróneo con/sin reserva.105/810 antes (21,55s) y después (21,40s), exit0. Final106/823 (27,44s) incluye el caso nativo verde:409+409,sin ciclo, reservas/códigos/generación conservados, sin mail/notification. Freshness original tras conflicto comprobada en una petición real. Pint463/PHPStan0, exit0. Full backend todavía en curso; filtros no lo acreditan.

Transparencia: primera fixture concurrente no emitía UPDATE por timestamp del mismo segundo; se corrigió a10s anterior. Primeras caracterizaciones mezclaban ruta frontend/API y fechas Eloquent sin refrescar; corregidas antes del verde definitivo. Tras extracción, ocho fallos detectaron un import EmailToken ausente; corregido y repetido con105/810. Estos errores de implementación/fixture no son bugs nuevos del producto previo. No edición PHP/tests durante suites. Sin frontend, migración, uvh_local, proveedor real, worker/scheduler productivo, commit/push/deploy. Auth/S01–S13 y gates reales siguen abiertos.


O20 verificación final (03/10): full1672/1672 backend,12108 aserciones,307,24s sólo uvh_test (`s01-email-change-full-backend.log`), exit0;23 controles nuevos (22 caracterizaciones y1 native concurrency).105/810 antes (21,55s) y después del traslado (21,40s);106/823 final (27,44s), exit0. B139 deadlock cruzado40P01 reproducido con dos procesos y corregido; ambos409, sin ciclo, reservas/recovery conservados; freshness rollback comprobado. Tres TX completas comparadas antes del fix; import ausente detectado por8 fallos durante traslado, corregido antes del definitivo. AuthController1937→1782líneas. Pint463/PHPStan0 (`s01-email-change-quality.log`), exit0; baseline173/162, sólo3 ignores resueltos retirados. Inventario461 archivos/2194 funciones con nombre/1138 callbacks/3 firmas;461 hashes y199 anchorsS01/47archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. Sin PHP/tests edits durante suites, frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Siguiente MFA/lecturas y demásS01–S13/gates reales; goal abierto.


### O21 — separación de configuración MFA (03/10)

MfaConfigurationAdmission posee las cinco TX completas setup/enable/cancel/regenerate/disable. AuthController conserva validación, generación/cifrado antes de locks, preflight/HTTP/catches y presentación inicial de códigos. Comparación mecánica tras format: mismos cuerpos y orden salvo adaptación al objeto SecurityContext. AuthController1782→1604líneas; cinco JsonResponse explícitos permiten retirar sólo cinco ignores resueltos: baseline173/162→168/157. Pint465/PHPStan0, exit0. No ahorro de latencia/SQL medido ni bug nuevo atribuido por esta separación.

42 caracterizaciones nuevas en peticiones reales:30 cambios tras hydrate (seis variantes, incluyendo first/reconfigure, por blocked/revoked/expiry igualdad/session-version/foreign) y12 outer commit/rollback. La autoridad SQL viva impide mutar después de revocación; factor/pending/codes/SV/propia sesión/otras revocadas/case/mail/exact audit comparten los commits originales. Recovery/setup/cancel admiten retry después de rollback; enable/reconfigure conservan el TOTP gastado fuera de SQL y rechazan replay.146/1430 antes31,00s y después36,04s, exit0, sin errores de fixture. Fullbackend en curso; estas pruebas no acreditan la suite completa ni concurrencia multiproceso.

La sospecha de500 por falta de catches locales se descartó al leer bootstrap/app.php: el handler global ya renderiza MfaInfrastructureUnavailable503. Cancel protege sólo el factor pendiente, sin desactivar el activo; disable conserva prohibición admin; regenerar reemplaza el conjunto sin consumo separado. Sin migración, frontend/UI nueva, DBlocal, provider/worker/scheduler real, commit/push/deploy. Clock distribuido, TOTP storage/provider real, enrolment visual, reautenticación/lecturas/revocaciones restantes y S01–S13 mantienen gates propios.


O21 verificación final (03/10): full1714/1714 backend,12722 aserciones,325,82s sólo uvh_test (`s01-mfa-configuration-full-backend.log`),exit0.42 caracterizaciones nuevas;146/1430 antes31,00s y después36,04s,exit0, sin fallos de fixture. Cinco TX completas comparadas después de format; sólo adaptación SecurityContext. AuthController1782→1604líneas. Pint465/PHPStan0 (`s01-mfa-configuration-quality.log`),exit0; baseline168/157, sólo5 ignores resueltos retirados, sin nuevos. Inventario462 archivos/2199 funciones con nombre/1138 callbacks/3 firmas;462 hashes y211 anchorsS01/48archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. No PHP/tests edits durante suites ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. No nuevo bug ni ganancia de latencia/SQL medida en O21. O20+B139 y O21 suman65 controles nuevos. Continúa reautenticación/perfil/reads/revocaciones y restoS01–S13/gates externos; objetivo activo.


## S01 — O22/O23: reautenticación, perfil y lecturas de cuenta

O22/O23 verificados (03/10): full backend 1724/1724, 12910 aserciones, 334.17s exclusivamente uvh_test, exit0 (`s01-account-separation-full-backend.log`). Diez casos nuevos frente a O21: seis outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio. Filtros O22 55/386 antes/después, O23 60/292 antes y conjunto final105/596 (20,08s), todos exit0. Pint469/PHPStan0; baseline168/157→162 findings/151entradas, sólo seis ignores resueltos retirados. AuthController1604→1469líneas; cuatro módulos nuevos con dos TX completas y cuatro proyecciones/contexto de lectura. Comparación mecánica tras format conserva SQL/policy/payload. Inventario466 archivos/2206 funciones con nombre/1138 callbacks/3firmas;466 hashes y224 anchorsS01/52archivos más16S03/2 comprobados después del full. Node--check y gitdiff--check correctos. No PHP/tests editados durante suite ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Sin nuevo bug ni ahorro de SQL/latencia medido. Objetivo/S01–S13 abiertos; siguiente bloque revocación de sesiones según plan, con política de logout preservada.

ReauthenticationAdmission y ProfileAdmission poseen cada transacción completa: autoridad viva y evento exacto comparten commit. La primera renueva freshness con password/factor y conserva recuperación/replay; la segunda actualiza sólo nombre. No se introduce rotación, revocación ni factor adicional para perfil. AccountReadContext se resuelve por petición, sin locks de commands; AccountQueries conserva minimización, scopes, límites100/20 y truncación. Sus consultas sucesivas no garantizan un snapshot serializable de toda la respuesta.

Incidencias de harness: primera ejecución O23 falló en cuatro casos por esperar cero cookies sin enviar CSRF; el middleware era correcto. Fixture corregida antes del verde60/292. Un script de retiro baseline abortó ante match de WorkspaceController::rename; filtro exacto retira sólo cuatro AuthController entries y conserva rename. Se registraron también errores del rebase documental sin cambios de producto. Hipótesis de failover TOTP descartada para producción permitida: el guard existente rechaza CACHE_STORE=failover; no se certifican por ello otros despliegues ni toda S13.

Las pruebas de admisión y lectura pasan antes y después del traslado; no son bugs nuevos. No hay nuevo gate visual/frontend, proveedor ni despliegue. CI histórico bloqueado por billing y los demás gates reales conservan su estado pendiente, sin nueva consulta/rerun.


## S01 O24 / S10 O25 — sesiones y notificaciones

El bloque añade69controles:15 de revocación y54 de notificaciones.134/1007 dedicado definitivo (37,75s), Pint471/PHPStan0,exit0; full final en curso, los filtros no lo sustituyen. Tres transacciones completas de revocación se compararon tras traslado; AuthController1469→1408líneas y baseline162/151→161 findings/150entradas, retirando sólo el retorno resuelto. Logout conserva su política protectora ante fallo de audit.

| ID | Prioridad | Defecto reproducido en código previo | Cambio y evidencia local |
| --- | --- | --- | --- |
| B140 | P2 | NotificationPreferences confirmó preferencias/retirada de resumen y después admitió audit fuera del commit. Audit ausente/interrumpido devolvía200 con cambios sin evidencia. | Evento exacto en la misma TX, incluso para callers internos sin wrapper HTTP. Dos casos API y dos bare rojos; historial conserva éxito/evidencia recuperable, outer rollback/retry comprobados. |
| B141 | P2 | Seis rutas de notificaciones usaban snapshot de hydrate; una sesión/cuenta invalidada mientras la petición ya estaba en curso seguía leyendo datos o marcando/cambiando filas. | GET revalida contexto SQL sin locks y responde401; commands revalidan cuenta/sesión verificada bajo lock en su TX y responden409.42 cambios reales tras hydrate, sin cookies retiradas/efectos ante rechazo. No es bypass para nueva petición con cookie revocada. |
| B142 | P3 | Dos filas del mismo kind se reducían a la última antes de validar; podía ocultarse una entrega inválida o decidir canal silenciosamente. | Duplicados422antes de escribir; dos casos rojos. Avisos obligatorios conservan entrega fija, sin nuevo step-up. UI actual emite un único entry. |

Rojo original46fallos/3controles,120aserciones,17,28s. Rojo bare B1402fallos/1control,9aserciones,1,58s, restaurando sólo el cuerpo previo después de cerrar handles y recuperando fix antes de seguir. Rojo consultas2fallos/3controles,23aserciones,2,02s. Vista de preferencias reducida13SELECTs de delivery→1scoped por cuenta en GET y PATCH; tests miden consultas del request y preservan catálogo/mandatory/owner. No se mide ni promete mejora de latencia o una query total para toda petición.

Primer filtroO24falló3casos porque la fixture esperaba200para request NUEVA unverified; hydrate rechaza/revoca401como debe. Fixture corregida para snapshot ya autorizado antes de cambiar email, preservando requireVerifiedEmail=false de la revocación protectora.66/604 antes20,06s y después18,79s. No fallo de producto ni relajación de hydrate.

Inventario467archivos/2211funciones con nombre/1141callbacks/3firmas; ledgerS01 225anchors/53files yS03 16/2 rebasados, nuevo [ledgerS10](superpowers/plans/2026-10-03-s10-function-review-ledger.md)29anchors/5files. Fuente/test PHP estable durante full uvh_test; hashes/anchors se verificarán de nuevo al terminar. Source completo de NotificationController, NotificationPreferences, NotificationInbox, NotificationKinds y UvhNotificationsDigest leído, sin acreditar otros productores por conocer catálogo/helpers. Digest bajo test incluye201cuentas y claims/dedupe/retirada/admisión; no worker/scheduler real ni prueba nativa de todas las interacciones.

Sin frontend modificado/nueva suite/browser/E2E, migración/uvh_local/proveedor real/worker/scheduler productivo/commit/push/deploy. Gates S01–S13/globales abiertos; consumidores async de UI y elegibilidad/retención del digest conservan revisión pendiente. CI billing conocido no reconsultado ni rerun.


O24/O25 verificados (03/10): full1793/1793 backend,13590aserciones,369,85s exclusivamente uvh_test (`s10-notification-session-full-backend.log`),exit0;69controles nuevos respecto a1724 (15revocación+54notificaciones).134/1007 dedicado final37,75s y Pint471/PHPStan0,exit0. B140(P2) exact audit preferencias en su TX, también bare callers; B141(P2) seis rutas revalidan cuenta/sesión y verified,401GET/409command sin datos/cookies/cambios ante42invalidaciones tras hydrate; B142(P3) duplicate kind422sin cambio. Rojo API46fallos/3controles,120aserciones,17,28s; bare2fallos/1control,9aserciones,1,58s; consultas2fallos/3controles,23aserciones,2,02s. Vista reduce13SELECT delivery→1scoped por cuenta en GET/PATCH, sin atribuir latencia ni una sola query total HTTP. O24tres TX completas comparadas tras format;66/604antes20,06s/después18,79s, policy/logout intactos. AuthController1469→1408líneas; baseline162/151→161findings/150entradas, sólo1retorno resuelto retirado sin nuevos ignores. Inventario467archivos/2211funciones con nombre/1141callbacks/3firmas;467hashes y225anchorsS01/53files+16S03/2files+29S10/5files comprobados después de full. Node--check/diff correctos. No PHP/tests edits durante suites ni frontend/nueva suite/browser/E2E/migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. S01–S13/objetivo global abiertos; siguiente UI de notificaciones ligada a identidad, todavía candidato sin ID, más productores/retención/gates reales y CI billing histórico pendiente sin nueva consulta.


## S10 O26 — identidad de las vistas y respuestas fuera de orden

Lectura completa de ApiService/interceptor/NotificationService/LatestRequest/OwnedMutations, funciones de identidad relevantes de AuthService y handlers/constructor/cleanup relacionados de Settings. Ningún guard global descarta éxitos viejos: la UI debe decidir si la operación sigue siendo suya. Settings completo y demás callers no quedan acreditados por esta lectura acotada.

| ID | Prioridad | Fallo reproducido | Corrección y prueba |
| --- | --- | --- | --- |
| B143 | P2 | loadNotificationPreferences y setNotificationDelivery publicaban preferencias, errores y éxito tras logout/reemplazo A→B→A o destrucción. El finally viejo podía liberar una escritura nueva. | LatestRequest con accountContext y revisión; efecto de identidad limpia DTO/flags, recarga actual y callback destroy invalida. Rojo componentes y HTTP con AuthService/ApiService/NotificationService/interceptor/decoder reales. PATCH enviado no se cancela al destruir. Es confusión local de UI, no prueba de lectura de otra cuenta por el servidor. |
| B144 | P3 | Una carga lenta devolvía preferencias anteriores después de una carga o guardado más nuevo; error/finally viejos afectaban al loading nuevo. | Sólo la revisión actual publica; PATCH invalida GET anterior, GET no compite durante busy. Dos controles extra de error/finally y cancelación HTTP de la lectura. No ganancia de latencia medida. |
| B145 | P2 | NotificationsComponent protegía respuestas pero conservaba items/cursor/error del usuario anterior; una operación invalidada no liberaba busy y bloqueaba nuevas cargas. | Reset al cambiar ID/generación, recarga actual fuera del tracking del effect. Casos de paginación/read/read-all mantienen loading de B frente a finalización de A; HTTP real simulado y QA instrumentada con fixture. |

Evidencia: `.uvh-runtime/s10-notification-ui-red.log`12fallos/47controles; `s10-notification-ui-http-red.log`3fallos/1control. Definitivo `s10-notification-ui-dedicated-final.log`72/72 y `s10-notification-ui-full-frontend.log`916/916 (4,599s Karma,4,288s ejecución),exit0. Son21controles nuevos respecto a895, no21bugs. `s10-notification-ui-lint-final.log`, `s10-notification-ui-types.log`, `s10-notification-ui-build.log`,exit0; build6,025s.

QA: app development en4216 con proxy exclusivamente al servidor Python ficticio8416, sin conexión Laravel/DB. Auth.accountSignedOut y Auth.me reales invocados desde herramienta de depuración, no login UI/cookie real; capturas inspeccionadas de A, snapshot vacío y B prueban aislamiento de vista. Guardado operativo observado (PATCH200 fixture), categoría mandatory fija. Capturas: `.uvh-runtime/s10-browser/inbox-a.png`, `inbox-cleared.png`, `inbox-b.png`, `preferences.png`. `preferences-mobile-390.png`captura perfil tras resize, width390/overflowfalse; no acredita filas de preferencias mobile. Vídeo falló al exportar por ffmpeg ausente; no se acredita vídeo. Mocks CLI iniciales no interceptaron endpoints, luego se usó servidor local sin DB. Un perPage10 de fixture no concordaba con default5 de Privacy: muestra rechazo de decoder ajeno y no se atribuye bug de producto ni gate a Privacy. Errores JS consultados: vacíos. CLI wait glob y await top-level dieron errores de herramienta; transición B completada con función async y capturas, no fallo del producto. Servidor/browser propios cerrados; sesión previa uvh-quality intacta.

O26 verificado (03/10): B143(P2) preferencias/errores/snackbar de sesión anterior o vista destruida, B144(P3) GET antiguo sobrescribía lectura/guardado más nuevo y liberaba loading ajeno, B145(P2) inbox visible y busy heredados entre identidades. LatestRequest propia de preferencias, identity/revisión en todos los efectos, reset de DTO/flags en identity/destroy; bandeja limpia/recarga contexto actual. GET cancelable, PATCH ya despachado sigue vivo.21 controles frontend nuevos:12fallos/47controles rojo componentes,3fallos/1control rojo HTTP real simulado;72/72 dedicados y916/916 full frontend,exit0. Lint final/tipos/build exit0. QA desktop con fixture aislada demuestra A→sin identidad→B y guardado operativo/mandatory fijo; no E2E con backend real ni login real. Mobile390 sólo overflow general de Settings=false, captura en perfil, no gate mobile de preferencias. Vídeo no generado por ffmpeg ausente; capturas inspeccionadas. Inventario467archivos/2216con nombre/1144callbacks/3firmas;467hashes y225S01/53files+16S03/2files+63S10/9files verificados. Backend fuente sin cambio:1793/13590 yPint471/PHPStan0 de O24/O25 siguen evidencia anterior, sin nueva ejecución atribuida. Baseline161/150/controlador1408 sin cambio. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13/gates reales siguen abiertos; O27 examinará despacho de mutaciones tras CSRF y generación durante logout, aún candidatos sin ID. CI billing histórico sin nueva consulta.


## S01/S03/S13 O27 — intención de comando frente a espera CSRF

Lectura directa de ApiService completo, AuthService completo (sin cerrar todo por esa lectura), WorkspaceService, interceptor y pruebas de frontera. ApiService construía/subscribía la mutación después de await y el interceptor tomaba entonces el workspace activo; Auth sólo protegía muchos resultados después del envío. El reloj era un número fuera del sistema reactivo.

| ID | Prioridad | Fallo reproducido | Corrección y límites |
| --- | --- | --- | --- |
| B146 | P1 | POST/PATCH/DELETE/postBlob de A se enviaban después de que bootstrap CSRF o refresco terminase bajo la nueva identidad; incluso una cookie presente cede un microtask. /me también puede publicar B sin incrementar epoch. | Captura epoch e ID compartidos antes de cualquier await y guarda inmediatamente antes de cada dispatch y antes de refrescar por csrf_rejected. Error local409/request_context_changed sin enviar viejo payload. La matriz de métodos prueba transporte con HTTP simulado; no prueba admisión/roles/backend de cada ruta ni bypass CSRF. |
| B147 | P1 | Un intento tenant esperaba CSRF, usuario seleccionaba B, el interceptor añadía X-Workspace-Id de B al payload iniciado en A. Volver a A no distinguía una selección nueva. | Mismo catálogo tenant para interceptor/API; ID yrevisión monotónica de WorkspaceService, sólo cuando selección normalizada cambia. Scope de cuenta no se invalida por mero cambio de workspace. Reseleccionar mismo ID no invalida. No autoridad basada en rol local ni invalidación de requests ya enviados. |
| B148 | P2 | logout incrementaba generation, fallaba antes de limpiar user y el effect de inbox sólo observaba user; el finally de una lectura vieja no liberaba loading, y no había recarga. | Reloj compartido reactivo; effect existente de O26 detecta nueva generación con el mismo user. Logout sigue conservando identidad hasta ack; error retorna, UI limpia operación vieja yrecupera snapshot de cuenta actual. Un contexto provisional no significa logout confirmado. |

Arquitectura: nueva SessionContextService carece de HTTP, credencial y política; conserva un único signal user yclock compartidos. AuthService sigue siendo fachada y no adquiere ciclo DI con ApiService. nuevo api-request-scope.ts centraliza regex ypath que ya usaba el interceptor; clasificación pública/sesión/tenant intacta. Guards no interrumpen ni ocultan el resultado de un write ya enviado, porque puede haber confirmado en servidor; cada caller conserva su responsabilidad sobre efectos tardíos. CSRF sigue coalesciendo, yretry sólo una vez cuando reason exacto csrf_rejected.

Evidencia: `.uvh-runtime/s01-csrf-context-red.log`18fallos/7controles,exit1. Tras guard de epoch, `s01-csrf-observed-identity-red.log`3fallos/31 (2fixture I/O nativa Blob.text,1producto al observar userB por /me). Espera nativa reparada: condición request real con deadline1s ypoll5ms; no mock ni cambio de transporte por esos errores. `s01-csrf-context-contracts-final.log`82/82,exit0; `s01-csrf-context-full-frontend.log`950/950,exit0. Son34controles nuevos respecto a916. Logs lint/types/build exit0; Node--check/diff/hash verificados tras documentación.

QA con skill agent-browser: development4216 contra servidor ficticio8416, sin Laravel/DB. Primer intento de captura vio GET completar antes del click; sólo acreditaba logout fallido básico. Repetición automatizada retuvo GET al iniciar acción: JSON antesloadingtrue/user1; click real Menú de usuario→Cerrar sesión; servidor POSTlogout503 antes de responder la lectura original, effect dispara GET nuevo; JSON final generation1/loadingfalse/busyfalse/user1/inbox1. Capturas `.uvh-runtime/s01-csrf-browser/logout-pending-before.png` y`logout-pending-after.png` inspeccionadas; log y`logout-pending-qa.json` preservados. Ruta sigue `/app/notifications`, toast pide reintentar, erroresJS vacíos. Sin vídeo/mobile/real backend/cookie race atribuidos. Browser ydos servidores propios cerrados, otras sesiones intactas.

O27 verificado (03/10): B146(P1) intención de otra cuenta despachada después de espera/bootstrap/retry CSRF, B147(P1) tenant header distinto tras cambiar workspace (incluido A→B→A), B148(P2) loading bloqueado tras logout fallido con user signal igual. SessionContextService comparte misma proyección user y reloj reactivo, Auth mantiene fachada/policy; ApiService captura ID/epoch y tenantID/revisión antes deawait, comprueba antes de cada envío/refresco/reintento, incluyendo postBlob. WorkspaceService avanza revisión sólo al cambiar selección normalizada; catálogo/path de tenant extraído sin cambio semántico. Rojo25casos18fallos/7controles; adicional34casos3fallos/31 (1productoUIDme+2fixtureBlob I/O), fixture corregida a esperar request real.34controles nuevos:82/82 dedicado y950/950 full frontend (4,592s Karma/4,323s ejecución),exit0. Lint/tipos/build10,017s exit0; Node--check/diff correctos. Bootstrap coalesced, retry único, idempotency key/body, rechazo noCSRF, public login/MFA/register/bearer, same tenant reselection ywrite ya despachado conservados. QA fixture aislada con GET realmente retenido al click logout503: antesloadingtrue/user1; despuésgeneration1/loadingbusyfalse/user1/inbox1 ytoast de reintento, misma ruta. Capturas yJSON inspeccionados; no gate de login/backend real/mobile nuevo ni vídeo. Fuente467→469files/2221named/1146callbacks/3firmas, cero owners provisionales;469hashes y277S01/59files+16S03/2+63S10/9anchors verificados. PHP intacto:1793/13590/Pint471/PHPStan0 deO24/O25 anteriores, no nueva suite atribuida; baseline161/150/controlador1408igual. Sin DB/migración/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13/gates reales abiertos. Protección es de contexto local observado antes de dispatch, no bypass del servidor ni solución universal de cookie HttpOnly; respuestas Auth ya enviadas, /me fuera de orden y cookies compartidas requieren O28. CI billing histórico sin nueva consulta.


## O28 — respuestas Auth y cookie de otra cuenta (03/10)

| ID | Prioridad | Defecto confirmado y corrección |
| --- | --- | --- |
| B149 | P2 | `/me` antiguo podía sobrescribir el más nuevo o un perfil/email ya confirmado, o restaurar identidad si el logout se encolaba entre helper y publicación. LatestRequest aborta probes anteriores y exige revisión/epoch justo antes de publicar; DTOs confirmados invalidan probes. |
| B150 | P2 | `/me` podía adoptar B sin cambiar epoch; perfil/email/ACK/workspaces pendientes de A seguían siendo «actuales». Adopción centralizada avanza epoch y descarta lista/rol/selección anterior, recargando B; mismo ID mantiene su generación/comando válido. |
| B151 | P1 | Cookie compartida y cuenta visible distintas permitían leer/escribir/cerrar la cuenta de la cookie aunque la intención perteneciera a otra. La SPA envía X-Uvh-Account-Id en rutas de sesión; Laravel compara con actor autenticado antes de controller. No es auth por header ni bypass de permisos. Mismatch409 limpia sólo proyección local, sin revoke/cookiewrite/retry/storage announcement; incluye Blob privado. |

B152(P2) — regresión detectada durante O28: al cancelar init por un `/me` más nuevo, un401/503 de ese probe podía dejar loaded/probeSettled falsos yAuthCard oculta. Red3/23 confirma estados; readIdentity resuelve probe yclasifica401definitivo/transientretry. Cierres definitivos también resuelven probe por consistencia; en signout loadedtrue ya mostraba la tarjeta, no se atribuye ahí un bloqueo visual. Sin nueva QA visual de este último ajuste.

70 nuevos controles (43frontend y27backend): rojo Auth11fallos/2controles, interceptor8/11, servidor18/9; error de token inválido422 corregido en fixture. Carrera nested await añade rojo2/18; primero TS2345 de fixture corregido.108/108 frontend dedicado (0,104s Karma/0,092s ejecución);989/989 full del producto y993casos full en curso tras cuatro controles Blob negativos adicionales, lint/tipos/build25,725s exit0.126/1058 backend específico33,24s yPint472/PHPStan0 exit0. First post-fix server11fallos de comparación factory-vs-row, corregida a snapshot fresh; no defecto de producto atribuido. First full frontend1fallo de teardown por nueva recarga workspace, fixture explícita actualizada.

Suite backend completa Artisan salió2 sin resumen ni detalle al imprimir WorkspaceAuditAtomicity; no se acredita full verde. Diagnóstico aislado133/935 en22,77s pasa. Segundo full mediante PHPUnit directo+JUnit en curso; fuente PHP/tests estable durante suites, exclusivamente uvh_test. Resultado final se registrará aparte. Baseline161/150 yAuthController1408líneas sin cambio; no nuevos ignores ni nueva extracción TX. Reutilizar LatestRequest evita duplicar controlador/revisión/cancelación; cancelar lecturas obsoletas reduce trabajo pendiente sin atribuir ahorro de SQL/latencia.

QA fixture aislada1440×1000: click real MarkAll de A envía expected1, sin tenant;409 lleva/auth, usernull/gen2/loadedprobe true/marker null y ningún dato anterior visible. Capturas inspeccionadas; acceso pide relogin sin afirmar que la cookie válida esté revocada. Foco inicial BODY, skipMAIN; no autofoco/teclado completo acreditado. hCaptcha muestra fallback por config de fixture ausente, sin login real. No móvil/vídeo/cookies compartidas reales ni E2E de backend atribuidos. Owned browser yservers cerrados, sesión ajena intacta.

Precondición opcional conserva legacy/publicbearer/CSRF/roles/verified/locks; no retira mutaciones o Set-Cookie ya enviados. CORS/proxy producción no acreditados. S01–S13 y gates reales/CI billing histórico siguen abiertos; siguiente [DTO writers del mismo User](superpowers/plans/2026-10-03-auth-dto-writers.md), candidato sin ID, más resto de funciones/roles/UX/operación. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy.

O28 diagnóstico de runner: primer intento PHPUnit directo+JUnit salió255 antes de ejecutar tests porque /repo es mount de sólo lectura. Destino corregido a storage/logs dentro de /app writable; nuevo full en curso, sin modificar PHP/tests. Controles Blob extra cubren error tardío de A sobreB, JSON inválido, JSON sobredimensionado y409 ajeno;108/108 dedicados pasan. No crédito de suite al intento que falló antes de arrancar.


O28 verificación final (03/10): B149(P2) orden de probes/DTO confirmado/publicación nested await; B150(P2) epoch/workspace/rol al observar otra cuenta; B151(P1) intención frontend distinta del actor cookie, precondición server y limpieza sólo de proyección; B152(P2) regresión de settlement de startup detectada durante el nuevo hardening, con probe más nuevo401/503 que cancelaba init. Signout definitivo también normaliza probe, sin atribuir a ese caso un bloqueo de AuthCard (loadedtrue ya la muestra).73controles nuevos (46frontend/27backend): rojo Auth11/13, interceptor8/19, backend18/27, publicación2/20 yprobe3/23.111/111 dedicado definitivo0,111s Karma/0,103s y996/996 full frontend5,411s Karma/5,038s, exit0 (`s01-observed-identity-full-frontend-probe-final.log`); lint/tipos/build11,563s definitivos exit0.126/1058 backend específico33,24s yPint472/PHPStan0 exit0. Full backend directo1820/1820,13770aserciones,360,394s/127MB exclusivamenteuvh_test,exit0 (`s01-expected-account-full-backend-raw-final.log`), JUnit1820/13770/errors0/failures0/skipped0;27casos/180aserciones corresponden al nuevo ExpectedAccountBoundaryTest.

La primera suite Artisan salió2 al imprimir WorkspaceAuditAtomicity, sin resumen; no se acredita ni se atribuye causa. Diagnóstico aislado133/935/22,77s pasa. Primer raw+JUnit falló255antes de tests por intentar escribir en mount/ro, corregido a /app/storage/logs. Fuente PHP/tests estable durante cada suite ysin cambios para saltar contratos. El full directo tiene evidencia completa; investigar la primera salida anómala queda como límite S13. Los fallos de fixtures (factory-vs-fresh, token422, unionPromise TS2345 yworkspace read nueva) están registrados sin bug de producto atribuido.

Reutilizar LatestRequest evita otra implementación de cancelación/revisión; init/me y confirmed DTO tienen propiedad explícita, double guard sin await antes de publicar y generation compartida. No se atribuye ahorro de latencia/SQL ni nueva extracción backend: baseline161/150, controlador1408, tres TX previas comparadas intactas. Inventario469archivos/2229named/1148callbacks/3firmas y0ownersprovisionales;469hashes y293S01/60files+16S03/2+63S10/9anchors verificados. QA sólo fixture1440×1000 de409: sinUser/inbox anterior, /auth, loaded/probe true, marker null, capturas inspeccionadas. No nuevaQAvisual específica deB152, autofoco/teclado completo/móvil/vídeo/login real/backendE2E/cookie race/proveedor/CORS producción acreditados. Owned browser/servers/tool handles cerrados; sesión ajena intacta.

Header esperado es opcional yno autoridad ni sustituto de CSRF/roles/verified/locks; legacy ypublicbearer conservados. No retira write/Set-Cookie ya enviado. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13 ygates reales/CI billing histórico siguen abiertos; Next Step [writers simultáneos de DTO del mismo User](superpowers/plans/2026-10-03-auth-dto-writers.md), candidato de código aún sin ID, más restantes funciones/roles/UX/operación. No marcar cierre global por estas suites.
