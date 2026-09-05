# UVH — radiografía del estado actual

Fecha del inventario inicial: 4 de septiembre de 2026. Actualización de correo,
continuidad y límites: 5 de septiembre de 2026.

Esta radiografía se deriva de los archivos actuales del workspace. Distingue
presencia de implementación, cierre técnico, validación y producción. No usa una
casilla histórica como prueba suficiente y no afirma que una función sea segura
o esté terminada sólo porque tenga rutas, interfaz o migración.

## Resumen ejecutivo

| Área | Código actual | Evidencia pendiente | Estado honesto |
|---|---|---|---|
| Enlaces y redirección | CRUD, estados, reglas, alias, restore, actividad, intención anónima y resolución pública | Concurrencia multiproceso, E2E, accesibilidad y destinos reales | Implementado ampliamente; validación pendiente |
| Identidad | Registro, hCaptcha servidor a servidor, verificación, login, sesiones, reset, MFA/TOTP, recovery codes y reautenticación administrativa | Proveedor real, procesos distintos, fallos de caché y matriz E2E | Implementado ampliamente; no validado de extremo a extremo |
| Cuenta | Perfil, contraseña, cambio de email, exportación, incidente de seguridad, recuperación reforzada y eliminación con gracia | Archivos grandes, carreras, almacenamiento, correo real y procedimiento de soporte | Implementado ampliamente; operación externa pendiente |
| Workspaces y equipo | CRUD, roles, transferencia, salida, borrado, invitación, reenvío, aceptación y cancelación | Carreras y entrega real de invitaciones | Implementado; validación pendiente |
| Dominios | TXT/CNAME, estados DNS/TLS, revalidación, edge ask, jobs, recuperación de estados y métricas de antigüedad | DNS/CAA/ACME, certificados, apex/IDN, retirada, alertas y topología real | Código presente; infraestructura sin acreditar |
| Webhooks | CRUD, firma, prueba, entregas, reintento, SSRF, errores normalizados y antigüedad de cola | Egress/topología real, reglas de alerta y carga | Implementado ampliamente; validación operativa pendiente |
| Correo/outbox | Sobre cifrado, idempotencia, estados, recovery, reintento, compensación, purga, consola, métricas, política de transportes y runbook | Fault injection, proveedor real, alertas externas y retención aprobada | Admisión revisada estáticamente; excepción protectora de cancelación documentada; runtime pendiente |
| Criptografía de aplicación | Keyring temporal, escritura con clave actual, recifrado reanudable de todas las colecciones cifradas conocidas, deadline y overlay Compose | Ensayo con interrupción, concurrencia, jobs antiguos, rollback y custodia real | Implementado y documentado; ceremonia no validada |
| Privacidad y legal | Workflow de derechos, conversación cifrada, exportación y evidencia versionada de alta | Identidad legal real, DPA, bases jurídicas, retenciones y aprobación profesional | Código parcial; cumplimiento no aprobado |
| Administración/operación | Moderación, usuarios, recuperaciones, auditoría, estado, outbox, métricas, incidentes agregados de 60 minutos y heartbeats | Monitor externo, backups/restauración, runbooks y reglas/receptores de alerta | Superficie interna presente; operación real pendiente |
| Frontend | Landing, autenticación completa y panel de dashboard, enlaces, analítica, dominios, tokens, webhooks, equipo, ajustes y administración | Revisión visual integral, móvil, temas, teclado, lector de pantalla y E2E | Amplio pero no validado como terminado |
| Consola local | Inicio/estado asíncrono, corrección del resultado vacío y reparación recuperable de IPC Docker | Estado actual de servicios no refrescado; faltan validación GUI completa y reinicio de Windows | Implementación inicial, sin cierre operativo |
| Producción | Compose, Nginx/Caddy, gate de configuración y documentos de readiness | Migraciones en copia, secretos, TLS/proxy, SBOM/firma, backups, E2E y aprobación legal | No listo para producción |

