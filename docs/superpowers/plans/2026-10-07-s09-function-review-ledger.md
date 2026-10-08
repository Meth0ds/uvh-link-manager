# Registro parcial S09 — O66, 07/10/2026

Código completo de estas fuentes y sus HTML/SCSS leído. Callbacks anónimos leídos dentro de sus funciones; enumeración no implica verificación exhaustiva. Se conservan las 116 specs anteriores. Diez rojos válidos y 28 casos nuevos; suite final 1541. No DB ni autorización/proveedores reales. S01–S13 permanecen abiertos.

## frontend/src/app/panel/dashboard/dashboard.component.ts

SHA-256: `3da150265b76358ac29dd129a6027290e5f2b15c10a9fbf425f502aac34ec0de`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 82 | Resetea ambos lectores y datos al cambiar workspace. ABA/null en nuevos casos; contexto/auth completo del backend pendiente. |
| `load` | 100 | B219/P2: lecturas independientes. Dos rojos de fallo parcial; carga lenta/recuperación/contexto en casos nuevos. |
| `loadAnalytics` | 106 | Periodo/reintento sólo de analítica. Supersession, ABA, null y destrucción en casos actuales/previos. GET preserva decoder y AbortSignal. |
| `loadRecent` | 130 | Publica enlaces independientemente, conserva último éxito y muestra error persistente. Primer fallo no inventa workspace vacío; GET de recuperación acotado. |
| `setPeriod` | 156 | Rojo del GET duplicado. Ahora conserva la lectura de enlaces y solicita sólo analítica; periodos previos no sobrescriben el nuevo. |
| `newLink` | 166 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `copy` | 175 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `displayUrl` | 188 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `formatCount` | 192 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `geoPct` | 199 | B218/P2: denominator de todos los clics, no países top8. Dos rojos; control cero, proporción completa, clamp. B222/P2 está en CSS, dos rojos de color calculado. |
| `flag` | 206 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
| `countryName` | 213 | Lectura completa en contexto. Sin rojo ni nueva prueba específica de esta función; controles previos y QA sólo cubren los escenarios registrados. No se acredita ausencia global de bugs. |
