# Registro de revisión de funciones S02 — 2026-10-04

O31: registros por función, no cierre S02. Código/callbacks/dependencias directas leídos;21 controles frontend reales y116dedicadas. Backend leído sólo en los métodos enumerados, sin suite PHP nueva. Formularios/dialogs restantes, proveedores, lifecycle completo, producción y todos los roles siguen pendientes. Funciones compartidas mantienen sus gates S01/S10/S13; no sumar dos anchors como dos funciones distintas.

## frontend/src/app/panel/settings/settings.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 355 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadAccountView` | 386 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `clearAccountView` | 397 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `openEmailDialog` | 503 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `openPasswordDialog` | 521 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadSessions` | 539 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadExportStatus` | 566 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadExportHistory` | 619 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `exportNeedsPoll` | 632 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `exportReadyRefreshHandler` | 639 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `armExportExpiryCheck` | 648 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `stopExportExpiryCheck` | 661 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `openDataExportDialog` | 668 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `cancelDataExport` | 692 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadDeletionImpact` | 782 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `openAccountDeletion` | 802 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `loadPrivacyRequests` | 821 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `onPrivacyPage` | 850 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `submitPrivacyRequest` | 856 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `beginPrivacyResponse` | 893 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `respondPrivacy` | 899 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `cancelPrivacy` | 924 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `copyRecoveryCodes` | 1227 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `downloadRecoveryCodes` | 1243 | O31: función y downloadBlob leídos; entrega síncrona, callback de URL sólo limpia recurso propio. Sin nuevo control de descarga/permiso real ni bug atribuido. |

| `retryExportStatus` | 596 | O35/B164: nueva función y callback current completos leídos. Consulta GET única, pause de poll/expiry, ownership y focus al título en success o conserva botón en failure;24 controles HTTP/UI y QA aislada, sin POST automático. |
| `exportIsActive` | 719 | O35: selector de processing/ready leído; conserva último snapshot para UI/poll, nunca prueba de actualidad o autorización. |
| `exportShowsRequestEntry` | 724 | O35/B164: presencia de owner, loading/error/manualrefresh excluyen ausencia aparente; null validado/terminal descargado o cancelado permite nueva solicitud. |

## frontend/src/app/core/services/auth.service.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `dataExportStatus` | 499 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |
| `dataExportHistory` | 507 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |
| `cancelDataExport` | 540 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |
| `accountDeletionImpact` | 546 | O42: cuerpo completo ycaller leídos;36contratos nuevos antes/después de extracción,199dedicado/1371fullfrontend. HTTP/API/interceptor/Auth reales simulados, no gate nuevo DB/provider/cookie nativa. Generación yreturn literalmente preservados tras sólo cambiar expresión HTTP. |

| `requestDataExport` | 514 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |
| `downloadDataExport` | 526 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |
| `acknowledgeDataExportDownload` | 534 | O39: cuerpo completo literalmente preservado salvo expresión del transporte.68 controles antes/después de HTTP/API/interceptor/Auth; generación/aserción/return sin cambios, errores viejos no invalidan B observado por /me.269 dedicado; no gate nuevo de cookie/provider/DB. |

| `requestAccountDeletion` | 553 | O42: cuerpo completo ycaller leídos;36contratos nuevos antes/después de extracción,199dedicado/1371fullfrontend. HTTP/API/interceptor/Auth reales simulados, no gate nuevo DB/provider/cookie nativa. Generación yreturn literalmente preservados tras sólo cambiar expresión HTTP. |

## frontend/src/app/core/services/privacy-response-decoders.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `message` | 22 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `privacyRequest` | 32 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `decodePrivacyRequestsPage` | 62 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |

## frontend/src/app/core/async-poller.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 33 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `schedule` | 49 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `reset` | 67 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `stop` | 72 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `stopTimer` | 76 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |
| `syncVisibility` | 83 | O31/B157–B159: código completo leído; controles reales de identidad/read/confirmación/settlement/teardown. Scope acotado; no gate de todos roles/proveedores ni autoridad por estado cliente. |

## frontend/src/app/panel/settings/data-export-dialog.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 52 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |
| `clearSecrets` | 167 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |

| `isDownload` | 58 | O35: lectura completa del getter, purpose request/download existente; sin nueva policy. |
| `continueFromPassword` | 62 | O35: lectura completa; requiresMfa capturado al abrir y pasos/formvalidación actuales. Refresh de MFA en mismo owner sigue candidato de revisión, no gate universal. |
| `back` | 75 | O35: lectura completa; limpia factor/error y vuelve al paso1 sin write; política existente. |
| `submit` | 82 | O35: lectura completa; guards/session generation, factor/password, clearSecrets y outcome; en24 nuevos controles se simula outcome del overlay y se prueba su caller, no autenticación externa ni todos sus steps. |
| `primaryLabel` | 128 | O35: lectura completa; label por purpose/busy/MFA, sin cambios visuales al overlay. |
| `finishDownload` | 135 | O35: lectura completa; downloadBlob y ACK separados, error antes de guardar no acusa; receipt fallo entrega unconfirmed. No nueva prueba de filesystem/artifact/browserdownload real. |
| `moveTo` | 162 | O35: lectura completa; microtask de focus al heading y step; teardown de microtask pendiente de revisión específica. |

