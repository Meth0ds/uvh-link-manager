# O40 — publicación de exportación y commit exterior

Continuar O36 después de DTO B174 y transporte O39 verificado. Secuencial, árbol compartido preservado; no subagentes/worktree/commit/push/deploy. Sólo uvh_test, Storage fake/HTTP fake/mail array/sync o queue fixture; no worker/scheduler/broker/proveedor real.

1. Leer requestExport/job/config/framework/admisión mail/Audit/cleanup/housekeeping. Precisar efecto en ausencia de TX exterior y con outerTX. No convertir Queue::fake en evidencia de broker real.
2. Reproducir mediante endpoint público + outerTX: antes de commit no publicación; commit publica exactamente una; rollback ninguna. Queue database real en segundo PDO apuntando sólo al mismo uvh_test identifica publicación durable que sobrevive rollback o es visible antes de la fila; recovery factor/evento/request vuelven a estado inicial. No afirmar fichero huérfano por conjetura: spoolRows usa SET TRANSACTION en la conexión principal, incompatible con un job sync anidado. Controles normales y admission failure/active duplicate/stale actor preservan ausencia de trabajo.
3. Si rojo material, registrar B175 y colocar sólo publicación del job tras commit exterior. Capturar IDs, mantener queue-failure señal/evento y fila processing como recovery marker. No after_commit global ni cambios de workers/proveedores por defecto. Admitir excepción en callback sin confundir éxito/rollback. Valorar fila cancelada/cambio de seguridad antes de callback con el gate idempotente actual.
4. Dedicado apropiado/quality/full backend/JUnit una suite a la vez, sin edits PHP/tests mientras corre. Hashes durante full, inventario/anchors/matriz/reportes/planning final. Frontend1312 O39 previo, no nuevo gate UI atribuido. Objetivo/S01–S13/roles/retención/CI/capacidad/operación real/restantes funciones siguen abiertos.


O40: pasos1–3 ejecutados, B175/P2 rojo3/9/112aserciones/2,45s con segundoPDO ycola real database sólo uvh_test.209/1850dedicado41,16s yquality481/0 exit0. Full2049/JUnit en curso; no cierre todavía del paso4 ni global. Docker apagado reactivado sin workers/scheduler. Sin fichero huérfano atribuido; sólo jobs sin businessrow confirmada. NextStep después de full: plan2026-10-04-account-deletion-boundaries.md.


Paso4 local verificado:2049/15833full360,442s135MB,exit0;JUnit0errors/failures/skips,9nuevos112aserciones.209/1850dedicado41,16s,quality481/0,474hashes/131S02anchors ycomparaciones6+4+3 preservados.10hashes PHP/tests/baseline sin cambios durante full. Matriz185rutas/9columnas/reportes/planning final conciliados. La fase de commit/export local se completa, el objetivo/S01–S13 permanece abierto ynextplanO41 continúa candidatos de borrado. Sin nuevo frontendgate:1312O39 previo.
