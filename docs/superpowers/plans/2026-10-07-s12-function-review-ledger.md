# Registro parcial S12 — O66, 07/10/2026

Código completo de estas fuentes y sus HTML/SCSS leído. Callbacks anónimos leídos dentro de sus funciones; enumeración no implica verificación exhaustiva. Se conservan las 116 specs anteriores. Diez rojos válidos y 28 casos nuevos; suite final 1541. No DB ni autorización/proveedores reales. S01–S13 permanecen abiertos.

## frontend/src/app/panel/panel.component.ts

SHA-256: `f5adac55ec377228538202dce0545c3153a5005bc33c4844f78bdfd117b137cf`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `roleLabelFor` | 86 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `constructor` | 110 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `onWorkspaceChange` | 168 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `skipToContent` | 172 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `newLink` | 180 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `createWorkspace` | 187 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `logout` | 200 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |

## frontend/src/app/panel/getting-started/getting-started.component.ts

SHA-256: `81c7577fce49d80fec71e1a973dcae3a3446ddde95af0e3fd3d968cf5457b6fb`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 66 | Reset por contexto y destroy. Casos de ABA y propietario viejo no liberando slot nuevo. |
| `reload` | 80 | Lectura vigente por contexto y decoder mantenidos. 14 pruebas previas ejecutadas con suite; no nueva revisión exhaustiva backend. |
| `isCurrent` | 85 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `dismiss` | 105 | Follow-up dentro de la operación. Rechazo actual recupera verdad del GET; tardío no publica error en otro contexto. |
| `resume` | 109 | Rojo de review/GET en workspace nuevo. ABA, account/role, destroy y bloqueo opuesto en nuevos casos. |
| `setHidden` | 119 | B220/P2 respuesta fuera de contexto y B221/P2 PATCH opuestos simultáneos. Tres rojos; operación/contexto/destroy guard, slot exclusivo, finally del dueño. |
| `isCurrent` | 123 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