## frontend/src/app/panel/settings/account-deletion-dialog.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 43 | O42: completa lectura TS/template y12nuevos caller reales; destroy aborta GET/limpia credenciales; latewrite sigue sin publicar vista retirada. O31 overlayowner conservado en199dedicado. |
| `allowed` | 50 | O42: cuatro blockers válidos con canDelete=true no habilitan comando; negativo admin/workspace/request/privacy, no autoridad atribuida aDTO. |
| `checkImpact` | 56 | O42: GETfailed→retry porbotón real→GETvalid caracterizado; abort/retired guards. O43/B179: dos nuevos casos POST0/malformed→retryGET503 ya no niegan request enviado; copy sólo describe lectura fallida.87dedicado/1373fullfrontend yQAfixture390/1440 ambos temas, no replay/rollback/provider/cookie nativa. |
| `next` | 73 | O42: acknowledgement/loading/busy/allowed guards leídos; control noack y cuatro blockers no avanzan ni POST. |
| `continueFromCredentials` | 78 | O42: credenciales inválidas no envían, MFAcapturada abrepaso3; positivo6digits/novalidfactor ysinMFA caracterizados. No política de MFA deotro navegador garantizada. |
| `back` | 91 | O42: cuerpo completo leído; limpiasecrets porpaso ybusy guard, sin nuevoprueba específica back; se conserva implementación. |
| `submit` | 104 | O42: dos pasos MFA/noMFA, una petición enflight, secretcleanup tras success/error/destroy, ACKmalformed sin replay. Contexto realB enfachada yoverlayO31; no rollback de write incierto afirmado por este gate. |
| `moveTo` | 146 | O42: step/microtaskfocus leídos ypasos reales ejercitados. Microtaskfocus destruido sigue candidato sin defecto probado, sin gate visual nuevo. |

## frontend/src/app/panel/settings/email-access-dialog.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 46 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |
| `clearSecrets` | 137 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |

## frontend/src/app/panel/settings/password-change-dialog.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 47 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |
| `clearSecrets` | 124 | O31: archivo TS completo leído; anchor acotado a lifecycle/secret cleanup. Overlay real se cierra al cambiar owner y limpia password en4 variantes; no validación universal de todos sus steps. |

## backend-laravel/app/Http/Controllers/AccountController.php

| Función | Línea actual | Estado |
| --- | --- | --- |
| `exportStatus` | 40 | O36/B165: cuerpo y AccountReadContext completos leídos; sesión/actor actuales después de middleware. Siete interleavings HTTP rechazan401 sin datos/cookie/write; no locks ni garantía durante toda la respuesta. |
| `exportHistory` | 61 | O36/B165: lectura fresca, owner y límite10; siete interleavings HTTP rechazan401 sin datos/cookie/write. No congelación de snapshot ni autorización por DTO. |
| `cancelExport` | 207 | O36: cuerpo y TX completos leídos, lockVerifiedActor ya vigente y Audit ya dentro de TX. Siete interleavings post-hydration y controles existentes pasan; limpieza recuperable postcommit, no cambio de política. |
| `deletionImpact` | 557 | O41/B176: cuerpo completo yAccountReadContext actuales;7posthydrate rechazan401 sin nombres de workspace/casos pendientes,2flags de rol frescos ypositivo noTX/no businesswrites.17nuevos backend/272dedicado/2066full; no congelación de sesión durante toda la respuesta. |
| `lockVerifiedActor` | 965 | O36: helper completo releído; locks cuenta→sesión exacta, verified/deleted/version/TTL estricta. Las cuatro mutaciones rechazan contexto obsoleto409; no nuevo bypass ni cambio del helper. |

| `publicExport` | 987 | O36/B167 yO38/B174: cuerpo/callbacks completos leídos; campos minimizados, stage sólo processing/failure sólo failed, securityversion→cancelled. Ready sin deadline o igual/pasado→expired en proyección sin mutar fila. Decoder coherente verificado O38; restantes relaciones temporales no impuestas por conjetura. |
| `isExpired` | 981 | O36/B167: ready requiere deadline estrictamente futuro; null/equality/past expiran.20 controles de cinco superficies incluyendo positivos futuros; no cambio de TTL48h ni de reloj productivo. |

| `requestExport` | 78 | O40/B175 yO36: cuerpo/TX/callback completos leídos.9nuevos HTTP+queue database/2PDOuvh_test: publicar sólo tras outercommit, rollback/savepoint ninguna, outage marcador+audit, duplicate/cancel/admissionfailure preservados.209/1850dedicado/Pint481/PHPStan0 y2049/15833full360,442s135MB/0JUnit; no broker/worker/archivo huérfano real atribuido. |
| `downloadExport` | 255 | O37/B171: cuerpo y closure de stream completos releídos;13 nuevos controles HTTP/MFA/crypto/retained handle. Validation catch libera recurso y bodyfinally cierra también si readChunks lanza;503 antes de headers o fallo de stream siguen explícitos, ready reintentable, recovery/served previos no revertidos. No receipt automático ni gate navegador/proveedor real. |
| `acknowledgeExportDownload` | 462 | O36/B167: cuerpo/TX/Audit/cleanup leídos; siete post-hydration y cuatro deadlines más controles existentes de served/session/owner/admisión. Consume sólo receipt confirmado; legacy served sin sid vigente preservado. |

| `requestDeletion` | 587 | O40 cuerpo completo leído; O41 reutiliza lockVerifiedActor y11AccountDeletionSecurityTest previos en272dedicado. Bajo lock account/session, owner/admin/privacy ystepup; nueva matriz completa request aún pendiente, no cierre de cada carrera de recursos. |
| `confirmDeletion` | 739 | O41/B177/B178 preservados. O44/B180: efectos cache/counters/reconciliationAudit sólo después de outercommit, IDs/fecha inmutables;4rojos/12iniciales,17nuevos finales/104dedicado953 yPint483/PHPStan0. ClaimAPIrealA/B+rollback/savepoint/cache/SQL/audit controles. Full2083/JUnit en curso, sin gate nuevo frontend/provider/cookie nativa; restanteS02/global abiertos. |
| `cancelDeletion` | 894 | O40 cuerpo/TX/protección completos leídos; O41 confirma que no se cambia grace/cancellationpolicy.11AccountDeletionSecurityTest previos incluyen audit/mail/fallbackrecovery; fechas exactas/efectos externos/retención aún requieren conciliación. |

