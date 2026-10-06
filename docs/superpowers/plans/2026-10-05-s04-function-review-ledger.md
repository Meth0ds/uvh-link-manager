# Revisión parcial S04 — recursos relacionados con enlaces

O55: lectura completa de los cuatro archivos siguientes y sus funciones/callbacks. Se acredita la frontera de sesión en ocho operaciones HTTP y los controles/regresiones indicados; la enumeración no cierra seguridad, diseño, UI, cuotas, concurrencia ni sistema S04. Fuente/controladores preservados por hashes; sólo WorkspaceMutation cambia su autoridad compartida. Propuesta por archivo de LinkCsvController se reconcilia aquí como consumidor de import/export S04.

B187/P1:41rechazos esperados devolvían200/201 después de invalidación de la sesión;8controles válidos.49/277verdes con wrapper corregido,264/1630dedicadas yPint506/PHPStan0; full2266/19706exit0,JUnit0errores/fallos/omitidos;806hashes actuales intactos. Los eventos de éxito específicos de estos controladores siguen fuera de su TX, con evento genérico del wrapper dentro; revisar garantía de metadatos/éxito durable por separado antes de asignar otro ID. No se certifica toda la autoridad de LinkController/LinkBulkController/LinkService por este lote.

## backend-laravel/app/Http/Controllers/TagController.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `index` | 26 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `rename` | 54 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `merge` | 116 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `invalidName` | 207 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `nameTaken` | 218 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |

## backend-laravel/app/Http/Controllers/CollectionController.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `index` | 23 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `store` | 40 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `rename` | 79 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `destroy` | 120 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `invalidName` | 172 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `nameTaken` | 183 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |

## backend-laravel/app/Http/Controllers/LinkTemplateController.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `index` | 28 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `store` | 44 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `destroy` | 128 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |

## backend-laravel/app/Http/Controllers/LinkCsvController.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `export` | 69 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `import` | 115 | Cuerpo/callbacks completos leídos. B187: sesión concreta y otras7rutas bajo wrapper; control positivo y rechazo sin efectos, regresiones de versiones/cuotas/concurrencia/idempotencia. UI y todas las carreras/audit específico pendientes. |
| `openBatch` | 259 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `resolveRow` | 284 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `summarizeRows` | 348 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `inputFromRow` | 378 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |
| `pushError` | 415 | Cuerpo/callbacks completos leídos, sin modificación. Evidencia sólo de fuente y regresión de consumidores; cerrar todos los límites/diseño/autoridad requiere sus gates propios. |

Fixture/SQL/HTTP exclusivamente testing/uvh_test. Ninguna operación en uvh_local, proveedores, mail, worker/scheduler productivos o migraciones externas. Frontend inalterado:1407fue la evidencia O54, no nuevo run. Siguiente revisión nativa de otras escrituras de enlaces y comparación de sesión versus bearer; candidatos sin ID hasta rojo real.

## backend-laravel/app/Http/Controllers/LinkController.php

Lectura completa adelantada durante full de O55; fuente hash-verificada y sin modificaciones. Sólo evidencia de código: estas escrituras no pasan por WorkspaceMutation, salvo consumidores CSV ya cubiertos. No se les asigna B187 ni otro ID sin rojo nativo.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `trash` | 41 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `index` | 71 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `checkAlias` | 137 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `store` | 177 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `show` | 233 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `update` | 290 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `state` | 369 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `appeal` | 439 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `destroy` | 492 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `restore` | 528 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `purge` | 589 | O56 B189/P1: expiry -1/0/+1 con password/recovery; inválida no consume factor ni borra. Contexto account/session único y membership admin; resto de audit/retención/UI pendientes. |
| `activity` | 664 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `unsupportedBodyField` | 710 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `validLinkBody` | 734 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `inputFromRequest` | 777 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `iso` | 823 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `positiveQueryInteger` | 828 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |

## backend-laravel/app/Http/Controllers/LinkBulkController.php

Lectura completa adelantada durante full de O55; fuente hash-verificada y sin modificaciones. Sólo evidencia de código: estas escrituras no pasan por WorkspaceMutation, salvo consumidores CSV ya cubiertos. No se les asigna B187 ni otro ID sin rojo nativo.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `bulk` | 47 | O56 B188/P1: HTTP de sesión exacta después de middleware, cinco invalidaciones y control; nueve acciones bulk. Actor compartido dentro de TX original; versiones/cuotas/scopes/dispatch/audit preservados. Gates audit específico/UI/concurrencia completa pendientes. |
| `apply` | 174 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `existingTagIds` | 396 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |
| `parseLinkIds` | 414 | Cuerpo/callbacks completos leídos; sin cambio. Gates de roles, límites, concurrencia, UI/diseño y dependencias aún pendientes según consumidor. |

