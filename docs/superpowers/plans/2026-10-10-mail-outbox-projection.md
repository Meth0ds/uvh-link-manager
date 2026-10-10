# O96 — Proyección mínima al publicar correo en cola

Plan previo; producto todavía sin cambiar. Continuación de las fases5/6 del objetivo global, tras cierre O95. No aplicar a DB compartida ni enviar correo real.

## Fuente y motivo

MailOutboxDispatcher::enqueue toma FOR UPDATE de una fila pending/disponible con first(), pero sólo comprueba su existencia antes de actualizar estado/queued_at. Por tanto obtiene encrypted_envelope y metadatos que esta etapa nunca usa. UvhMail::send persiste el envelope y publica después de commit; housekeeping recupera publicaciones/worker caídos y pasa sólo ids en lotes50. DeliverMailOutboxJob::handle sí usa envelope, kind, lifecycle y attempts; conservar su lectura completa. El índice status/available_at/id ya existe: no añadir índice ni cambiar admisión por este lote.

## Contratos a preservar

Mismo filtro id/pending/available_at y bloqueo de fila, límites y transición atómica. Ausente/no elegible devuelve true sin dispatch; error de claim devuelve false; fallo de dispatch devuelve false y compensa sólo si la fila sigue queued. Dispatch único por claim, id/queue mail/afterCommit/lifecycle/cifrado/recuperación intactos. No convertir esta lectura en exists() si eso elimina el bloqueo necesario.

## Pasos

- [x] Revalidar ausencia de QA propio vivo; leer pruebas de outbox/transporte y schemas actuales. Crear entorno PostgreSQL/PHP propio con DB sufijo_test, red interna, proveedores/cola ficticios y recursos de identidad registrada.
- [x] Baseline con pequeños/medianos/grandes envelopes propios: registrar bytes del resultado obtenido y SQL real de enqueue, estados, retorno y dispatch. No imprimir envelopes ni bearer; fixtures sintéticos, medición no concurrente con regresión.
- [x] Contratos: pending listo/igual a now/futuro, estados no elegibles, ausente, doble enqueue, fallo de cola y compensación concurrente. Reproducción de competencia con conexiones/procesos independientes sobre DB propia; cada runner inspeccionado antes de ejecutarlo.
- [x] Cambiar sólo proyección a id bajo el mismo lock. Comparar SQL salvo proyección, eventos/resultados/estado y bytes; no quitar lectura bloqueada del worker ni cambiar protocolo.
- [x] Pruebas de correo/outbox/housekeeping y regresión Laravel pertinente; Pint/PHPStan, hashes de fuente y catálogo intactos. Registrar límites, no deducir CPU/throughput productivos de reducción de bytes.
- [x] Confirmar procesos terminales, retirar sólo recursos propios verificados, conservar evidencia e inventario y actualizar matriz/plan global. Otros SQL/jobs/frontend/infra/fase9 continúan.

## Resultado verificado

O96 cerrado. enqueue selecciona sólo id, conservando filtros y FOR UPDATE. Worker de entrega sigue leyendo el envelope.36 capturas exactas de retorno/estado/jobs/SQL salvo proyección en tres tamaños y doce estados;20→1 columnas. Mensaje grande sintético: se deja de seleccionar envelope2.796.353bytes. La métrica de valores representados como string pasa2.796.501→2bytes, no es medición de memoria PDO ni framing de red.

19 contratos nuevos/95assertions;99 dirigidos/625assertions. Dos procesos prueban espera real en pg_stat_activity y un único dispatch tanto si el primer claim confirma como si revierte. Rollback, afterCommit, cola caída y compensación que respeta el worker cubiertos. Pint532/PHPStanlevel6/inventario521 y540 hashes de fuente/copia válidos. Catálogo de mail_outbox intacto; sin índices ni migraciones nuevas en este lote.

Suite integral2868tests/33338assertions:2867pass,1skipDNS,0errores/fallos. Tras interrupción, handle63417 faltaba pero contenedor exacto1af4f03bc20b seguía vivo: se adjuntó docker wait (sesión42360) hasta exit0 y se inspeccionó JUnit completo. Log stdout quedó sin tail; no se reinició la suite. SondaSSRF5tests/62assertions confirma mismo skip por falta de resolución exterior. Recursos propios PG/red/volumen retirados por ID/label/mount verificados; evidencia preservada en `.uvh-runtime/o96-mail-projection/verification-summary.json`. Sin DB compartida ni envío de correo. Global permanece activo.
