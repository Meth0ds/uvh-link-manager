# O29 — writers de DTO de la misma cuenta

Estado: candidato de código, sin reproducción ni bug ID. O28 bloquea probes antiguos y otra identidad/epoch; dos commands que devuelven snapshots User del mismo ID pueden acabar fuera de orden. No confundir orden de inicio HTTP con orden real de commit ni dar por inválido un cambio confirmado.

- [ ] Leer completos Settings profile/email/dialogs, Auth writers/login/MFA, DTO público servidor, ProfileAdmission/EmailChangeAdmission y todos los callers UI. Determinar qué concurrencias reales admite el UI y contrato ya existente.
- [ ] Caracterizar con HTTP/decoders/Auth reales profile/email/cancel simultáneos, pendingEmail/name/flags, lector entre writes, error y confirmación parcial; server final y snapshots cuando proceda. Rojo antes de fix; ID sólo confirmado.
- [ ] Diseñar propiedad/serialización/refresh evitando success falso, reenvío automático de mutaciones y borrado de otro commit. Capturar intención antes de cualquier nueva espera; preservar cambio de cuenta/tenant/CSRF/step-up/locks/públicos.
- [ ] Evaluar limpieza de duplicación y responsabilidad como refactor gradual, con contrato explícito y sin abstracción paralela a LatestRequest/SessionContext.
- [ ] Verificación/gates y QA de concurrencia permitida, ledgers/matriz/hash/reportes. DB sólo *_test, una suite a la vez, sin editar PHP/tests durante su ejecución.

Secuencial; preservar cambios del usuario, sin subagentes/worktree/commit/push/deploy/uvh_local/proveedor/worker/scheduler productivo. Objetivo completo yS01–S13 abiertos; esta fase no reemplaza revisión restante ni gates externos/CI billing histórico.

Lectura preliminar (durante gate backend O28, sin edits de producto): Settings.saveProfile sólo controla profileBusy; template email action sigue habilitada durante ese write. openEmailDialog sólo excluye otro emailDialog, no profile write. EmailAccessDialog.submit invoca request/cancel del mismo Auth, exige epoch antes de enviar y deja despacho protegido por API; no serie de DTO compartida. Estas funciones/callers completos y template38–70 muestran una concurrencia posible; falta reproducción de orden real/snapshots y no se atribuye B todavía. No afirmar prioridad/solución sin controles ni cerrar O29.