## backend-laravel/app/Http/Controllers/PrivacyRightsController.php

O32: controller completo y dependencias directas de admisión/avisos leídos. Pruebas HTTP reales en uvh_test, rollback/outbox/locks/rol/MFA fresh; full backend1930/14523/358,030s, exit0 y JUnit0errores/fallos/skips. Gates locales O32 verificados; no certificación de sistemas completos. No gate de proveedor/producción ni cierre de lifecycle completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `index` | 29 | O32: B160/P1: AccountReadContext revalida cuenta/sesión/verified; owner/paginación/minimización/batch/empty y lectura sin locks comprobados. |
| `store` | 51 | O32: B160/B162: sesión exacta fresca y Audit en TX con expediente/mensaje cifrado/inbox/mail. Duplicado activo sin nueva auditoría/aviso; rollback/fallo/admisión/outer commit comprobados. |
| `respond` | 124 | O32: B160/B162: sesión exacta y Audit en TX; owner404, estado, límite20, cuerpo cifrado y rollback. Sin nueva notificación añadida: política actual preservada. |
| `cancel` | 177 | O32: B160/B162: sesión exacta y Audit en TX con generación/cancelled/inbox/mail; owner, estado y rollback comprobados. |
| `adminIndex` | 229 | O32: B161/P1: rol/verified/MFA proof/window actuales además de sesión exacta. Cola activa/deadline/historia, filtros y batch comprobados; sin locks de mutación. |
| `adminAction` | 279 | O32: B161/B162: SecurityContext.lockWithUsers reemplaza helper duplicado; jerarquía usuario→sesión→caso, comparación de snapshot y expiry estricto. Cinco decisiones probadas con audit/mail fallidos y success; TX exterior/evento recuperable. |
| `publicRequest` | 402 | O32: Payload privado minimizado/admin explícito, deadline/overdue y DTO existente preservados; tipos concretados. No certificación legal/producción. |
| `publicMessagesFor` | 443 | O32: Batch por página con bound existente20/caso y1000 total; GET1consulta con casos y0si página vacía comprobados; datos manuales por encima del límite siguen pendiente de política. |
| `insertMessage` | 470 | O32: Cifrado AES-GCM mediante UvhCrypto; cuerpo nunca en audit/mail, autor/rol y rollback comprobados para usuario/admin. |
| `decryptBody` | 481 | O32: Ciphertext malformado devuelve null; señal PII-free existente. UvhCrypto conserva legacyplaintext por contrato global, sin nueva política ni bug asignado. |
| `validBody` | 494 | O32: Código completo leído; validación actual UTF8/control/min10/max2000 y detalles por tipo preservados. Matriz negativa completa de payloads pendiente. |
| `pagination` | 509 | O32: Código completo leído; página1..10000/perPage1..50 y fallback existentes; pruebas paginadas privadas/admin, matriz de inputs extremos pendiente. |

AccountController: métodos de export/deletion de O31 conservan evidencia anterior; locks/cleanup restantes no revisados ni cerrados por estas pruebas de privacidad.

## frontend/src/app/core/services/auth-response-decoders.ts

| Función | Línea actual | Estado |
| --- | --- | --- |

| `dataExport` | 144 | O38/B174: cuerpo completo y emisor/migraciones leídos; stage sólo processing y failureReason sólo failed. Nullable legacy/fechas históricas preservadas.37 nuevos decoder+HTTP y4 caller;155dedicado/1244full, sin autoridad por DTO ni nueva relación temporal. |
| `decodeDataExportStatusResponse` | 163 | O38/B174 yO35/B164: envelope null explícito o row coherente; malformed/contradicciones502 nunca confirman ausencia. Snapshot/GETrecovery/teardown preservados. |
| `decodeDataExportHistoryResponse` | 169 | O38/B174: lectura completa; array≤10 y map validador; fila contradictoria rechaza todo el historial. Positivos legacy preservados; no gate real de DB. |
| `decodeRequiredDataExportResponse` | 176 | O38/B174: lectura completa; request exige row no nulo y coherente.502 no afirma rollback ni auto-repite POST, sin gate nuevo de write backend. |


O35/B164: loadAccountView/clearAccountView/loadExportStatus/history/exportNeedsPoll/readyHandler/expiry/stopExpiry/openDialog/cancel releídos completos con callbacks. Error visible/silencioso conserva snapshot, bloquea comandos y permite recuperación GET sin replay; timer/poll se pausaron durante retry.24 controles nuevos/122 dedicadas; scopes PHP/roles/provider permanecen pendientes. Caso first fixture retenía manual30s y excedía timeout20s: assertion adaptada al tiempo real de API, sin alterar timeout/policy.

| `decodeAccountDeletionImpact` | 182 | O42: cuerpo completo leído conemisor ycaller; positivos/invalid502 enHTTPreal, blockers nohabilitanrequest aunque canDelete sea incoherente. Sin cambio decoder/relationalbug inventado/rollback afirmado. |
| `decodeAccountDeletionRequest` | 214 | O42: cuerpo completo leído conemisor ycaller; positivos/invalid502 enHTTPreal, blockers nohabilitanrequest aunque canDelete sea incoherente. Sin cambio decoder/relationalbug inventado/rollback afirmado. |

## backend-laravel/app/Jobs/GenerateDataExportJob.php

