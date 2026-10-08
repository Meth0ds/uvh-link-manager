# Registro parcial S08 — consumidor frontend, 07/10/2026

O65: lectura completa de los dos componentes y sus templates/estilos, helpers de etiquetas/decoders relacionados. Este ledger distingue lectura de verificación específica; no revisa el backend completo ni cierra el sistema. Callbacks anónimos leídos dentro de sus funciones. Specs antiguos preservados; no se atribuye lectura íntegra de todos ellos.

Evidencia: 23 casos nuevos en integrations-ux-recovery.spec.ts; ocho rojos válidos antes del fix; 41 dirigidos iniciales y1513 completos finales. QA del build con API ficticia, sin DB/DNS/TLS/colas/proveedor real. Límites visuales y de transporte del harness se describen en el plan O65.

## frontend/src/app/panel/webhooks/webhooks.component.ts

SHA-256: `944c9fc5acd3b4401a58af55bf2eac3f69fc5b8ffbfb9cae8dbcc5dfa4d5b2c4`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 118 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `load` | 146 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `toggleEvent` | 169 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `resetForm` | 173 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `startCreate` | 182 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `startEdit` | 188 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `save` | 198 | B214: guard vigente antes de snackbar tras PATCH; dos rojos por workspace/rol. Control éxito vigente y secreto de creación un uso fuera de live region. |
| `copySecret` | 243 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `clearSecret` | 257 | Ocultación explícita del secreto ficticio; control DOM nativo. |
| `toggleActive` | 261 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `test` | 278 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `remove` | 295 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `onDeliveriesToggle` | 321 | Sólo abre→GET diferido; cierre no borra ni reconsulta. Control DOM nativo. |
| `formatDate` | 325 | Resumen localizado de la entrega con time datetime original; presentación, sin nuevo límite temporal. |
| `loadDeliveries` | 327 | B215: refresh fuerza nueva lectura y supersede GET anterior; conserva filas ante503 y reintento GET. Controles supersession/workspace/recovery. |
| `resend` | 361 | B215: después de ACK espera GET autoritativo; no inventa array vacío ni repite POST en retry. Reenvío bloqueado durante read/error. Dos rojos y control read-recovery. |
| `trackByWebhook` | 381 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |

## frontend/src/app/panel/webhooks/webhook-inspector.component.ts

SHA-256: `e8d73172195eea3cdf09937526f31a3a872774e798acd79cf6f286f650913fc4`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 62 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `paramId` | 96 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `currentContext` | 101 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `load` | 109 | Función completa leída, sin cambio; QA rutas/lista propia/historial fixture. No acredita todos los filtros/paginación/backend. |
| `sendTest` | 151 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `resend` | 172 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |
| `payload` | 190 | Función completa leída, sin cambio. Conserva proyección filtrada; HTML details muestra error sin secreto. |
| `formatDate` | 201 | Código completo leído, sin cambio O65 ni nueva prueba específica. Controles previos se ejecutan en suite completa; carreras, matriz de roles/errores y operación real siguen revisión separada. |

