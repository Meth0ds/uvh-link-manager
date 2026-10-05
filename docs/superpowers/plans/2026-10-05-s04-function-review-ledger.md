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
| `update` | 273 | Cuerpo completo leído/compared; actor se bloquea en su TX original y fallback interno/bearer preservado. B188/consumidores de browser y5rutas API; optimistic version/cuota/colecciones/tags/rules/dispatch conservados. Audit de éxito específico/retención/capacidad/otros helpers pendientes. |

## O57 — B190/P1 y B191/P1

23operaciones directas/bulk/recursos relacionados devuelven200/201 ante fallo específico de outbox e interrupcióntrasINSERT:46rojos. Dos rojos más CSV sellaban ACKsin resumenrecuperable. Trigger PostgreSQL58000 específico permite genérico;24controleshistoria trasfixturebulk-move corregida. Actor capturaIP yadmite link.create/update/state/appeal/delete/restore dentro de TXoriginal;purge conserva metadataalias/factor en su commit.Bulkevento específico yACK juntos;catchThrowable libera sólo lease propio. Wrapper admite callbackespecífico conresultado antes degenérico. CSV resumen yACK juntos alfinal; filas preconfirmadas permanecen y reintento no duplica.

72/879verde inicial,101casos nuevos con23rollbackexterior SQL/5bearer/1guardTX.520/3585dedicadas en91.66s,Pint509/PHPStan0. Full backend2501/21544,424.676s/143MB,exit0handle38136;JUnit422.282519s/errors0/failures0/skipped0.809hashes congelados comprobados después del terminal.799archivos previos ajenos ytodos los tests anteriores intactos;nueve archivos completos comparados contransformacionesdeclaradas,Auditglobal/autoridad/dispatch/payloads/quotas/stepup conservados. Inventario496/2287named/1187anonymous/3signatures;noFrontendni medición delatencia. HooksafterINSERTytrigger SQL establecen la garantía local, no todas las carreras/host/TLS/provider. Auxiliares bajoTXexterior/internal callers yexpiraciónexactabearer siguen gates separados.
