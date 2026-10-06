# Fechas de ciclo de vida y despacho auxiliar de enlaces

**Goal:** continuar la revisión de UVH S01–S13 desde la evidencia O58, comprobando que programación/caducidad conservan el instante solicitado y que los trabajos auxiliares respetan el commit exterior.

**Architecture:** dos fronteras independientes con reproducción y gates secuenciales. Conservar autoridad, cuotas, versiones, auditoría específica/genérica, callbacks y commits por fila CSV; evitar un refactor global de modelos/colas o una nueva TX exterior. Los candidatos no tienen BugID hasta rojo de producto.

**Spec:** objetivo vigente y `2026-10-01-system-by-system-review.md`; evidencia de fuente en `.uvh-runtime/o58-source-read-ahead/source-evidence.json` y O57/O58. La separación HTTP de Auth está completada, pero la auditoría global continúa.

## Condiciones

Esperar terminal del mismo full O58 handle45420 y comprobar JUnit2599 previsto, hashes813 y registros antes de editar fuente/tests o lanzar otra suite SQL. Conservar servicios del usuario y todo su árbol. Sin agentes/worktrees/commit/push/deploy ni cambios de uvh_local/usuarios/mail/proveedores/migraciones externas. Sólo env testing/DB *_test, cache array, correo array y proveedores falsos. Parseo de inventario y lecturas pueden hacerse durante full; no confundirlos con pruebas de producto.

## Fechas: S04/S05

Fuente ya leída: Link y RedirectRule completos; funciones completas validate/create/update/dto/shortUrl/deriveState/applyTags/applyRules/normalizeRule/toDateTime/iso de LinkService. toDateTime conserva el offset de IsoDate, pero el modelo Link mantiene formato Eloquent base; scheduled_at y expires_at originales tienen precisión de segundos. deriveState usa isPast; no inferir aún cuál es el contrato completo de redirección en igualdad. Rules usan HH:mm de reloj, por lo que no mezclar sus campos con timestamps ISO.

- [x] Verificar terminal O58 y snapshot actual; leer completos RedirectService.resolve/controles temporales, LinkController consumidores y los tests pertinentes antes de cambios. Comprobar API nativa, bearer y CSV como consumidores distintos, además de calendario/UI donde el formato cruce al usuario.
- [x] Crear regresiones HTTP/SQL antes de fix para create/update con ISO +02:00/-07:00, Z, seis dígitos y fechas enteras/sin fecha; comparar instante persistido y DTO. Probar activación/caducidad justo antes/en/después del instante desde la superficie de redirección, sin llamadas de proveedor ni visitas productivas. Afirmar errores sólo desde resultados observados; conservar relación scheduled < expires y los estados paused/blocked/deleted.
- [x] Si hay rojo, corregir almacenamiento/precisión y frontera pertinente con cambios mínimos; mantener timezone UTC del JSON, identidad del token/rol/generación, versions, avisos y auditoría. Si hace falta migración, probar upgrade con datos existentes e índices y downgrade sin redondear autoridad; aplicarla sólo a *_test y exigir readiness/ledger, dejando release externo pendiente. Ejecutar regresiones específicas, calidad y full/hash/comparación íntegra antes del siguiente bloque.

## Despacho auxiliar: S04/S11/S13

LinkService despacha reputación después de su propia DB::transaction, pero puede estar dentro de una TX exterior (incluida fila CSV). CheckDestinationReputationJob no declara afterCommit y queue.after_commit=false; QueueFake de O57 sólo demuestra rollback SQL, no transporte. dispatchCheck atrapa fallo de broker dentro del helper: cualquier aplazamiento debe contener también fallos que ocurran después del commit real y conservar la recuperación por sweep.

