# O30 — configuración MFA frontend y estado después del commit

Estado: B154–B156 reproducidos y corregidos localmente; verificación final en reporte O30. S01–S13/objetivo global continúan abiertos; O29/B153 verificado1018frontend y22 controles nuevos. Hallazgos iniciales: backend revocaba otras sesiones al activar, reemplazar y desactivar; Settings sólo recargaba sesiones al regenerar códigos. Refresh User fallido dejaba toast temporal y podían reaparecer estado/acciones anteriores. O30 corrige estos casos y la validación de códigos; detalle final en el reporte.

- [x] Leer completos cinco flows MFA, decoders, Settings/callers/marca de freshness/refresh, admission y controllers; separar sólo transporte cuando el contrato quede caracterizado.
- [x] Reproducción con HTTP/API/decoders/Auth y Settings reales: enable/disable revocan otros accesos pero lista permanece; GET me fallido/malformado tras confirmar MFA conserva ACK/codes y muestra estado desconocido persistente, no antiguo. Rechazo de command no finge commit. Red antes de fixes.
- [x] Corregir proyección/recarga y señal persistente para datos pendientes sin reintentar commands, borrar códigos recién emitidos ni publicar otra identidad. Revisar interacción con profile/email B153 y lectura vieja durante un write nuevo. Mantener busy/secret/step-up/expected-account y contexto antes de awaits.
- [x] Extraer gradualmente transporte de configuración MFA sin extraer login/confirmación pública ni duplicar autoridad/lifecycle/guards. Simplificación justificada por5 flows compartidos, sin medir velocidad por líneas.
- [x] Gates dedicados/fullfrontend/lint/tipos/build y QA estados/foco/móvil; backend pruebas sólo si PHP cambia, jamás uvh_local/proveedor real/worker/scheduler. Inventario/hashes/anchors/matriz y reporte. Dejar funciones/roles/gates sin evidencia abiertos.

Secuencial, sin subagentes/worktree/commit/push/deploy/reset/stash. Pruebas DB si necesarias sólo *_test y una suite a la vez; no PHP/tests edits durante suite. Preservar todos los cambios existentes. Scripts y fixtures propios sólo .uvh-runtime; no passwords reales en logs.

Evidencia final:35 nuevos controles;150dedicadas antes del resumen final y1053/1053 full tras el ajuste, lint/tipos/build11,705s exit0. QA fixture estados/codes/manualread/Enter/foco/remount/mobile/resumen final; sin DB/provider.472hashes/339S01/16S03/63S10anchors. Límites y errores de fixture documentados en reporte O30; checkboxes sólo acreditan este alcance local. Objetivo global/S01–S13/roles/gates externos abiertos.