LinkService::create/update y MfaStepUp completos leídos para seguir esas escrituras; no lectura total de LinkService ni cobertura funcional nueva. Las firmas de negocio sirven también a callers internos/bearer: no convertir una corrección de sesión de navegador en obligación de cookie para todos. Siguiente plan reproduce antes de cambiar contratos.


## O56 — B188/P1 y B189/P1

80rojos de producto/22controles antes de editar:75escrituras de seis rutas directas y nueve acciones bulk con sesión inválida (65x200/10x201), cinco purgas con deadline caducado (200en vez409). Wrapper compartido/captura verifican dentro de TX original; purge reutiliza SecurityContext antes de factor y membership.151/828primer verde y183/958con32controles adicionales API/binding/TX; control positivo de16operaciones ahora verifica exactamente un lock de cuenta y uno de sesión.313/1632dedicadas, Pint508/PHPStan0 tras completar tipo array del nuevo constructor. Full backend2400/20403, exit0 (handle70207),450.217s/141MB; JUnit447.905136s sin errores/fallos/omitidos.808hashes congelados verificados después del resultado terminal; no certificación completa del objetivo por este lote.

Las cinco rutas bearer mantienen permiso sin cookie y con cookie de otra cuenta;25rechazos de token revocado/expirado un segundo antes, scope reducido, rol viewer o cambio de generación después de middleware, antes del lock. Igualdad exacta de expiración bearer no probada/arreglada en este bloque. Intercalación account-generation se inyecta antes de ejecutar SELECT de account: cambiar esa misma fila después de que su lock devuelve no simula una revocación concurrente ya confirmada. Hooks de sesión se mantienen antes de su propio lock. Tests seriales en una conexión, no prueba de todas las carreras entre procesos.

## backend-laravel/app/Support/LinkService.php

Sólo las dos funciones completas siguientes leídas para esta frontera; no lectura completa del archivo ni cobertura global de sus helpers. El actor HTTP es opcional para preservar callers internos existentes. Controller pasa actor para create/update; CSV ya tiene authority de wrapper en cada TX y conserva su contrato interno. No se añade TX exterior: dispatchCheck mantiene su posición después del commit, sin audit genérico nuevo en rutas nativas.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `create` | 161 | Cuerpo completo leído/compared; actor se bloquea en su TX original y fallback interno/bearer preservado. B188/consumidores de browser y5rutas API; optimistic version/cuota/colecciones/tags/rules/dispatch conservados. Audit de éxito específico/retención/capacidad/otros helpers pendientes. |
| `update` | 276 | Cuerpo completo leído/compared; actor se bloquea en su TX original y fallback interno/bearer preservado. B188/consumidores de browser y5rutas API; optimistic version/cuota/colecciones/tags/rules/dispatch conservados. Audit de éxito específico/retención/capacidad/otros helpers pendientes. |

## O57 — B190/P1 y B191/P1

23operaciones directas/bulk/recursos relacionados devuelven200/201 ante fallo específico de outbox e interrupcióntrasINSERT:46rojos. Dos rojos más CSV sellaban ACKsin resumenrecuperable. Trigger PostgreSQL58000 específico permite genérico;24controleshistoria trasfixturebulk-move corregida. Actor capturaIP yadmite link.create/update/state/appeal/delete/restore dentro de TXoriginal;purge conserva metadataalias/factor en su commit.Bulkevento específico yACK juntos;catchThrowable libera sólo lease propio. Wrapper admite callbackespecífico conresultado antes degenérico. CSV resumen yACK juntos alfinal; filas preconfirmadas permanecen y reintento no duplica.

72/879verde inicial,101casos nuevos con23rollbackexterior SQL/5bearer/1guardTX.520/3585dedicadas en91.66s,Pint509/PHPStan0. Full backend2501/21544,424.676s/143MB,exit0handle38136;JUnit422.282519s/errors0/failures0/skipped0.809hashes congelados comprobados después del terminal.799archivos previos ajenos ytodos los tests anteriores intactos;nueve archivos completos comparados contransformacionesdeclaradas,Auditglobal/autoridad/dispatch/payloads/quotas/stepup conservados. Inventario496/2287named/1187anonymous/3signatures;noFrontendni medición delatencia. HooksafterINSERTytrigger SQL establecen la garantía local, no todas las carreras/host/TLS/provider. Auxiliares bajoTXexterior/internal callers yexpiraciónexactabearer siguen gates separados.

## O59 — fechas de enlaces, revisión parcial actual

