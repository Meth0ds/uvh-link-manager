# Findings & Decisions

## Requirements
-

## Research Findings
- El caso `preview-only` es principalmente un error de validación/estado de la interfaz: el backend no activaba ninguna cuenta sin token real. No equivale por sí solo a una vulnerabilidad de verificación bypass.
- Los tokens de email, reset, recuperación, cambio de email, eliminación, incidente e invitación se emiten con `Ids::randomToken(32)`: base64url sin padding, 43 caracteres.
- `authBearer` devolvía cualquier cadena del fragmento o query. Ahora filtra la forma común de los tokens emitidos; la API siempre decide existencia, caducidad y consumo al ejecutar la acción.
- La primera batería de tests falló porque algunos fixtures insertaban a mano `verify-`/`reset-` + 16 bytes; la historia del emisor de producción revisada (incluido el commit inicial) usa `Ids::randomToken(32)` sin prefijo. No se encontró emisión real de esos formatos de fixture; se actualizaron a la forma emitida.
- Los enlaces nuevos usan fragmento `#token=`; existe lectura de query por compatibilidad. Cada pantalla inspeccionada limpia la URL con `Location.replaceState` tras leerla.
- `routes/api.php` aplica CSRF a la API de navegador, limitadores a acciones públicas con token y `uvh.auth`/roles en rutas privadas inspeccionadas. La integración por token API está separada de cookies.
- El análisis estático dirigido no encontró `innerHTML`, bypass de sanitización Angular ni eval en el frontend. Los links externos inspeccionados usan `noopener noreferrer`; CSP, no-store y cookie segura aparecen en la configuración de producción. Esto no demuestra ausencia de XSS o fallos de autorización en todos los flujos.
- `npm audit --omit=dev` y `composer audit` informaron cero avisos para dependencias de producción en el momento de la consulta.
- La batería global corrió con 559 pruebas de frontend y 791 pruebas Laravel antes de añadir un test dirigido adicional. El test nuevo confirma que tokens con forma correcta pero ausentes en DB reciben `400` en verify y reset, sin usuario ni token creado. PHPStan, Pint, ESLint, typecheck y build también pasan.
- Límite explícito: un token de 43 caracteres que no existe aún puede mostrar el formulario hasta pulsar confirmar. La interfaz sólo conoce la forma; el backend comprueba existencia/caducidad/consumo. Añadir una consulta pública previa crearía otra superficie y seguiría sin garantizar validez al momento del uso.
- La auditoría previa del proyecto aún documenta trabajo de integridad de artefactos y puertas externas de producción sin cerrar; esta pasada no equivale a una certificación integral de seguridad ni a probar infraestructura externa.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Parche inicial sobre plantilla de hallazgos falló por encabezado distinto | Se leyó la plantilla y se aplicó al encabezado real. |
| Tres pruebas Laravel fallaron tras endurecer el formato del token | Los fixtures fabricaban un formato que nunca emite la aplicación; se cambiaron a 32 bytes y la batería volvió a pasar. |

## Resources
-
