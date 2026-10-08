# O70 — Ledger parcial S01/S13 y movimiento del panel

Revisión de métodos seleccionados y composición TS/HTML/SCSS. No cierra archivos/dependencias ni sistemas completos. Evidencia nativa y visual en el plan O70; enumeración estática no acredita revisión. Backend conciliado por código, sin gate SQL nuevo.

## frontend/src/app/core/read-deadline.ts

SHA-256: `0956b04d7f67e09f1e3deabb76ea92c6e342917840609d8bb07e738ade46507e`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 8 | Listeners fuera de zona y cleanup al destruir; no retiene estabilidad Angular. |
| `schedule` | 26 | Sustituye deadline; null/no finito/destrucción no rearman. |
| `stop` | 33 | Consume deadline y timer. |
| `stopTimer` | 38 | Cancela timeout y limpia handle. |

## frontend/src/app/panel/security/security-center.component.ts

SHA-256: `16487761c3db121e2440762cae945de8bdf1769e79e749502c2950f1045dfc83`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `accountKey` | 72 | Generación+id estable para refresh de cuenta frente a cambio esperado de flags. |
| `canDecide` | 97 | Lifetime y vencimiento leídos vivos; proyección pendiente no admite decisión. |
| `constructor` | 100 | Contexto incluye flags de proyección/entrega; limpia datos y cancela read/timer. |
| `load` | 124 | Dos GET propios; deadline anterior detenido, filtrado al recibir, arma siguiente vencimiento. |
| `refreshAccount` | 155 | Single flight propio por cuenta; superseded silencioso; no repite MFA. |
| `captureIntent` | 169 | Reconciliado con canDecide; intención previa al diálogo conservada. |
| `revoke` | 174 | Fila viva/revocación/expiración antes del runner; contrato O69 preservado. |
| `closeOtherSessions` | 193 | Runner/contexto O69 preservados. |
| `closeAllSessions` | 209 | Runner/contexto O69 preservados. |
| `runRevocation` | 225 | Se conserva el logout propio exacto y publicación sólo en contexto vivo. |

## frontend/src/app/panel/settings/settings.component.ts

SHA-256: `39bc4b15decb0d4776f6e53752a5c7ca4948e66f319c5906825effc2d234a6d5`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 362 | Cambio id+gen limpia datos; deadline compartido ligado a destruction. |
| `loadAccountView` | 393 | Carga por cuenta; consumidor de sesiones conciliado. |
| `clearAccountView` | 404 | Detiene deadline y limpia contexto antes de lecturas nuevas. |
| `refreshAccountView` | 484 | /me actualiza proyección; no recupera secreto perdido. |
| `loadSessions` | 548 | Pregunta viva id+gen; timer reemplazado al comenzar y armado tras respuesta vigente. |
| `revokeSession` | 983 | Rechaza lectura pendiente/error/fila vencida; runner previo conservado. |
| `accountContext` | 1150 | Id+generación usada también antes del effect. |
| `settleUncertainMfaUi` | 1176 | Elimina secreto/UI de enrollment incierto; warning de entrega queda en Auth. |
| `beginRecoveryRegeneration` | 1192 | No admite mientras datos pendientes. |
| `regenerateRecoveryCodes` | 1204 | ACK/DTO válido entrega códigos; incertidumbre no se transforma en disponibilidad. |

## frontend/src/app/core/services/auth.service.ts

SHA-256: `de3994f43a0f335b1e84400b72e59c9e36b644631c3875290426c541bdd592ba`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `publishUser` | 131 | No borra recoveryIssueUnconfirmed por /me mientras MFA activo. |
| `markUserProjectionStale` | 160 | ACK invalida identity/read previo y marca projection; consumidor Centro ahora observa flags. |
| `confirmedMfaMutation` | 169 | 502/0 incierto congela proyección sin replay; emisión confirmada limpia flag. |
| `readIdentity` | 215 | Cancellation+tickets antes de publicar; servidor401 es autoridad. |
| `me` | 436 | Reconciliación identityRead y publicación propia. |
| `refreshUser` | 447 | Marca proyección pendiente y llama me; no command replay. |

## frontend/src/app/panel/panel.component.ts

SHA-256: `98158db58bc54f982ae3ef19db055eccc98a9cc6060c9af4596641c25b2a0c6c`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `onMainNavFocusIn` | 114 | Foco visible de teclado; foco de puntero no retiene expansión. |
| `onMainNavFocusOut` | 120 | Conserva foco interno y limpia al salir. |

## backend-laravel/app/Support/Auth/AccountQueries.php

SHA-256: `af2f0cabc0443b19ddeb8952e16e5a30da1331f2086f218b9a5d34d184c91932`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `sessions` | 42 | expires_at/current y ventana100/101 del servidor; cliente filtra y renueva su proyección. |
| `securityCenter` | 67 | ActiveSessions contado por deadline servidor; recuento de códigos no demuestra entrega utilizable. |

## backend-laravel/app/Support/SessionManager.php

SHA-256: `e19c14f8aa925b4975f25c9e12771839324553f4bfb7d08b6354e28e5296d39f`.

| Función | Línea | Evidencia / límite |
| --- | --- | --- |
| `create` | 17 | TTL fijo; no renovación por vista cliente. |
| `hydrate` | 80 | Vencimiento, revocación y versión de seguridad servidor; reloj cliente no autoriza. |

ReadDeadline.sync (arrow): reevalúa visibilidad/reloj, consume antes de callback, pausa oculto, chunk máximo2^31−1 y ceil mínimo1; ocho controles del helper. Callbacks de Centro/Ajustes guardan propietario y no invalidan identidad por Date.now.

Panel.unreadRefresh NavigationEnd: compara pathname normalizado, pone main.scrollTop=0 al cambiarlo; query/hash mismos lo conservan. Un nuevo control Router/DOM y QA; baseline Settings→Centro ya730→0 por skeleton, no bug histórico demostrado en esa ruta.

SCSS/HTML: entrada única del host routed global por encapsulación; menú/pin/toolbar y sección sólo visible de Ajustes; reduced-motion sin efectos. Refresco mantiene lista con progreso/role=status; count recovery omitido con entrega no confirmada y CTA a Ajustes. QA36 estados, ambos temas y hasta320px. No prueba nueva lector de pantalla/Firefox.

Objetivo global activo. Auth público, tokens, estado público, TX exterior/CSV, S13/CI/operación/release siguen abiertos.