## Inventario observado

- 135 declaraciones de rutas HTTP entre `routes/api.php` y `routes/web.php`.
- 33 archivos de migración; este conteo no demuestra cuáles están aplicados.
- 16 controladores HTTP, 6 jobs y una capa de soporte específica para sesión,
  MFA, outbox, SSRF, webhooks, dominios, métricas y producción.
- 11 entradas de routing del panel, incluidas las rutas contenedoras y redirect.
- El inventario inicial contaba 61 casillas marcadas y 85 abiertas en
  `docs/todos.md`; no es un contador actualizado. Son entradas del documento,
  no requisitos únicos: hay resúmenes que duplican el detalle.
- Las 25 entradas `PRODUCT-*` están abiertas y son roadmap opcional, no
  regresiones de la implementación actual.

Varias entradas de producto no parten de cero: el detalle de enlace ya muestra
actividad acotada; Dominios contiene un asistente TXT/CNAME/TLS; Webhooks permite
prueba, consulta y reenvío; Ajustes reúne los controles de seguridad; y el backend
puede restaurar enlaces borrados. Siguen abiertas porque faltan las superficies
dedicadas, paginación o contratos descritos. En particular, la papelera carece de
listado y el endpoint de entregas deja de exponer el payload persistido hasta que
exista una proyección redactada mediante allowlist.

## Outbox y flujos transaccionales

| Flujo | Recurso durable | Admisión en la misma transacción | Recuperación posterior |
|---|---|---:|---|
| Alta inicial | usuario, workspace, aceptación legal y `email_tokens.verify` | Sí, tras BAF-115 | `pending` recuperable por housekeeping |
| Corrección del email de registro | usuario y `email_tokens.verify` | Sí, tras BAF-115 | Rollback conserva email y bearers anteriores |
| Reenvío de verificación | `email_tokens.verify` | Sí, tras BAF-115 | El bearer anterior se elimina sólo en el commit nuevo |
| Solicitud de reset | `email_tokens.reset` | Sí, tras BAF-115 | El reset anterior se conserva si la admisión falla |
| Aviso tras cambiar/restablecer contraseña o finalizar recuperación | `email_tokens.security_revoke` y credenciales | Sí, tras BAF-124 | Rollback conserva credenciales previas; BAF-125 protege el bearer nuevo de la limpieza |
| Solicitud de cambio de email y aviso al buzón anterior | `email_change_requests` y recovery code persistido | Sí, BAF-115/126 | Rollback restaura solicitud/código y descarta ambos sobres |
| Confirmación final de email | Identidad, versión y revocaciones | Sí, tras BAF-126 | Fallo en cualquiera de los dos avisos revierte el cambio |
| Alta/sustitución/desactivación MFA y regeneración de códigos | Factor, recovery hashes, versión y sesiones | Sí, tras BAF-126 | Rollback conserva estado previo; no borra la marca TOTP en caché |
| Invitación y reenvío | `invitations` | Sí, tras BAF-115 | Rollback conserva generación, expiración e invitador |
| Emisión de token API | `api_tokens` y recovery code | Sí, tras BAF-127 | No devuelve secreto si falla admitir el aviso |
| Transferencia/borrado de workspace | Propiedad/roles o filas y cascadas | Sí, tras BAF-127 | Fallo revierte cambios y sobres; BAF-128 conserva el recovery code ante webhook ocupado |
| Recuperación reforzada | `account_recovery_requests` | Sí | Compensación por ID y generación |
| Exportación y descarga | `data_export_requests` | Sí | Compensación y limpieza del artefacto |
| Solicitud/programación de eliminación | `account_deletion_requests` | Sí | Compensación generacional antes de anonimizar |
| Cancelación protectora de eliminación | Cuenta restaurada y solicitud cancelada | Aviso en savepoint, BAF-129 | Comparte commit si se admite; si falla sólo se descarta el aviso y prevalece cancelar |
| Derechos RGPD | `privacy_rights_requests` | Sí | Estado y aviso se confirman juntos |

