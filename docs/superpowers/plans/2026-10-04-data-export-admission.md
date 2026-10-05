# Data export admission and response contracts — O36 plan

> Ejecutar secuencialmente con executing-plans. Preservar árbol/autorización compartidos; sin delegación, worktree, commit ni confirmaciones adicionales.

**Goal:** continuar la revisión de código de exportaciones desde la observación UI ya corregida hasta la autoridad de sus lecturas, writes, eventos y contratos. B165–B167 reproducidos en la primera subfase de controller; los candidatos de worker/DTO siguen sin BugID hasta su rojo propio.

**Architecture:** leer y caracterizar primero el ciclo completo de AccountController y sus dependencias. Reutilizar AccountReadContext/SecurityContext sólo si cumplen la política vigente, preservando paso adicional de contraseña/factor, ownership del artefacto, deadlines, ACK y cleanup. Separar transporte Auth después de los fixes caracterizados, en su fase propia, sin cambiar fachadas ni mezclar una refactorización grande.

**Tech Stack:** Laravel/PHP/PostgreSQL exclusivamente uvh_test, PHPUnit/Docker, Pint/PHPStan, Angular/TypeScript y pruebas de contrato cuando cambie el DTO.

## Evidence to investigate
- exportStatus/exportHistory publican datos a partir del usuario hidratado y llaman publicExport con esa security_version. Comprobar revocación/expiry/bloqueo/verified/version posteriores a middleware frente al contrato real de AccountReadContext. O35 sólo relee estos cuerpos; no demuestra bypass ni cierre de esta frontera.
- request/cancel/download/ack siguen en AccountController y comparten lockVerifiedActor pero tienen distintos checks de sesión/actor/artefacto. Leer cada TX completa y dependencias antes de decidir una corrección: no copiar locks de otro flujo sin caracterizar sus políticas.
- publicExport sólo publica stage para processing y failureReason para failed. El decoder dataExport lee los enums independientemente y todavía no comprueba relaciones entre ellos/deadlines. Contrastar filas válidas, legacy persistido y emisor antes de endurecerlo; no introducir fechas/arbitrariedad sin evidencia.
- Admisión audit/mail/inbox/dispatch/cleanup: verificar qué debe ser atómico y qué side effect es recuperable tras commit; no afirmar que dos operaciones externas pueden compartir una TX SQL.
- Observación de navegador O35: en primer montaje no se registró un GET de notification preferences y apareció aviso; motivo no establecido, candidato transversal S10/S01 pendiente. No cambiarlo por conjetura ni atribuirlo automáticamente a la fixture.

## Constraints
- No uvh_local, cuentas/datos/mail/proveedores reales, worker/scheduler productivos, migraciones fuera de uvh_test ni commit/push/deploy.
- Suites DB de una en una; ningún edit de PHP/tests durante una suite. Confirmar protecciones TestCase y APP_ENV antes de fixtures. No recrear DBlocal ni correr migration fresh fuera de test.
- No repetir comandos automáticamente tras502/0 ni tratar estos errores como rollback. Mantener timeout120s para artifacts y20s para lectura; cambios sólo con caso justificado.
- Mantener recuperación de lectura UI O35 y su ownership/poll/teardown, y códigos recovery write-only. No publicar credenciales por /me ni añadirlas a audit/mail/logs.
- No transformar un DTO frontend en fuente de autorización, un snapshot en garantía de actualidad ni un resultado QA local en gate real de proveedor/operación.

## Task 1: leer y caracterizar
- [x] Primera subfase controller: funciones de exportación y dependencias de autoridad/Audit/cleanup completas,70 controles HTTP/I/O/deadlines y rojos conservados. GenerateDataExportJob completo leído y registrado; el resto de esta tarea requiere fronteras worker/DTO y lecturas restantes.
- [ ] Leer AccountController completo por funciones de exportación: status/history/request/cancel/download/ack/publicExport/isExpired/lockVerifiedActor, jobs/generación/PrivateArtifact/cleanup y outboxes directos. Completar lecturas truncadas y ledger; distinguir inventario de cobertura.
- [ ] Leer pruebas existentes y DTO/emisor/legacy. Crear controles HTTP reales para cada frontera de autoridad después de middleware y cada admisión/evento compartido en TX. Escribir casos adversos de DTO sólo frente a invariantes probadas del emisor.
- [ ] Ejecutar rojo y controles; guardar salida y asignar BugIDs únicamente después de reproducir materialmente.

## Task 2: corregir fronteras reproducidas
- [x] B165–B167: AccountReadContext en dos GET, verified en segunda TX de download y deadline estrictamente futuro en las cinco superficies. Recovery/step-up/Audit/cleanup existentes preservados.
- [x] Revalidar actor/sesión concreta actual en reads y TX según rojo controller; jerarquía de locks y expiración/version/verified/deletion comprobadas. Esto no acredita las fronteras posteriores de worker ni cada chunk.
- [x] B168–B170: Audit atómico failed/size, afterCommit y pointer recuperable.17 controles públicos de admission/outage/materialización/duplicate/stale y outer commit/rollback de failed. No cerrar otras admisiones/dispatch por analogía.
- [ ] Validar relaciones del DTO sólo si el emisor/legacy justifican las invariantes; preservar generic502 y reconciliación/no-replay en frontend.
- [ ] Completar fixtures normales y de error de cada caller sin relajar checks para pasar tests. Cualquier extracción posterior de Auth transport requiere caracterización antes/después y comparación de cuerpos completos.