O36: lectura completa del job; cobertura existente de generación positiva y size-limit. Fronteras failed/size/cleanup caracterizadas en17 nuevos controles y corregidas B168–B170; quedan otras fronteras y no se cierra el lifecycle.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `__construct` | 52 | O36: cuerpo completo leído, exports queue; sin nueva extracción ni gate real de worker. |
| `handle` | 57 | O36: cuerpo y callbacks completos leídos, incluidos terminal flows corregidos. Generación/snapshot/ready/etapas/cleanup admitidos en160 dedicados. Verified job/outer dispatch/recursos de controller/DTO siguen pendientes; sin gate de broker o capacidad real. |
| `failed` | 247 | O36/B168/B169: cuerpo/TX/Audit/cleanup completos leídos. Exact event ahora dentro de TX; cleanup afterCommit exterior y pointer mantenido hasta ausencia confirmada.17 nuevos controles incluyen admisión SQL/PHP, outer commit/rollback, delete outage, duplicate/stale y recuperación de materialización. No gate worker/proveedor real. |
| `failTooLarge` | 288 | O36/B168/B170: cuerpo/TX completos leídos. Evento size-limit atómico, pointer retenido ante Storage.exists outage y cleanup afterCommit; público handle con ceiling1024 produce rama real. No fichero privado generado en size refusal de fixture: se prueba evidencia/reintento perdido, no fuga/orphan inventado. |
| `writeStage` | 324 | O36: completo leído; progreso auxiliar fuera del snapshot read-only, fallo absorbido por política. Orden existente de etapas en suite generación, no autoridad por stage. |
| `stageConnection` | 345 | O36: completo leído; reutiliza PDO lateral, connectUsing force sólo en fallback. Positivo de todas etapas existente; no medición nueva de latencia ni outage real. |
| `hasMemoryHeadroom` | 364 | O36: completo leído; limit -1 o K/M/G, margen96MiB. Límite inválido rechaza; no OOM/capacidad real ni cobertura exhaustiva nueva atribuida. |

## backend-laravel/app/Support/PrivateArtifact.php

O36: archivo completo leído incluidos helpers/reencryption. Dedicado143 incluye pruebas existentes de PrivateArtifact, generación y snapshots; esto no cierra los callers de rotación ni recursos del controller en excepciones.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `write` | 77 | O36: cuerpo completo leído. I/O de destino posee cierre finally, origen propiedad del caller; bloques4MiB con footer autenticado. Positivos y failed-source existentes incluidos en143 dedicados. |
| `validate` | 126 | O36: cuerpo completo leído. Forma previa a headers, v3 requiere footer/count y rewind; v2/legacy preservados. No descifra todos bloques ni garantiza recurso del caller cerrado si lanza. |
| `readChunks` | 171 | O36: cuerpo completo leído. Generador v3 retiene último bloque hasta digest/count/bytes, rechaza plaintext/header/footer inválidos; v2/legacy por bloque. Corrupción existente en suite; resource ownership del caller, cierre excepcional de download pendiente. |
| `encryptedWithCurrentKey` | 254 | O36: cuerpo completo leído. Comprueba todos los ciphertexts incluido footer vía chunkLines; no valida integridad completa por este predicate. No gate nuevo de rotación operativa. |
| `reencrypt` | 266 | O36: cuerpo completo leído. Recifrado en memoria conserva formato; v3 valida footer/count/digest antes de resultado. Legacy/v2 sin sello global; no medición nueva de capacidad ni gate real de keyring. |
| `reencryptStream` | 345 | O36: cuerpo completo leído. Lee/escribe por bloques y valida footer antes de terminar v3, conserva formato y devuelve changed; caller posee ambos streams/publicación temporal. No revisión completa de callers de rotación en O36. |
| `chunkLines` | 451 | O36: cuerpo completo leído. Helper de formatos y extracción de footer ciphertext, usado por predicate; no autoridad ni validación total del documento. |
| `scanFooter` | 479 | O36: cuerpo completo leído. Forma estricta v3/count con único footer al final, valida manifest; no autenticación de cada bloque en fase previa. |
| `manifestOf` | 515 | O36: cuerpo completo leído. Composición completa footerJson/decodeManifest, ciphertext + esquema; dependencias criptográficas compartidas con gates previos, no auditoría de implementación OpenSSL. |
| `footerJson` | 520 | O36: cuerpo completo leído. Rechaza footer plaintext, descifra ciphertext; no retorno de credenciales por API/logs. |
| `decodeManifest` | 531 | O36: cuerpo completo leído. Exige enteros no negativos chunks/bytes y digest lowercase64; selecciona tres campos. Negativos existentes de footer incluidos, no fuzzing exhaustivo nuevo. |
| `assertManifest` | 552 | O36: cuerpo completo leído. Count/bytes/digest estrictos con hash_equals; se usa al leer/recifrar v3. Pruebas existentes de chunk/drop/foreign footer pasan en dedicado. |
| `footerLine` | 562 | O36: cuerpo completo leído. JSON del manifiesto con throw-on-error y posterior cifrado; no bytes de documento ni secrets en metadata pública. |
| `footerLineFromJson` | 571 | O36: cuerpo completo leído. Encapsula ciphertext autenticado del pie con prefijo end; formato emitido v3. No cambios de producto en esta subfase. |

## backend-laravel/app/Support/AccountExportDocument.php