- [ ] Revalidar hashes tras cerrar el bloque de fechas; leer completa admisión/evaluate del job, callbacks de WebhookService, transporte y contratos DestinationReputationTest. Reproducir outer commit/rollback en LinkService create/update y CSV usando un transporte de pruebas que observe nivel SQL y filas desde una conexión independiente; QueueFake por sí solo no acredita esta frontera. Probar fallo de registro del callback y broker/diagnósticos después de commit sin efectos externos.
- [ ] Si hay rojo, diferir el despacho hasta el commit exterior y contener su fallo en el lugar donde ocurre; no devolver fracaso de negocio ya confirmado ni inventar admisión real cuando sólo está programada. Mantener sweep/reanálisis, no duplicar checks por fila/replay y respetar recuperación de CSV. No modificar política global de cola por este caso aislado. Volver a comprobar rollback, una entrega tras commit, no entrega tras rollback, fallos tolerados y negocio/audit persistidos.
- [ ] Ejecutar gates adecuados y registrar causas, cuerpos completos, resultados/limitaciones en inventario, ledgers, matriz y informe. Continuar las demás funciones/roles/UI/diseño/optimización, herramientas de control local añadidas por el usuario y retención/capacidad/CI/operación real. No declarar S04/S11/S13 ni el proyecto terminados por este bloque.

O59 entrada cumplida:O58terminal2599/22000/813hashes; snapshot814incltestusuario preservado. B197–B20032/64rojo inicial96; segunda capa20/79con99; B2014rojos de creación retrasada al ampliar, otros4regresiones de binding fraccional corregidas enB198.115/466verdes24.15s y626/5795regresión150.34s;8fuentes íntegramente comparadas,816hashes congelados. Calidad52146viva,full todavía no iniciado. Migración000002aplicada sólo uvh_test. FrontendLinkDialogsave leídocompleto pierde segundos al reenviar campos sineditar: siguiente gate deconsumidor antes decolaauxiliar, candidato sinnuevoID. No TS/testfrontend/source changes atribuidos.

O59 gateslocales115/466,626/5795,Pint513/PHPStan0;816hashes/19comparadores. Full2405vivo,previstos2714/22466,noresultadofinal. Losgatesdefechas/frontend ydespachoauxiliar siguenabiertos. Antesdeaux ejecutar consumidorfrontend fechado06/10; frontendcalendario pasa porJSONmilisegundos ydatetime-localminutos, no cerrar roundtrip completo por SQLverde.


## O59 terminal y preparación del consumidor (06/10)

Full backend terminal2405:2714pruebas/22466aserciones,796.606s/147MB,exit0 sólo uvh_test; JUnit0errores/0fallos/0omitidos,time791.953155s. Conservadas2599identidades anteriores más115/466nuevas.815/816hashes coinciden, incluido todo backend/frontend/tests/config; sólo scripts/uvh-control.mjs tiene cambio concurrente del usuario, preservado.16/19comparadores pasan; tres rechazan correctamente ese drift. Los manifests históricos no se modifican ni se declara verde su gate global. Prueba acotada íntegra en verify-link-lifecycle-backend-gate.py; revisión de herramienta S13 pendiente.

Lectura completa de11archivos del consumidor actual y declaraciones/decoders pertinentes registrada en `.uvh-runtime/o60-read-ahead/source-evidence.json`. Candidatos frontend: PATCH redondeado al editar sólo notas, ventana válida dentro del mismo minuto, fechas de plantilla con segundos. Sin rojo/ID ni cambios de frontend todavía. Próximo gate: reproducción nativa componente+ApiService+HttpTestingController; herramienta S13 concurrente queda revisión separada, sin ejecutar el control compartido. Objetivo S01–S13 activo.


## O60 — fechas del formulario y plantillas

B202/B203corregidos en el consumidor: fechas intactas omitidas en PATCH; plantillas conservan segundos/microsegundos y ventanas válidas se comparan por su instante.13rojos previos/5controles;2rojos adicionales por microsegundos antes de la corrección final.25casos nuevos,67regresión,1432frontend completo ytypes/lint/build exit0;817hashes post-terminal. Un componente completo con14transformaciones,107specs antiguos/HTML/SCSS/backend intactos. Ver informe O60 yplan de consumidor para evidencia/límites. QA visual aislada ydespacho auxiliar/CSV pendientes; cambios concurrentes de herramientas del usuario conservados,2gates de árbol completo correctamente rechazan su drift. Objetivo S01–S13 activo; ningún cierre global/producción ni ejecución de control compartido.