## Task 3: verificar alcance real
- [x] Dedicado controller+dependencias143/1099/25,65s; Pint474/PHPStan0, baseline152/141. Inventario473/hash y353S01/16S03/63S10/104S02anchors comprobados. Full/JUnit de esta primera subfase2000/15172/313,847s,exit0; no TS/DOM editado ni nuevo gate frontend.
- [x] Gates de las dos subfases actuales:160/1239 dedicado y2017/15312 full336,833s,JUnit0errors/failures/skips;Pint475/PHPStan0. Sin edits PHP/tests durante suites. No TS/DOM nuevo: gates frontend O35 históricos. Revalidar ante cambios posteriores, sin cerrar DTO/resources pendientes.
- [x] Inventario473/2260/1164/3 y473hashes;353S01/16S03/63S10/121S02anchors, matriz185rutas9columnas y cuerpos Auth verificados después de full. Baseline152/141 sólo1ignore controller resuelto retirado; límites de clocks/I/O fake/interleavings/outer TX/proveedor expresos.
- [x] Reportes/planning y próxima reproducción resources/spool actualizados. Objetivo global/S01–S13/planO36 y roles/retención/capacidad/CI/operación real siguen abiertos.

## Next Step
Full/JUnit B165–B167 verificado2000/15172,exit0. Reproducir failed/failTooLarge del job ante fallo de admisión de Audit y borrado de Storage, con controles normales/outer rollback/commit y retryTerminal. Recursos de stream, outer dispatch y semántica DTO posteriores; candidatos todavía sin ID. No marcar todo O36 completo por los143 dedicados ni por un full verde.

## Subfase worker verificada localmente
B168–B170,17nuevos/160dedicados/1239aserciones,30,53s yPint475/PHPStan0,exit0. Full/JUnit del árbol final en curso. AccountExportDocument completo leído y17anchors añadidos;473hashes/353S01/16S03/63S10/121S02anchors verificados. Candidatos EOF/spool/resources sinID. Mantener el resto de checklist abierto.

## Next Step
Concluir full/JUnit del job final sin editar PHP/tests durante suite. Después reproducir cierre excepcional de streams y pérdida de datos por lecturas de spool; semánticaDTO y outer dispatch todavía requieren controles propios. Auth transport sólo después de caracterizar los seis endpoints y callers.

### Caracterización siguiente: streams y spools
- Reproducir con el controller y HTTP reales la respuesta503 por validate fallido y el recurso abierto por Storage.readStream; comprobar cierre del recurso, estado ready, no consumo/ACK ficticio y ausencia de secrets en error. Control positivo real cifrado.
- Reproducir corrupción a mitad de readChunks y asegurar cierre del recurso mediante finally sin silenciar el fallo ni declarar receipt; comprobar body incompleto y export todavía reintentable. No afirmar rollback del step-up/served anteriores.
- Para copyRows/firstLine, usar stream de fallo determinista en la frontera de lectura del spool y contraste con EOF normal; distinguir esta prueba del render/worker completo. Leer cualquier mecanismo de inyección antes de elegirlo, sin reflection como única prueba del flujo público.
- Revisar aperturas parciales y rewinds: no asumir fopen devuelve siempre resource ni confundir rewind fallido con documento vacío. Mantener memoria por bloques; no cargar todo para validar.
- Sólo después de rojos, reutilizar Streams.readLine o finally compartido si preserva policy; admitir fallo de I/O sin marcar ready/document completo. Pint/quality y dedicated/full sólo tras cambios reales, secuencialmente uvh_test.
- Mantener separados stage/status/failure del DTO y outer dispatch: contrastar emisor y legacy, no inventar relación deadline/created/ready sin evidencia. Characterize Auth seis métodos completos antes de extraer otro transporte.

## Gate final actual
2017/15312backend336,833s/133MB,exit0,JUnit0errores/fallos/skips.87nuevos controles (70admisión+17terminal),160/1239dedicado,Pint475/PHPStan0;hashes estables durante full. Todos handles propios cerrados. Checklist restante sigue abierto;NextStep resources/spool seguido DTO/outerdispatch y Auth transport caracterizado.

## O37 recursos/spools verificados en dedicado
- [x] Rojo/verde de B171–B173:13stream HTTP+10spool publichandle;189/1664dedicado38,01s yPint480/PHPStan0 final. Resource closure, error≠EOF, rewind y aperture cleanup; formato/memoria/policy/step-up/served yretry conservados.
- [x] Código/dependencias/ledger/inventario actualizados:473hashes/353S01/16S03/63S10/125S02anchors. Baseline152/141 intacto.
- [x] Full/JUnit O37 final2040/15721/355,198s,exit0,0errors/failures/skips;23nuevos409aserciones. Ocho hashes PHP/tests/baseline y473sourcehashes/353S01/16S03/63S10/125S02anchors comprobados post-suite; todas ejecuciones cerradas. DTO/outerdispatch yAuthtransport quedan pendientes.

## Next Step vigente
Concluir full/JUnit O37 sin editar PHP/tests durante suite. Después caracterizar relaciones DTO stage/status/failure frente a publicExport ylegacy;no añadir restricciones temporales sin emisor. Outerdispatch yseparación Authexport después de contratos caracterizados. Resto global/gates abiertos.

## Gate O37 final y acción vigente
2040/15721backend,355,198s/133MB,exit0,JUnit0errores/fallos/skips;189/1664dedicado yPint480/PHPStan0. Baseline152/141 intacto, fuente sin cambio durante full,handlescerrados. Ejecutar2026-10-04-data-export-response-contract.md siguiente. Este gate no completa checklistDTO/outerdispatch/futurosAuthtransports ni el objetivo globalS01–S13.