O36: archivo y callbacks completos leídos.160 dedicados incluyen tests existentes de generación/snapshot y17 terminal failure nuevos. Recursos y pérdida de datos por EOF ante fallo de spool requieren reproducción; no gate de volumen/capacidad/operación real.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `render` | 70 | O37/B172/B173: cuerpo completo y helpers leídos;10 controles públicos handle/crypto con fallos de spool/apertura en childPHP aislado. No ready/mail/inbox en I/O inválido; reintento válido operativo y recursos cerrados. No filesystem real/OOM/carrera de procesos atribuida. |
| `maxPlaintextBytes` | 89 | O36: cuerpo completo leído. Clamp efectivo mínimo1024,256MiB por defecto; límite de fixture usado en rama pública size. No medición real de capacidad ni promesa comercial. |
| `spoolRows` | 102 | O36: cuerpo completo leído. Callback write cuenta bytes y exige JSON/Streams.writeAll; todas consultas dentro REPEATABLE READ READ ONLY, analytics última fase. Audit select disponible durante fixture materialización corregida. No validación universal de snapshots bajo concurrencia independiente. |
| `rowSources` | 151 | O36: cuerpo completo leído. Cada callable/cursor leído; ownership directo creador o dueño workspace, select explícito sin token hashes/signing/domain claims. Campos históricos de links creados y ownedworkspace forman política actual; revisión de pertenencia histórica transversal sigue abierta. |
| `analyticsRows` | 213 | O36: cuerpo completo leído. Sólo links creados por cuenta, orden day/link y agregados; no clicks crudos ni claim persona única entre días. |
| `webhookRows` | 232 | O36: cuerpo completo leído. Callback/generador leído; URL sin user/password/query y flag de redacción, metadatos de ownedworkspace sin signing secret. Parse inválido→null; no gate de todas URLs/proveedores real. |
| `privacyMessageRows` | 266 | O36: cuerpo completo leído. Owner del case vía join, ciphertext descifrado se sustituye por body; error marca unavailable y elimina encrypted_body. Métrica dentro de snapshot read-only es auxiliar y fallo tolerado por OperationalMetrics; revisar ruido/operación después. |
| `legalAcceptanceRows` | 296 | O36: cuerpo completo leído. Cursor user scoped y atributos crudos preservan timestamp; sin nueva conclusión legal ni cambio de contrato. |
| `writeDocument` | 313 | O36: cuerpo completo leído. Callback put cuenta tamaño/escribe íntegro, orden estable+JSON+account/arrays/analyticsDefinition. Helpers de lectura de fragmentos pueden confundir fallo con EOF: candidato sin rojo/ID. |
| `copyRows` | 354 | O37/B172: cuerpo completo; exige rewind y usa Streams.readLine, error distinto de EOF. Public handle con fallo tras primera de dos filas legales ya no publica documento parcial; EOF normal positivo preservado. Una fila pendiente en memoria, sin cargar todo. |
| `scope` | 376 | O36: cuerpo completo leído. Lista contractual seleccionada leída; no nueva validación de todos derechos/consentimientos ni asesoramiento legal. |
| `rights` | 397 | O36: cuerpo completo leído. Metadatos constantes leídos; gates legales/operativos permanecen externos a esta lectura. |
| `analyticsDefinition` | 406 | O36: cuerpo completo leído. Visitors daily pseudonyms/crossDayIdentityfalse leído, consistente con agregados; no conteo persona única afirmado. |
| `encode` | 417 | O36: cuerpo completo leído. JSON_PRETTY_PRINT/unescaped/throw-on-error, función pura leída; positivos documento existente. |
| `firstLine` | 423 | O37/B172: cuerpo completo; rewind verificado y Streams.readLine. Public handle con fallo de primer byte o rewind ya no publica account=null con notice ready; EOF legítimo mantiene política previa. |
| `openFragments` | 439 | O37/B173: cuerpo completo; un loop abre13fragments, comprueba resources y closeFragments ante cualquier excepción de apertura. Primera/middle/last allocation throws y false-return, recursos pendientes capturados, retry válido. Fault hook limitado y child aislado, no API de producción para tests. |
| `closeFragments` | 459 | O37: cuerpo completo, cierra sólo recursos vivos; sirve al finally de render y catch de apertura parcial. Controles de cada handle retenido confirman cierre sin doble cierre ni alteración de output válido. |

## backend-laravel/app/Support/Streams.php

O37: dependencia compartida S13 leída completa; reutilizada en dos lectores S02, sin cambiar la utilidad. No sumar este registro compartido como auditoría independiente de todo S13.189 dedicados incluyen6 Unit StreamsTest existentes además de183featurecases.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `readChunk` | 18 | O37: cuerpo completo leído. Distingue EOF/fallo/stall y cuenta bytes, tamaño positivo; controles unit existentes. No se cambia ni mide latencia/capacidad. |
| `readLine` | 42 | O37: cuerpo completo leído. fgets false sólo permitido con EOF real; errores antes de EOF lanzan. Reutilizado por firstLine/copyRows y13 descargas/10generaciones nuevas; no cambio de utility. |
| `writeAll` | 58 | O37: cuerpo completo leído. Reintenta escrituras parciales hasta totalidad;false/0 lanza. Sinks de fallo/partial existentes incluidos; JSON no se declara completo en write fallido. |
| `flush` | 76 | O37: cuerpo completo leído. fflush comprobado, failure lanza; unit existente. No garantía física de persistencia de volumen/backend ni fsync nuevo atribuida. |


## frontend/src/app/core/services/account-data-export.service.ts

O39: transporte puro extraído con seis contratos caracterizados antes de cambiar producto. Auth y caller conservan política de sesión/teardown, API compartida CSRF/scope/timeouts. Credenciales en cuerpo HTTP únicamente; ningún estado, cookie, storage ni temporizador nuevo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `status` | 12 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |
| `history` | 16 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |
| `request` | 20 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |
| `download` | 27 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |
| `acknowledge` | 34 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |
| `cancel` | 38 | O39: cuerpo completo leído; método/path/envelope/Blob/ACK/options y errores verificados a través de fachada real. Sin replay salvo rechazo CSRF explícito, un solo retry; contexto retirado durante bootstrap/renovación no envía write. No gate de proveedor/DB/navegador real. |


