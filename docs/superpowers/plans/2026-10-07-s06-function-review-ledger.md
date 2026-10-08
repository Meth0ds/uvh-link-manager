# Registro parcial S06 — consumidor frontend, 07/10/2026

O65: lectura completa de los dos componentes y sus templates/estilos, helpers de etiquetas/decoders relacionados. Este ledger distingue lectura de verificación específica; no revisa el backend completo ni cierra el sistema. Callbacks anónimos leídos dentro de sus funciones. Specs antiguos preservados; no se atribuye lectura íntegra de todos ellos.

Evidencia: 23 casos nuevos en integrations-ux-recovery.spec.ts; ocho rojos válidos antes del fix; 41 dirigidos iniciales y1513 completos finales. QA del build con API ficticia, sin DB/DNS/TLS/colas/proveedor real. Límites visuales y de transporte del harness se describen en el plan O65.

## frontend/src/app/panel/domains/domains.component.ts

SHA-256: `096096c9930cb1902748ffcbe12365bd04f3a7bad5a50ea258ca75bdd7610d32`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `canEdit` | 89 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `canAdmin` | 95 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `linksLabel` | 101 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `stateLabel` | 103 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `graceLabel` | 116 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `dnsErrorLabel` | 128 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `tlsErrorLabel` | 132 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `isChecking` | 136 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `constructor` | 144 | Efecto de workspace/rol limpia proyección y polling; callbacks completos leídos. QA viewer; permiso definitivo sigue en servidor. |
| `load` | 168 | Lectura vigente/cancelación por workspace; QA503→GET y rol viewer. Sin nueva matriz exhaustiva de decoder/poll. |
| `add` | 191 | B213: sólo limpia el borrador enviado si sigue siendo el actual. Rojo previo y controles de rechazo/borrador sin cambios; idempotencia/contexto preservados. |
| `verify` | 227 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `pollVerification` | 265 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `settled` | 271 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `pollDomainState` | 286 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `wantsMore` | 299 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `attempt` | 300 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activate` | 327 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `pollActivation` | 365 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `settled` | 271 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `disable` | 373 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `setDefault` | 409 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `remove` | 431 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `copy` | 457 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `trackByDomain` | 470 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |

## frontend/src/app/panel/domains/domain-detail.component.ts

SHA-256: `112dedac3ae9141540fb4dc99610880c5dd6f0b2131cfb00380a4ace18bba33f`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `wantsMore` | 94 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `attempt` | 95 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `inTransition` | 101 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `constructor` | 140 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `paramId` | 174 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `currentContext` | 179 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `load` | 185 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `loadActivity` | 234 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `startDnsCheck` | 260 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activate` | 289 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `onRootChange` | 318 | Marca nuevo borrador dirty; control de edición mientras hay save pendiente. |
| `onModeChange` | 323 | Marca nuevo modo dirty; control de edición mientras hay save pendiente. |
| `surfaceModeLabel` | 328 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `syncSurface` | 334 | Sincronización preservada sólo cuando no hay borrador posterior; saveSurface controla la limpieza de dirty. |
| `saveSurface` | 342 | B216: reconciliación canonical sin borrar root/mode modificados durante await. Dos rojos y controles rechazo/borrador intacto; dirty conservado. |
| `trafficStatusLabel` | 381 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activityLabel` | 385 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activityIcon` | 389 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activityTone` | 394 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activityDetail` | 402 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `activityReasonLabel` | 412 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `dnsErrorLabel` | 418 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `tlsErrorLabel` | 419 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `formatDate` | 421 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `graceLabel` | 426 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `observedRoutingLabel` | 443 | B217: ruta saludable describe el CNAME observado sin inventar contraste con destino igual. Un rojo previo y tres controles (destino distinto/address-only/sin observación). No recalcula ni concede salud DNS en frontend. |
| `caaLabel` | 458 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `tlsExpiryLabel` | 470 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `copy` | 481 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |

