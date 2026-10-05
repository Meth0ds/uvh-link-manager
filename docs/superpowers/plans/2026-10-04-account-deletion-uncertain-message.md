# Account deletion uncertain message Implementation Plan

> **For agentic workers:** Execute sequentially in shared tree using executing-plans; no subagents/worktree/commit/push/deploy.

**Goal:** Requirements read failure must not assert a previous account-deletion command was never sent.

**Architecture:** Keep all lifecycle and submission guards. Replace only checkImpact catch copy with a statement about the failed read. UI must require fresh read/acknowledgement/credentials before any later command.

**Tech Stack:** Angular, TestBed actual component/API/interceptor/Auth and isolated production build browser fixture.

**Spec:** O42 source finding: checkImpact clears prior error; after ambiguous POST0 or malformed ACK, failed manual GET currently says «No se ha enviado ninguna solicitud», despite the dispatched command.

## Global Constraints

No real account/password/mail/provider/DB/cookie operations. Network0 and malformed response do not prove commit/rollback; no automatic POST retry. Do not alter decoder, backend, success steps or retention policies.

### Task 1: Reproduce and fix copy

**Files:** Modify panel/settings/account-deletion-dialog.component.ts and core/services/auth-account-deletion-transport.spec.ts.

- [x] Add two real HTTP caller cases: valid GET→acknowledge→valid password/confirmation→one POST, return network0 or malformed ACK→manual requirements read503. Inspect rendered role=alert and assert absence of «No se ha enviado», no automaticPOST, impactnull/ackfalse/password cleared.
- [x] Run spec against O42 source, require two assertion failures in new cases before product change; fixture still compiles. Initial GET failure fixture assertion uses failed-read statement rather than proposed exact wording.
- [x] Replace only catch message:
```ts
this.error.set("No se pudieron comprobar los requisitos de tu cuenta. Vuelve a consultar su estado antes de continuar.");
```
- [x] Run dedicated caller/identity/Settings suites; full frontend, lint/typecheck/build. No backend suite required for copy-only fix.
- [x] QA own production build fixture in desktop/mobile and themes; real dialog failed GET displays copy without overflow. Browser uses fixture only; do not claim native cookie/DB/provider behavior.
- [x] Refresh inventory/anchors, report red/fix/gates/limits and close own browser/server. Assign next BugID only after authentic red. Global audit and external gates remain open.


## Cierre local O43


## O43 — mensaje tras solicitud incierta corregido (04/10)

**B179/P2:** checkImpact mostraba «No se ha enviado ninguna solicitud» cuando ya se había despachado POST y su respuesta era incierta. Dos reproducciones con componente/API/interceptor/Auth reales: POST network0 o ACKmalformed→GETmanual503; rojo2fallos/36positivos/38cases0,359s. No se afirma que el servidor haya confirmado ni revertido nada. Copy ahora describe únicamente el fallo de lectura e indica consultar estado; sin cambio de guards/decoder/POST/retries. Secretslimpios/impactnull/ackfalse/continuebloqueado, sin replay.

**87/87 dedicadas;1373/1373 frontend**,9,459sKarma8,838sexec, lint/tipos/build10,202s exit0. Logs `.uvh-runtime/s02-deletion-uncertain-{red,contracts,full-frontend,lint,types,build}.log`. QA build propia en8452, diálogo real con unPOST503fixture yGETfallido,390×844/1440×1000 claro/oscuro; mensaje completo ysin overflow de página/contenido;cuatro capturas/summary en `.uvh-runtime/s02-deletion-uncertain-browser/`. No errores JS nuevos enbrowser; server/navegadoruvh-o43 cerrados. CLI screenshot --path no soportado: capturas temporales retornadas copiadas, no fallo producto atribuido.

475hashes/353S01/16S03/63S10/151S02anchors en20archivos, Auth648/AuthController1408/baseline152/141 y2deletion+6export+4sessions+3TX preservados; ocho hashes PHP/tests O41 siguen iguales. Backend2066/15998O41 previo, sin nueva suitePHP/DB. Sólo copyTS ytests, sin datosreales/proveedores/mail/workers/scheduler/migraciones externas/commit/push/deploy. Inicial fixture está aislado;QA no acredita nativecookie/DB/provider ni outcome de una cuenta real. Todas ejecuciones propias cerradas.

**Objetivo global/S01–S13 activos.** Siguiente: fronteras de efectos de LinkIntentRegistry/reconciled Audit tras confirmDeletion ante outercommit/rollback/outages; fuente del registry ycaller leída sin BugID/causa cerrada aún. Política de cancelación protectora, roles/retención/capacidad/CI/operación yrestantes sistemas pendientes.
