# Revisión parcial S05 — frontera temporal de redirección

O59: resolve completo leído desde host/alias hasta snapshot, locks, estados, destino/reglas y consumo. Reproducción native GET /{alias}: deadline -1/0/+1 en18casos (plain/single-use/limited × snapshot/locked), seis rojos de igualdad antes de fix. Después: el rechazo en igualdad no cuenta ni consume used_at/límite; locks/retry/tenant/domain/password/destination/UTM/reglas/audit/webhook sin cambio.115/466extended pasa; regresión626/5795 ycalidad513/0 correctas; Full backend terminal2405:2714pruebas/22466aserciones,796.606s/147MB,exit0 sólo uvh_test; JUnit0errores/0fallos/0omitidos,time791.953155s. Conservadas2599identidades anteriores más115/466nuevas.815/816hashes coinciden, incluido todo backend/frontend/tests/config; sólo scripts/uvh-control.mjs tiene cambio concurrente del usuario, preservado.16/19comparadores pasan; tres rechazan correctamente ese drift. Los manifests históricos no se modifican ni se declara verde su gate global. Prueba acotada íntegra en verify-link-lifecycle-backend-gate.py; revisión de herramienta S13 pendiente. /r/{alias} comparte action, pero no se atribuye nueva ejecución propia de ese path.

## backend-laravel/app/Support/RedirectService.php

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `resolve` | 117 | B199: expiry lte(now) tanto snapshot como locked; fecha cruza durante consulta locked en hooks seriales. Rechazo404 ycontadores0; futuros302/contadores1. No prueba toda concurrencia multiproceso, providers, dominios ni reglas horarias/campaign/UA. |

Lectura adicional host/raíz realizada, sin asignar cobertura funcional completa desde estas pruebas. El now capturado antes de espera también decide reglas horarias: candidato separado de wall-clock todavía sin rojo/ID. Frontend/UX/password page, analytics, timezone de reglas y operación real siguen pendientes; S05 yobjetivoS01–S13 abiertos.