## frontend/src/app/auth/confirm-account-deletion.component.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `hasLink` | 44 | O41/B177: archivo completo ycaller/decoder/API/interceptor/Auth reales.23nuevos frontend/109dedicado/1335full; currentboolean obligatorio, sólo ownerownsignout, lateB ydestroy guardados. Copy cuenta del enlace yQA fixture claro/oscuro desktop1440x1000/móvil390x844 sin overflow. No cookie/provider/backendgate en browser. |
| `constructor` | 52 | O41/B177: archivo completo ycaller/decoder/API/interceptor/Auth reales.23nuevos frontend/109dedicado/1335full; currentboolean obligatorio, sólo ownerownsignout, lateB ydestroy guardados. Copy cuenta del enlace yQA fixture claro/oscuro desktop1440x1000/móvil390x844 sin overflow. No cookie/provider/backendgate en browser. |
| `confirm` | 61 | O41/B177: archivo completo ycaller/decoder/API/interceptor/Auth reales.23nuevos frontend/109dedicado/1335full; currentboolean obligatorio, sólo ownerownsignout, lateB ydestroy guardados. Copy cuenta del enlace yQA fixture claro/oscuro desktop1440x1000/móvil390x844 sin overflow. No cookie/provider/backendgate en browser. |


## frontend/src/app/core/services/public-action-response-decoders.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `decodeAccountDeletionConfirmation` | 38 | O41/B177: cuerpo completo;oktrue/fecha parseable bounded/currentboolean, no propiedadesextra retenidas.5currentmalformed y2valid en23nuevos, HTTP502 genérico sin signout/autoReplay; no rollback de write confirmado atribuido. |


## backend-laravel/app/Support/Auth/CredentialChangeResponse.php

| Función | Línea actual | Estado |
| --- | --- | --- |
| `forUser` | 17 | O41/B177: helper S01 compartido completo leído; reutiliza igualdad de snapshot actual/target para current/cookie. Extra tipadoexecuteAfter opcional, otras políticas intactas;3HTTPowners y272dedicado/2066full. Metadatos cookie de respuesta, no cookie nativa congelada tras loginposterior. |


## frontend/src/app/core/services/account-deletion.service.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `impact` | 11 | O42: transportepuro completo; GEToptions/password/confirmation/factor/CSRF/errors/timeouts preservados en24nuevos HTTPfacade. Ningún state/storage/timer/authority nuevo; Auth conserva lifecycle.36previos/199dedicado/1371full, lint/tipos/build10,679s exit0. |
| `request` | 15 | O42: transportepuro completo; GEToptions/password/confirmation/factor/CSRF/errors/timeouts preservados en24nuevos HTTPfacade. Ningún state/storage/timer/authority nuevo; Auth conserva lifecycle.36previos/199dedicado/1371full, lint/tipos/build10,679s exit0. |


## backend-laravel/app/Support/LinkIntentRegistry.php

O44: dependencia S04 leída para efectos S02; no sumar como cierre independiente de S04. Código de registry no cambia.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `remember` | 14 | O44: Índice acotado/advisory lock porowner; cap100 yactualización digest sólo mismouser. Dosfixturesissue/claimHTTP reales; sin nuevoprueba de100cap concurrente ni capacidad.104dedicado/Pint483/PHPStan0;full2083/16347 verificado. |
| `forget` | 53 | O44: Elimina sólo digestSQL; fallaSQLdespués de cachedelete mantiene rowrecuperable yretry no decrementsdosveces; prueba renombratable sólo uvh_test. No cambio utility.104dedicado/Pint483/PHPStan0;full2083/16347 verificado. |
| `revokeForUser` | 82 | O44: Fuente completa/callbacks leídos: bounded1000digest order, owncacheonly,6outagesinclrelease+SQLcleanup, inverseindexconservado para retry yeventbusy metadata. No cambio registry ni garantía Redis/provider real.104dedicado/Pint483/PHPStan0;full2083/16347 verificado. |
| `purgeExpired` | 138 | O44: Fuente completa leída; SQL expiry<=now indexonly. Sin nuevo gate de housekeeping/purga/TTL real.104dedicado/Pint483/PHPStan0;full2083/16347 verificado. |
| `releaseCounters` | 144 | O44: Fuente completa leída; global→IP locks/boundedTTL, best effort de contador no revierte bearer ya consumido.3casoslockbusy/putfalse/putthrow; counters residuales acotados, sin fix ni nueva garantía de capacidad.104dedicado/Pint483/PHPStan0;full2083/16347 verificado.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |


| `afterCommit` | 65 | O45/B181: helper completo leído; cuatro callers de seguridad y confirmDeletion pasan revocación/telemetría secundaria a commit exterior. Normal/commit/rollback/savepoint con A/B por HTTP, outage lock y fallo secondaryAudit preservan negocio;181dedicadas/1944aserciones, full2113/17018/350,697s exit0. No admisión primaria dentro del observer ni nueva garantía de capacity/Redis. |

## backend-laravel/app/Http/Controllers/LinkIntentController.php