B197–B200:32rojos/64controles nativos antes de producto; B201:4creaciones con estado calculado antes de waitSQL reproducidas al ampliar.115/466verdes24.15s,exit0; Pint10sin modificaciones. Regresión626/5795 ycalidadPint513/PHPStan0 correctas; Full backend terminal2405:2714pruebas/22466aserciones,796.606s/147MB,exit0 sólo uvh_test; JUnit0errores/0fallos/0omitidos,time791.953155s. Conservadas2599identidades anteriores más115/466nuevas.815/816hashes coinciden, incluido todo backend/frontend/tests/config; sólo scripts/uvh-control.mjs tiene cambio concurrente del usuario, preservado.16/19comparadores pasan; tres rechazan correctamente ese drift. Los manifests históricos no se modifican ni se declara verde su gate global. Prueba acotada íntegra en verify-link-lifecycle-backend-gate.py; revisión de herramienta S13 pendiente. Precisión modelo .uP y esquema6, rechazo de expiry en igualdad en derive/redirect/state/restore/bulk/housekeeping; merge PATCH interno y CSV preservan seis dígitos, DTO permanece UTC milisegundos. Housekeeping usa el mismo instante con precisión en SQL y Carbon. Derivación create después de locks/cuota, sin cambiar orden de autoridad ni política de estados pausados/bloqueados/archivados. Migración2026_10_06_000002 sólo uvh_test; rollbackDDL auxiliar del harness corregido sin retirar aserciones. Sin nueva UI/browser/TS ni pruebas de cola real.

## backend-laravel/app/Models/Link.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `casts` | 57 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `workspace` | 73 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `creator` | 79 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `domain` | 85 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `tags` | 91 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `collection` | 97 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `rules` | 103 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |

## backend-laravel/app/Support/LinkService.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `validate` | 26 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `dto` | 414 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `shortUrl` | 451 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `deriveState` | 464 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `toDateTime` | 632 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |
| `iso` | 646 | O59 cuerpo completo leído/comparado;115contratos nativos de fechas, sin cierre de todas las ramas/relaciones/roles/concurrencia/UI de esta función. |


## frontend/src/app/panel/links/link-dialog.component.ts

O60 B202/B203: componente completo602→646líneas comparado con14transformaciones declaradas.13rojos/5controles antes de producto;2rojos/23controles al ampliar microsegundos.25casos nuevos mediante componente+ApiService+HttpClientTesting/JSON;67focalizadas y1432frontend completo pasan, types/lint/build exit0. Omitir PATCH de fecha intacta mantiene precisión SQL desconocida para DTO; plantillas son fuentes explícitas incluso en el mismo minuto, BigInt conserva seis dígitos al validar. Viejos specs/HTML/SCSS/strict-wire/backend preservados. Browser aislado/teclado/foco/viewports/themes pendiente; sin inferir cobertura visual/roles/providers/DB/cookie real.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `futureLocalDateTime` | 86 | B203: instante efectivo futuro y revalidación al guardar; plantilla dentro del minuto y1microsegundo después de now. |
| `lifecycleOrderValidator` | 92 | B203: origen y plantilla válidos dentro del minuto, ventanas invertidas/calendario invalidado rechazados. |
| `lifecycleValue` | 322 | B202: conserva ISO fuente hasta editar el minuto; plantilla explícita con segundos/ms/us y modificación posterior. |
| `lifecycleInstant` | 327 | B203: comparación BigInt microsegundos sin inventar precisión ausente en DTO; parser local estricto conservado. |
| `lifecyclePatchValue` | 340 | B202: omitido al conservar/revertir fecha del enlace; null al limpiar, nuevo instante al modificar/aplicar plantilla. |
| `patchFromLink` | 362 | Carga original manteniendo proyección de minutos y fuente ISO; ventana válida con la misma proyección. |
| `applyTemplate` | 453 | B202/B203: fuente explícita incluso cuando el minuto coincide; template sin fechas limpia las anteriores. |
| `saveAsTemplate` | 481 | B202: captura instantes conocidos antes del prompt y exporta sin truncarlos; resto del flujo literal. |
| `save` | 595 | PATCH/POST JSON efectivo y version/alias/password/reglas/workspace/busy/decoder/late-response preservados por comparación y67regresión. |
| `platformDomain` | 347 | O61 vista previa real del dominio/alias, campos de control conservados; presentación sin autoridad nueva. |
| `previewDomain` | 355 | O61 vista previa real del dominio/alias, campos de control conservados; presentación sin autoridad nueva. |

O61 B204: un rojo nativo antes de corregir la igualdad ambigua de DTO; cuatro casos iniciales más dos controles conservan rechazo de nuevas parejas iguales/invertidas yerror422del servidor.31casos de fechas,44dirigidos; rediseño HTML/SCSS completo a petición del usuario, dos getters de representación yconfig de overlay. Fuente completa anterior conservada tras tres cambios del validador yuna inserción de getters. Autoridad/mutación/fechas PATCH ytodos los specs anteriores permanecen. QA aislada8436 añade creación/edición/microsegundos/temas/móvil/teclado/errores; no evidencia nueva de DB/roles/providers/cookies reales. Ver informe O61 yplan de rediseño.

