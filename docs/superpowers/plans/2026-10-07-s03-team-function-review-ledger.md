# Registro parcial S03 — O67, equipo (07/10/2026)

TeamComponent completo y HTML/SCSS leídos. Callbacks revisados dentro de sus funciones; no certificación completa de S03. 24 casos nuevos, 13 rojos válidos: 11 iniciales, uno de borrador tras fallo/retry y uno que detecta una regresión durante la implementación (discrepancia de rol). Backend leído para conciliar contratos, sin nueva ejecución SQL. Un spec previo sólo adapta dos dobles; 117 anteriores intactos.

## frontend/src/app/panel/team/team.component.ts

SHA-256: `5e9a9ff9b333d43713363959ce55c44c21a0fc6c9bb668311195fbbba6a8e51a`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `roleLabel` | 94 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `viewContext` | 116 | Session generation, user id, selection revision, selected id and current role. Local publication boundary; does not replace server authorization. |
| `captureTarget` | 120 | Destroyed/context guards composed with existing workspace-id capture; shared helper unchanged. |
| `isCurrent` | 125 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `canManageMember` | 129 | B225: owner may manage nonowners; admin only editor/viewer. Direct-handler and UI controls tested. |
| `canManageInvitation` | 133 | B225: administrator grants owned-only; UI and direct-handler cases. |
| `constructor` | 137 | Account/selection revision/role reset; operation slot reset and destruction cleanup. ABA, old finally and account response cases. |
| `load` | 178 | B223: draft survives successful refresh and failed refresh/retry. Context-aware read; old account response discarded. Existing paging/decoder preserved. |
| `rename` | 234 | B224: account generation checked before list reconciliation; no late feedback. Existing rename API authority preserved. |
| `invite` | 263 | B223/B224: clear only submitted draft; original-recipient cooldown preserved by existing cases; old completion cannot release new operation. |
| `changeRole` | 287 | B225/B227: mirror owner/admin capabilities; failed Material selection restored; accepted role shown. Native real-template cases. |
| `removeMember` | 312 | B224/B225: captured confirmation/context; late success cannot publish or load another team. Admin target restrictions match backend. |
| `cancelInvite` | 339 | B224/B225: captured context and owned slot. Selection ABA case; admin invitations owned-only. |
| `resendInvite` | 356 | B224/B225: feedback/follow-up guarded; existing recipient cooldown cases rerun. Search and team QA do not send mail. |
| `showInvitationError` | 379 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `leave` | 393 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `isCurrent` | 400 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `deleteWorkspace` | 424 | Credential payload captured before confirmation; captured context/owned finally. No real deletion or new SQL gate. |
| `isCurrent` | 430 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `beginWorkspaceDeletion` | 474 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `cancelWorkspaceDeletion` | 482 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `beginOwnershipTransfer` | 490 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `cancelOwnershipTransfer` | 501 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `resetTransferPicker` | 509 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `onTransferQuery` | 524 | B226: invalidate and clear old results at typing, before debounce begins next request. |
| `searchTransferCandidates` | 543 | B226: current query and captured security context guarded; independent abortable GET. Native and browser 503/recovery. |
| `selectTransferTarget` | 574 | B226: only current loaded results when search settled; stale hit during typing rejected. |
| `clearTransferTarget` | 581 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `transferOwnership` | 587 | Native controls: credentials snapshot before confirmation; no overlap with newly started command; old confirmation preserves newer panel. API still enforces authority/MFA. |
| `isCurrent` | 593 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `onMembersPage` | 637 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `onInvitationsPage` | 643 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `trackByMember` | 649 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |
| `trackByInvitation` | 652 | Lectura en contexto; controles previos/QA acotados. Sin nueva prueba dedicada a esta función; no afirmar ausencia global de bugs. |

## Contratos backend conciliados (sin nuevos cambios o gates)

WorkspaceController: rename, changeRole, transferOwnership, removeMember, leave, destroy, invite, cancelInvitation, resendInvitation y searchMembers leídos para comprobar permisos, payload y efectos. Controladores/locks/helpers/outbox conservan evidencia anterior; esta conciliación no acredita revisión nueva de cada dependencia ni llamadas reales.

B228: el UI permite abandonar a editor/viewer; propietario conserva transferencia previa requerida. B229: labels de rol/removal/invitación incluyen persona/email. DOM y teclado comprobados; no prueba de lector de pantalla real.

Pendientes globales: administración, estado público, AuthService/auth frontend, sesiones con vista abierta/Centro, despacho bajo TX exterior/CSV, S13/release y otros gates de S01–S13.
