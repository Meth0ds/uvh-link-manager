# PRODUCT-002 — Actividad del workspace

Iniciado el 5 de septiembre de 2026 tras la implementación estática de PRODUCT-001.
La atribución, la API y la pantalla están implementadas y cuentan con validación
automatizada parcial. No se acredita despliegue ni una auditoría exhaustiva durable.

## Evidencia e implementación

La auditoría previa guardaba actor, acción, tipo/ID de recurso y metadatos, pero
no workspace. `LinkController::activity` sólo muestra 50 eventos de un enlace.
El actor puede pertenecer a varios workspaces; un join con sus pertenencias no
demuestra a qué workspace pertenece un evento. Además, un recurso ya borrado no
permite reconstruir siempre esa relación.

- Migración `2026_09_05_000033_attribute_audit_events_to_workspaces.php` escrita
  y aplicada sólo en bases aisladas `*_test`, nunca en `uvh_local`:
  `audit_events.workspace_id` nullable positivo e índice compuesto
  `(workspace_id, created_at, id)`. No hay FK al workspace: se conserva la identidad
  tras borrarlo y los avisos de borrado posteriores al commit pueden registrarse.
- `Audit::write` acepta el argumento final opcional `workspaceId`. Lo conserva al
  diferir el INSERT hasta después del commit; rollback descarta el callback. Si el
  propio recurso es `workspace`, su ID positivo es la atribución, sin consultar
  datos que podrían haberse borrado. Conflictos entre ambos IDs se rechazan.
- No se deduce scope del actor, cabeceras ni metadata. Recursos hijo deben recibir
  contexto del controlador/job autorizado. No se realiza backfill: los eventos
  antiguos y globales siguen con NULL y deben excluirse de la vista por workspace.
- Integración en enlaces (crear/editar/estado/borrar/restaurar), dominios,
  tokens, webhooks y trabajos DNS/TLS. Los eventos cuyo recurso ya es `workspace`
  cubren equipo/invitaciones/propiedad sin inferir pertenencias. También se captura
  workspace desde la fila bloqueada al moderar denuncias o bloquear/desbloquear
  enlaces; atribución interna no equivale a autorización para publicar sus detalles.
- Errores globales de cuenta, RGPD y algunos avisos genéricos de correo no adquieren
  scope de forma especulativa. La futura vista debe declarar cobertura limitada,
  no prometer un registro completo de todo lo que ocurrió.
- `ReleaseReadiness` comprueba la columna 000033 además de ledger/pendientes.
  El contrato de esquema la incluye. Los casos de release y los seis de
  `AuditWorkspaceAttributionTest` pasaron en la validación aislada del 5 de septiembre.

## Semántica y despliegue pendientes

La auditoría sigue siendo no bloqueante y posterior al commit; una caída entre
commit e INSERT puede perder un evento. La señal `audit.write_failed` no garantiza
recuperación durable. Esta implementación no cambia esa garantía ni sustituye el
outbox obligatorio de correo. No afirmar historial íntegro o prueba de cumplimiento.

Aplicar 000033 sólo con autorización, antes de activar escritores nuevos. Sin la
columna, un INSERT con scope falla y genera incidencia; no se reintenta omitiendo
la atribución. Los escritores globales conservan compatibilidad al no añadir ese
campo cuando es NULL. La política de despliegue debe retirar escritores antiguos
antes de considerar completa la cobertura de eventos nuevos.

La creación normal del índice puede bloquear escrituras: medir en una copia con
volumen representativo antes de producción. No se usa CREATE INDEX CONCURRENTLY
dentro de una migración transaccional. Hacer rollback de la columna elimina
atribución irrecuperable sin backup; retirar primero lectores/escritores y aprobar
el procedimiento. No reiniciar IDs de workspace en una base con historial retenido.
Retención/privacidad y borrado de cuenta siguen sujetos a sus políticas existentes.

## Pantalla implementada y validada parcialmente

- `/app/activity` usa un DTO separado de `AuditEvent` interno. Navegación sólo
  para owner/admin verificado del workspace seleccionado: ser administrador de
  plataforma no sustituye esa pertenencia. Abrir la URL directamente tampoco
  provoca consultas si falta ese contexto. La autorización real sigue en la API.
- Lista actor, etiqueta de acción, recurso tipo/ID, fecha UTC y resultado textual.
  No construye enlaces desde IDs ni destinos recibidos; sólo interpolación Angular,
  sin HTML dinámico. Avisos visibles de cobertura incompleta y de que «admitido»
  no significa entregado. No hay exportación ni promesa de integridad del historial.
- 25 filas por petición, carga adicional manual y máximo 500 en memoria/DOM. La
  última petición se ajusta a la capacidad restante incluso tras páginas cortas.
  Actualizar descarta filas y cursor y comienza de nuevo; no hay polling.
- Una nueva identidad/contexto de signals invalida inmediatamente la proyección
  visible, antes del efecto de recarga. Cuenta, selección, pertenencias/rol y
  verificación cambian ese contexto. Respuestas antiguas y posteriores a destroy
  no se aceptan. Se bloquean handlers concurrentes, no sólo botones.