La entrega es intencionadamente *at least once*: una caída después de aceptación
del proveedor y antes de marcar `sent` puede duplicar un mensaje. No hay evidencia
runtime todavía de los rollbacks, carreras ni compensaciones anteriores.

La pasada del 5 de septiembre recorrió dispatcher, worker, elegibilidad,
compensaciones, recuperación/purga y reintento administrativo. BAF-122/123 corrigen
el respaldo `log` y la aceptación sin confirmación del mailer; se conservan las
partes HTML/texto. El procedimiento operativo está en
[`mail-outbox-runbook.md`](mail-outbox-runbook.md), sin ensayo ni entrega real.
BAF-124 cierra la ventana entre credenciales y aviso en cambio/reset y recuperación
reforzada; BAF-125 protege el enlace nuevo frente al orden de limpieza. Los casos
de rollback, reintento y publicación diferida están preparados sin ejecutar.
BAF-126 incorpora los avisos de MFA y de ambos buzones en cambio de email al
commit de su mutación. La regresión preparada incluye fallo del segundo sobre y
repetición del flujo sin conservar sobres de la transacción abortada. BAF-127/128
extienden el cierre a tokens/workspace y al recovery code en rechazo por webhook.
BAF-129 permite admitir el aviso de cancelación junto con la cuenta restaurada,
sin convertir el correo en requisito para detener su eliminación. Ante fallo
de esa admisión no se promete un aviso recuperable; prevalece proteger los datos.
Rechazo/aprobación administrativa de recuperación ya admitían correo dentro de
su transacción y no necesitaron ese parche. Nada de esto acredita ejecución.

La comparación de creación y transferencia detectó BAF-130: recibir propiedad
no aplicaba la cota de 20. Ahora comparte constante y bloqueo del receptor con
la creación, antes de consumir MFA. No cuenta pertenencias ajenas ni bloquea
salidas por exceso histórico; borrar libera cupo. Hay seis casos preparados
incluido reintento tras borrar, sin ejecutar ni acreditar carreras multiproceso.

En invitaciones, BAF-131 corrige una rama que seguía abierta de BAF-009: las
pendientes vencidas impedían reinvitar. Ahora se retiran dentro de la admisión,
con rollback si falla el correo; el panel proyecta caducidad sin escribir desde
GET y permite renovar expiradas. La frontera temporal coincide con entrega.
Once casos están preparados en `InvitationExpiryTest`; ninguna suite ni E2E se
ha ejecutado para acreditar el cambio.

### Autoridad sobre invitaciones: contraste estático

| Transición | Pendientes revocadas | Estado de implementación |
|---|---|---|
| Admin baja a editor/visor | Todas las emitidas en ese workspace | Ya presente en `changeRole` |
| Expulsión o salida | Todas las emitidas en ese workspace | Ya presente en `removeMember`/`leave` |
| Transferencia de propiedad | Las de admin emitidas por el owner anterior en ese workspace | Añadido BAF-132; conserva editor/visor |
| Bloqueo administrativo | Emitidas y recibidas de la cuenta | Ya presente en `AdminController` |
| Programación de eliminación | Emitidas y recibidas de la cuenta | BAF-133 añade emitidas a la revocación existente |
| Restauración de cuenta o autoridad | Ninguna se reactiva automáticamente | Cancelación persistente; nueva emisión explícita |

Los locks de aceptación y comprobaciones del emisor ya existían. BAF-132/133
evitan que la pérdida temporal de autoridad permita revivir el mismo bearer
después; las revocaciones comparten la transacción de cada cambio. Seis casos
preparados cubren retorno, rollback y restauración; no se ejecutaron ni se
sanearon datos históricos. Los avisos previos de la UI explican la cancelación.

### Capacidad y frecuencia de invitaciones