## frontend/src/app/panel/links/link-dialog.service.ts

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `openCreate` | 12 | O61 servicio completo leído; sólo tamaño de overlay cambia, afterClosed/resultado/cancelación intactos. Creación/edición QAaislada yregresión nativa. |
| `openEdit` | 16 | O61 servicio completo leído; sólo tamaño de overlay cambia, afterClosed/resultado/cancelación intactos. Creación/edición QAaislada yregresión nativa. |
| `open` | 20 | O61 servicio completo leído; sólo tamaño de overlay cambia, afterClosed/resultado/cancelación intactos. Creación/edición QAaislada yregresión nativa. |

## frontend/src/app/panel/links/collections-dialog.component.ts

O62: archivo completo y callbacks leídos. Evidencia de recuperación y presentación del consumidor; no certifica cuotas, concurrencia o autorización completa del backend.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `isCurrent` | 84 | Frontera de workspace/contexto conservada; regresiones previas intactas. |
| `constructor` | 107 | Inicio de carga y cierre por cambio de contexto conservados. |
| `create` | 119 | B205: borrador retenido al rechazar; sólo el mismo borrador se limpia tras éxito. Recuperación nativa y fixture browser. |
| `rename` | 136 | Sólo recarga tras éxito; control de rechazo conserva filas/error. Prompt y autoridad conservados. |
| `remove` | 154 | Sólo recarga tras éxito; confirmación y decoder conservados, sin nueva prueba de borrado en API real. |
| `close` | 169 | Resultado changed conservado; cierre/retorno de foco comprobados con navegador ficticio. |
| `mutate` | 174 | Resultado booleano de éxito/rechazo; busy/contexto/error conservados. No amplía garantías de servidor. |
| `reload` | 197 | B206: loading/error/empty separados, retry real y guard de lectura activa. |

## frontend/src/app/panel/links/tags-dialog.component.ts

O62: archivo completo y callbacks leídos. Template/estilos rediseñados; cuerpos de rename/merge y contratos conservados por transformaciones exactas.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `isCurrent` | 83 | Frontera de contexto conservada, sin autoridad nueva. |
| `constructor` | 110 | Inicio de carga/cierre por contexto conservados. |
| `toggle` | 122 | Selección/destinos conservados; all-selected explica ausencia de destino. B208 etiqueta input nativo; navegador y regresión. |
| `rename` | 133 | Cuerpo leído y conservado; regresión previa de rename/rol/contexto. Backend/concurrencia completos pendientes. |
| `merge` | 163 | Cuerpo leído y conservado; instrucciones/selección/disabled revisados, sin fusión de datos reales. |
| `close` | 196 | Cierre/resultado conservados; trap y retorno de foco browser. |
| `reload` | 201 | B206: reintento, vacío confirmado y error diferenciado; controles nativos en ambos gestores. |

O62 añade 15 anclas y 2 archivos: S04 suma 86 anclas/12 archivos, no cierre del sistema. B205–B208 con rojos nativos; 15 casos nuevos, suite final 1453, tipos/lint/build salida 0. Biblioteca sólo HTML/SCSS intervenidos; no se acredita lectura completa de LinksComponent TS por esta pasada. Informe extenso: `docs/frontend-design-ux-audit-2026-10-06.md`.


O63 (06/10): revisión del consumidor frontend, alcance local; no cierre global del sistema.

## frontend/src/app/panel/links/csv-import-dialog.component.ts

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `constructor` | 123 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `onFile` | 131 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `onCsvInput` | 142 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `validate` | 147 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `import` | 151 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `retry` | 156 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `close` | 169 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `stillInOpenedWorkspace` | 177 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `send` | 185 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |
| `sendImport` | 219 | O63: cuerpos de clase íntegros/preservados; sólo template/host. Check antes de confirmar, invalidación por edición y reintento409 conservan body/key. Cuatro controles nuevos, nueve anteriores y QA ficticia. File.text pendiente/cierre/contexto asíncrono y commit auxiliar no se cierran por esta pasada. |

## frontend/src/app/core/services/scale-response-decoders.ts

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `decodeBulkActionResponse` | 166 | O63/B210: fuente completa leída; falta literal set-domain del contrato real. Un rojo nativo/dos controles,10 casos decoder verdes y QA de dispatch. Resto de decoders leído sin atribuir cobertura funcional completa; helpers/consumidores compartidos pendientes. |