- Todos los errores descartan filas y cursor, incluidas páginas anteriores.
  `401/403` pide revisar acceso; `422` requiere reinicio manual; `429/503` no
  reintentan solos. `Retry-After` válido bloquea intentos prematuros por cuenta
  dentro de esta instancia, incluso cambiando workspace. Al pulsar antes de tiempo
  informa de segundos restantes; no crea temporizadores ni reintentos al vencer.
  Es ayuda local, no cuota de seguridad compartida entre pestañas o recreaciones.
- `readActivityPage` recibe `unknown`: comprueba workspace, cobertura, tamaño,
  campos/tipos acotados, IDs string, fecha canónica, cursor de transporte y enum
  sin coerción; copia sólo campos públicos. Rechaza duplicados y cursores que no
  avanzan. No decodifica, registra, muestra ni persiste el cursor. La autenticidad
  criptográfica y el aislamiento de cada fila siguen siendo controles del servidor.
- Veintinueve casos frontend: 18 de componente, 5 de lector DTO y 6
  de navegación. Cubren permisos, cambios de contexto, respuestas tardías, errores,
  Retry-After, HTML como texto, límites incluso con páginas cortas y malformados.
  Pasaron el 5 de septiembre junto con typecheck y build.
- El 7 de septiembre Playwright recorrió los roles reales: `viewer` y `editor`
  no muestran la pantalla ni emiten la petición protegida; `owner` y `admin` la
  reciben. La lectura autenticada confirmó que no se devuelven emails ni el
  destino secreto creado para la prueba. También pasaron teclado/enlace de salto,
  reflow 390×844 y Axe WCAG A/AA sobre Chromium.

## Siguiente bloque

1. PRODUCT-002 queda implementado y automatizado parcialmente. No añadir funciones
   nuevas hasta avanzar los gates PRODUCT-VALID priorizados.
2. Mantener `PRODUCT-VALID-002` abierto: faltan lector de pantalla y revisión
   visual/temas reales, volumen/rendimiento, concurrencia, privacidad/retención y
   despliegue autorizado de 000033. Roles, ruta, móvil, teclado y Axe ya pasaron.
3. Sólo con autorización y esquema completo aislado `*_test`; no tocar `uvh_local`.
   La UI sólo observa revocaciones al refrescar contexto o recibir un rechazo de
   API: no es revocación push de información ya entregada. La garantía afterCommit
   incompleta sigue abierta; esta vista no debe usarse como registro probatorio.

## API implementada y validada en aislamiento

- GET `/api/v1/workspaces/:id/activity`, sesión verificada y rol owner/admin
  reconsultado bajo locks usuario/workspace. No usa la cabecera para cambiar tenant.
  Devuelve exclusivamente filas con atribución exacta y parejas acción/recurso del
  catálogo cerrado; recurso workspace exige además que su ID coincida con el scope.
- `limit` entre 1 y 100 (25 por defecto); consulta `limit+1`, orden descendente
  por fecha e ID. Sin OFFSET ni COUNT global. `nextCursor` indica otra página.
- Cursor cifrado/autenticado con `Crypt` de Laravel (`APP_KEY`), purpose específico,
  workspace, cuenta, security_version, fecha microsegundos/ID y vencimiento de una
  hora conservado entre páginas. Codificación canónica, tamaño máximo 2048, tipos
  estrictos. Nunca otorga acceso y no sobrevive a cambios de versión de cuenta.
  No es un snapshot exportable: retención o inserciones retrofechadas pueden cambiar
  páginas; eventos nuevos ordinarios aparecen al refrescar desde el inicio.
- DTO: IDs como strings, etiqueta fija, acción, fecha, recurso tipo/ID numérico,
  actor identificado sólo como «Tú» o «Miembro #ID» si sigue habilitado y pertenece
  al workspace. Otros actores: «Actor no disponible»; moderación no muestra ID.
  No se selecciona metadata completo, nombres, emails, IP/hash, destinos ni motivos.
- Resultados: `completed`, `pending`, `failed`, `unknown`. DNS sólo interpreta el
  booleano JSON estricto `found`; cadenas o evidencia ausente no son éxito. Admisión
  de correo/webhook no implica recepción. Acciones no catalogadas quedan ocultas.
- Límites operativos: 60 consultas/minuto por cuenta entre workspaces/sesiones,
  además del límite IP existente de 120/minuto. Requiere caché compartida y no es
  una cuota transaccional exacta bajo concurrencia. PostgreSQL `SET LOCAL` limita
  espera de locks a 2 s y cada sentencia a 5 s; no es un timeout total de petición.
- Errores genéricos: `401/403`, paginación `422`, limitación `429`, infraestructura
  o columna ausente `503`. No fallback sin scope ni detalles SQL en respuesta.
- Veinte casos de `WorkspaceActivityTest`: roles, aislamiento, catálogo,
  datos minimizados, empates/inserciones durante paginación, cursores y revocación,
  resultados DNS, identidades no disponibles, entradas acotadas, esquema ausente
  y presupuesto entre sesiones/workspaces. Pasaron el 5 de septiembre junto a los
  seis de atribución sobre `uvh_test`; no constituyen prueba de rendimiento real.

No se ejecutaron migración ni backfill en `uvh_local` ni despliegue real. Las
suites indicadas, typecheck/build y el E2E dirigido sí se ejecutaron en aislamiento;
continúan pendientes volumen, concurrencia y operación externa.