O44: emisor/consumidor S04 completos leídos para fuente de cache/index/counters S02. No cambio controller ni cierre de superficie S04/roles/capacidad.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `issue` | 31 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |
| `claim` | 110 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `complete` | 172 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |
| `intentSource` | 228 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `bodyIntent` | 244 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `ttlHours` | 255 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |
| `validRecord` | 263 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `withLock` | 286 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `cacheKey` | 304 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `lockKey` | 309 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `counterKey` | 314 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `globalCounterKey` | 319 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `counterBucketKey` | 324 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `bucketTotal` | 330 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |
| `withCounterLocks` | 345 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `rollbackAdmission` | 366 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `releaseConsumedIntentCounters` | 392 | O44: Cuerpo completo; best effort para counters tras consumeirreversible; false/throw diagnosticados, TTLbounded. Precedente compara registry, sin cambio fuente/gate de capacity real. Full2083/16347backend yJUnit0errors/failures/skips verificados.  O51/B185: lifetime compartido; rojo4fallos/8controles yverde147/3569 en uvh_test. Comparador completo de ambos archivos y686hashes previos; full2217/19429,JUnit0errores/fallos/omisiones,688hashesintactos; no gate real Redis/capacidad acreditado. |
| `temporarilyUnavailable` | 424 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |
| `unavailable` | 431 | O44: Cuerpo/callbacks completos leídos; el nuevofixture utiliza issue/claimHTTP real ycontratosLinkIntent anteriores incluidos en104dedicados. Helpersvalidación/lock/buckets/consume leídos, sin nuevo bug/gate universal. Full2083/16347backend yJUnit0errors/failures/skips verificados. |



## backend-laravel/app/Http/Controllers/AdminController.php

O45: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `updateUser` | 170 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `eligibleLockedAdminSession` | 1287 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |


## backend-laravel/app/Console/Commands/UvhHousekeeping.php

O45/O47: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 45 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema.; O47/B183–B184: requerido execution audit enTX y3protective outcomes conreceipt exacto;171/2919dedicado yfull2205/18889/378,548s,45lifecycle+8schema+3readiness nuevos. Parser/body comparers actuales, sin afirmar toda retención/roles/proveedores; record/reconcile/errorstage probados. |
| `runStage` | 185 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema.; O47/B183–B184: requerido execution audit enTX y3protective outcomes conreceipt exacto;171/2919dedicado yfull2205/18889/378,548s,45lifecycle+8schema+3readiness nuevos. Parser/body comparers actuales, sin afirmar toda retención/roles/proveedores; record/reconcile/errorstage probados. |
| `executeAccountDeletions` | 602 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema.; O47/B183–B184: requerido execution audit enTX y3protective outcomes conreceipt exacto;171/2919dedicado yfull2205/18889/378,548s,45lifecycle+8schema+3readiness nuevos. Parser/body comparers actuales, sin afirmar toda retención/roles/proveedores; record/reconcile/errorstage probados. |


## backend-laravel/app/Support/Auth/CompromisedAccessRevocation.php

O45: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 23 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |


## backend-laravel/app/Support/Auth/AccountRecoveryAdmission.php

O45: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `complete` | 131 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |


## backend-laravel/app/Support/Auth/SecurityIncidentAudit.php

O45: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `record` | 16 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `reconcile` | 33 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `admit` | 51 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |


## backend-laravel/app/Support/PrivateArtifactCleanup.php

O45: dependencia compartida S01/S11/S13 leída sólo en los métodos enumerados. No acreditar todo el archivo ni duplicar cobertura entre sistemas; runPurges sólo identidad/export leído, sin anchor completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `afterCommit` | 13 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `attempt` | 34 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `clean` | 40 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `retryTerminal` | 91 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `reportFailure` | 119 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |
| `isManagedPath` | 134 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema. |


O45 final verificado (04/10): **2113/2113 backend,17018aserciones,350,697s/133MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s02-security-commit-effects-full-backend.log`). JUnit2113/17018/errors0/failures0/skipped0 y30SecurityIntentCommitEffectsTest/671aserciones en `backend-laravel/storage/logs/s02-security-commit-effects-junit.xml`; summary `.uvh-runtime/s02-security-commit-effects-junit-summary.json` (JUnit348,399297s).181/1944dedicado34,59s;Pint484/PHPStan0 exit0.13hashes de fuente/tests/baseline congelados y comprobados después;475sourcehashes y353S01/16S03/63S10/194S02anchors en29archivos actuales. Seis archivos completos comparados tras adaptaciones explícitas y2deletion+6export+4sessions+3TX anteriores conservados. AuthController1399/AuthService648,baseline152/141 sin nuevoignore; no cierre de separación Auth por línea reducida.

B181/P2 yB182/P2 corregidos con evidencia roja/verde, incluidos native-command housekeeping/retención y cuatro security callers; countercleanup sigue best effort/TTLbounded. Sin cambios TS/DOM/QA ni nuevo gatefrontend (1373O43 previo), provider/SMTP/Redis/nativecookie/capacity/fileproductivo no acreditados. No usuarios/mail/DBuvh_local/providers/workers/scheduler/migraciones externas/commit/push/deploy. Todos handles propios terminales; shared postgres/mailpit siguen healthy, sin app/worker/scheduler. La respuesta anterior sobre estado Auth fue informativa; este turno sí es progreso por dosfixes/30regresiones/verificación real.

**Objetivo global/S01–S13 continúa activo.** NextStep vigente: ejecutar `docs/superpowers/plans/2026-10-04-auth-recovery-controller-separation.md`, extracción coherente de recuperación e incidente con completos cuerpos/middleware/routecomparators y contratos antes/después. PrimaryhousekeepingAuditdespuésTX yregistryTTL24/configurable permanecen candidatos no reproducidos/sinID, junto con resto de funciones/roles/retención/capacidad/CI/operación real. O45 cerrado únicamente como bloque local, no como proyecto finalizado.


## backend-laravel/app/Http/Controllers/SecurityIncidentController.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `revokeCompromisedAccess` | 22 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |


## backend-laravel/app/Http/Controllers/AccountRecoveryController.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `completeAccountRecovery` | 78 | O45/B181–B182: cuerpo completo/callbacks leídos; autoridad, locks, admisión primaria y receipts preservados. 30 nuevos controles HTTP/native-command guardados en uvh_test, caché array y Storagefake;181dedicadas/1944aserciones yPint484/PHPStan0. Normal/outercommit/rollback/savepoint, archivo/counters/A-B/outage/audit; full2113/17018/350,697s exit0. No provider/SMTP/Redis/nativecookie/retención de producción ni cierre del sistema.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |


O46 final verificado (04/10): **2149/2149 backend,17449aserciones,395,866s/139MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s01-auth-recovery-controllers-full-backend.log`). JUnit2149/17449/errors0/failures0/skipped0,36PublicRecoveryHttpContractTest/431aserciones,393,309949sJUnit en `backend-laravel/storage/logs/s01-auth-recovery-controllers-junit.xml`; summary `.uvh-runtime/s01-auth-recovery-controllers-junit-summary.json`.191/1923dedicado antes32,27s/después32,68s;Pint489/PHPStan0 exit0.15hashes de fuente/test/baseline conservados y479sourcehashes/354S01/16S03/63S10/194S02anchors comprobados después. FullAuth restante/44methodbodies/185runtime-routes/8dependencies y2deletion+6export+4sessions+3TX anteriores preservados tras las adaptaciones declaradas.

