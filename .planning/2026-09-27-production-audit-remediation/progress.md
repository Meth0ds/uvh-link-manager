# Progreso
- Leído adjunto completo y comprobado git HEAD/estado y objetivo activo.
- Creado plan específico con los 14 hallazgos y QA hasta producción.

## Incremento 2026-09-27: aislamiento y consistencia
- Interceptor workspace/sesión: 19 pruebas ChromeHeadless; RED previo 12 fallos y GREEN 19. Typecheck y ESLint limpios.
- Legacy resend: reprodujo 500 por pending null; ahora audit con identidad correcta, rollback token/outbox y retry. Auth+Streams+PrivateArtifact: 20 tests/110 assertions.
- Streams readChunk y readLine estrictos; generación/descarga/rotación abortan con fallos posteriores a prefijo válido. V2 aún no detecta pérdida de bloques completos: V3 pendiente.
- WorkspaceMutation::run revalida editor/security_version con locks account→workspace. 7 mutadores usan transacciones y releen hijos bajo lock. Tags y colección cambian link.version/updated_at y link.updated, incluidos enlaces borrados.
- Bulk move revalida colección bajo lock de workspace. Fixture elimina colección tras preflight: 422 controlado, sin cambios ni reserva idempotente.
- Suites previas F7: 23 tests/120 assertions. Nueva WorkspaceMutationTest: 23 tests/164 assertions (21 revocaciones, versiones/stale, race collection).
- Pasada combinada 65 pasan y 1 fallo de fixture (usaba ids en vez de linkIds); corregido fixture y suite afectada íntegra pasa 23/23. Total 66 pruebas distintas verificadas en estas suites.
- PHPStan full: sin errores; Pint aplicado a archivos modificados. git diff --check limpio.
- Ningún commit ni publicación. CI remoto y QA global todavía sin ejecutar para este incremento.

Próximo: Idempotency::commit debe fallar si affected !=1, renew durante trabajo, import ledger autoritativo y fences por fila. Se inspeccionó LinkCsvController: snapshot recorded, catches LinkException no releen, commit final fuera de try. IdempotencyLeaseTest espera no-op del stale commit; actualizar para exigir rollback de efectos con excepción.


## Incremento 2026-09-28: reserva CSV y UI DB local
- Idempotency::commit ahora exige exactamente una fila y rechaza respuesta previamente sellada; `IdempotencyLeaseLost` fuerza rollback de efectos. Añadido renew bajo transacción account/workspace, bulk y cada fila CSV renuevan y mantienen el fence DB hasta fin del efecto.
- Import reconsulta ledger por cada fila dentro de transacción, solo inserta fila+link una vez; resumen final se deriva del ledger. Prueba con takeover entre filas hace que B retome, A obtenga409, estado final/sealed/replay contenga las tres filas sin error falso.
- Preflight CSV valida estado actual permisos, alias archivo/existentes, cuota y dominio listo, explicitando UI/Docs que no reserva/garantiza carreras.
- CSV exporta `tags_json` reversible (incluidos `;`/llaves) y admite `tags` legacy sin separador reversible. Contrato backup semanticamente limitado documentado.
- Extensión `expires_at` en batch ledger, migración aditiva con compatibilidad default para old deploys; renovación a la vez que lease y purge condicionado a expiración real.
- Nuevas pruebas: takeovers/replay, commit stale rollback, renewable lease/row-level DB lock, preflight y expiración tras 25h. Pruebas focales CSV/idempotencia pasaron tras fixes (24 y 16 tests anteriores al último añadido; falta re-ejecutar después de cambios de expiry).
- Full Angular: typecheck+lint, 541 ChromeHeadless tests y production build verificados. Backend full y composer quality estuvieron ejecutándose; revalidar estado/terminación actual.
- User solicitó conectar phpMyAdmin a DB. PostgreSQL no es compatible con phpMyAdmin (solo MySQL/MariaDB): agregué Adminer (Postgres PDO disponible) pinneado por SHA digest y mapeo loopback :8080, guía README. Servicio adminer arriba; GET HTTP 200 título Login, extensión `pdo_pgsql` presente. Login manual con .env queda para el usuario.
- Restante: V3 footer completo autenticado (serio, tocar artefactos y rotación), policy resend timing, regresión artefacto/truncamiento global, documentar limitaciones release gates, E2E/backup/startup/supply-chain/remote CI audit y siguiente QA.