La revisión de BAF-041 encontró un throttle por sesión/ID crudo y ninguna cota
activa, pese al resumen histórico de cierre. BAF-134 lo liga a cuenta/workspace
canónico conservando 20 intentos/15 minutos. BAF-135 añade capacidad inicial 100
pendientes vigentes bajo lock; reenvío vivo reutiliza plaza y renovación expirada
requiere hueco. Nueve casos están preparados, sin ejecutar. No es una purga del
historial ni un presupuesto diario de correo. BAF-041 pasa explícitamente a
mitigado: siguen pendientes destinatario, IP, volumen agregado y alertas.

BAF-136 añade la implementación de presupuestos SQL compartidos con invitación
y outbox: cuenta/workspace/destinatario/IP/global y cooldown. Usa destinatario
guardado, HMAC multigeneración, reloj DB y locks ordenados; rechazo/fallo revierte
las reservas. Hay métricas y limpieza acotada. La migración 000032 está escrita,
no aplicada; trece casos están preparados, no ejecutados. El despliegue necesita
esquema antes del código y el keyring exige 24 horas de solapamiento tras retirar
el último escritor antiguo. Calibración, carreras reales y alertas siguen
pendientes: no convertir esta implementación en prueba de operación.

BAF-137 añade `uvh:release-check`: inspección sin migrar del ledger y pendientes,
columnas de presupuesto y límites compartidos con admisión. El arranque estándar
de producción exige el gate y los healthchecks de contenedor lo repiten; `migrate`
queda disponible para inicializar. Siete casos preparados, sin ejecutar. No es
una validación de todo el esquema ni modifica `/health`; falta ensayo en imagen real.

## Orden de trabajo vigente

1. Por petición expresa posterior a BAF-138, continuar roadmap opcional antes de
   cerrar validación/producción. PRODUCT-001 tiene API, pantalla, menú y tarjeta
   Dashboard; omitir/reanudar por usuario/workspace y ocultación por hechos reales,
   sin obligar a dominio/equipo ni guardar progreso. Cinco casos backend y trece
   frontend preparados, sin ejecutar. PRODUCT-002 ya tiene atribución explícita
   en escritores y migración 000033 escrita/no aplicada; seis casos preparados.
   API paginada/minimizada ya implementada con 20 casos preparados sin ejecutar.
   Pantalla y menú owner/admin, DTO, cota de 500 filas y manejo de contexto/errores
   implementados; 29 casos frontend preparados sin ejecutar. Detalles de cobertura
   y despliegue en `workspace-activity-roadmap.md`. NULL históricos no se atribuyen
   por actor, acciones sin catálogo no se publican y cursor no autoriza. Próximo
   PRODUCT-003: contrastar cuotas reales antes de construir uso y límites.
2. BAF-138 conserva `Retry-After` y muestra espera por destinatario en Equipo,
   sin envío automático. Diecisiete casos frontend preparados, no ejecutados.
   No repetir presupuesto SQL, gate o UI; E2E y pruebas permanecen pendientes.
3. Mantener separados los pendientes de validación, producción y legal. La pasada
   manual de jobs/eventos/consistencia y la revisión de `/health` quedan abiertas,
   sin convertir la nueva prioridad de producto en evidencia de cierre.
4. Cuando haya autorización y un entorno aislado operativo, validar sobre
   `uvh_test`; nunca preparar pruebas destructivas contra `uvh_local`.

## Límites de esta fotografía

- No se ejecutaron suites automatizadas ni migraciones.
- `php` no está disponible en PATH del host y no se ejecutó lint PHP. El estado
  de Docker observado el 4 de septiembre no se refrescó en esta actualización;
  no se utiliza como prueba del estado actual de servicios.
- El dato anterior de 17 migraciones aplicadas y 16 pendientes no se refrescó;
  permanece como último dato histórico, no como estado actual confirmado.
- No se comprobaron proveedores, DNS, TLS, correo, monitorización, backups ni
  datos legales reales.