AccountRecoveryController3actions ySecurityIncidentController1action son los propietarios reales; shared3validators yactive-email preflight evitan duplicación. AuthController1227líneas/AuthService648,baseline152/141 sin nuevoignore. Sin nuevoBugID/TS/DOM/QA/provider/SMTP/Redis/nativecookie/latency/capacity claim;frontend1373O43 previo. Suites DB secuenciales ysin PHP/tests editados durante full. Handles propios terminales;sharedpostgres/mailpit operativos, sin worker/scheduler/appserver. No uvh_local/users/mail/providers/productioncommands/migraciones externas/commit/push/deploy.

PlanO46 cerrado sólo como extracción local. **Objetivo global/S01–S13 activos; Auth no está totalmente separado.** NextStep vigente: `docs/superpowers/plans/2026-10-04-account-deletion-lifecycle-audit.md`, reproducir admisión primaria deanonimización ycompensaciones protectoras por comando nativo guardado;sourcecandidates sin ID hasta rojo. Después continuar extracción coherente registro/activación ypasswordrecovery. RestoAuth/MFA/profile/sessions,registryTTL/configurable,funciones/roles/retención/capacidad/CI/operación real permanecen pendientes. No redefinir cierre como suites verdes/extracción parcial.


## backend-laravel/app/Support/AccountDeletionLifecycleAudit.php

O47/B183–B184: implementación y callbacks completos leídos; comprobaciones PostgreSQL y comando nativo sólo uvh_test. Protección conserva receipt ante PHP/SQL audit outage; requerir admisión del receipt evita una compensación sin evidencia durable. Full2205/18889/378,548s,JUnit0errores/fallos/omisiones.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `record` | 13 | O47:171/2919 dedicadas/31,27s. Admisión y consumo en savepoint, bloqueo user→receipt, batch100 con estado pendiente al quedar filas, hora/motivo/recurso inmutables, recovery exact-once en contratos locales; full2205/18889/378,548s yPint493/PHPStan0; sin provider/Redis/producción acreditados. |
| `reconcile` | 34 | O47:171/2919 dedicadas/31,27s. Admisión y consumo en savepoint, bloqueo user→receipt, batch100 con estado pendiente al quedar filas, hora/motivo/recurso inmutables, recovery exact-once en contratos locales; full2205/18889/378,548s yPint493/PHPStan0; sin provider/Redis/producción acreditados. |
| `admit` | 55 | O47:171/2919 dedicadas/31,27s. Admisión y consumo en savepoint, bloqueo user→receipt, batch100 con estado pendiente al quedar filas, hora/motivo/recurso inmutables, recovery exact-once en contratos locales; full2205/18889/378,548s yPint493/PHPStan0; sin provider/Redis/producción acreditados. |
| `reportFailure` | 79 | O47:171/2919 dedicadas/31,27s. Admisión y consumo en savepoint, bloqueo user→receipt, batch100 con estado pendiente al quedar filas, hora/motivo/recurso inmutables, recovery exact-once en contratos locales; full2205/18889/378,548s yPint493/PHPStan0; sin provider/Redis/producción acreditados. |

## backend-laravel/app/Support/LinkIntentLifetime.php

Dependencia S04 revisada para revocaciones S02/S01; no cierre independiente del sistema.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `hours` | 8 | O51/B185: conserva literalmente normalización min1 de emisión. Creation/consumption/security revocation comparten duración.12casos nuevos HTTP con middleware,SQL ycachearray; suite relacionada147/3569 yfull2217/19429 verdes,688hashesintactos/0JUnitfailures. |



## frontend/src/app/panel/settings/settings.component.ts

O64: consumidor de presentación y recuperación acotado; no cierre del sistema ni nueva autoridad del backend.

| Función | Línea actual | Evidencia |
| --- | --- | --- |
| `initialSection` | 125 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
| `goToSection` | 140 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
| `jumpTo` | 165 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
| `ngAfterViewInit` | 154 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
| `loadSessions` | 539 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
| `loadDeletionImpact` | 782 | Fuente completa y caller leídos. B211/B212: dos rojos temporales y uno de recuperación; controles de vistas persistentes/foco/borradores/reintento. Fronteras funcionales ajenas no cerradas. |
