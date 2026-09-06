# Lote de estabilidad frontend — 5 de septiembre de 2026

Este lote se realizó antes de continuar funciones opcionales. Corrige 38 modos
de fallo reproducibles (`BAF-143`–`BAF-180`) sin migraciones, escritura en bases
de datos ni llamadas a servicios reales. Comparten pocas soluciones para evitar
parches divergentes, pero se enumeran por comportamiento observable.

## Inventario corregido

| ID | Modo de fallo anterior | Cierre aplicado |
|---|---|---|
| BAF-143 | Dashboard mantenía métricas del workspace anterior durante la carga. | Limpieza síncrona al cambiar contexto. |
| BAF-144 | Dashboard aceptaba su `Promise.all` después de destruir la vista. | Guard por revisión, contexto y `DestroyRef`. |
| BAF-145 | Analítica mantenía datos autorizados del workspace anterior. | Limpieza inmediata de `overview`. |
| BAF-146 | Una respuesta lenta de periodo/workspace podía vencer a la reciente. | Sólo la última petición del contexto puede publicar. |
| BAF-147 | Dominios retenía o restauraba la lista de otro workspace. | Limpieza y guard independiente de carga. |
| BAF-148 | El resultado de iniciar verificación DNS actualizaba otro workspace. | Se captura y revalida el workspace original. |
| BAF-149 | El resultado de activar TLS actualizaba otro workspace. | Se captura y revalida el workspace original. |
| BAF-150 | El sondeo DNS seguía tras cambiar de workspace. | Guard de sondeo invalidado por contexto. |
| BAF-151 | El sondeo DNS seguía tras destruir el componente. | `DestroyRef` invalida la revisión y evita avisos tardíos. |
| BAF-152 | El sondeo TLS seguía tras cambiar de workspace. | Guard de sondeo invalidado por contexto. |
| BAF-153 | El sondeo TLS podía mostrar un aviso tras cerrar la vista. | Comprobación final de vida/contexto. |
| BAF-154 | Enlaces mostraba títulos y destinos del workspace anterior durante la carga. | Borrado síncrono de filas y total. |
| BAF-155 | Una búsqueda, filtro o página lenta podía sobrescribir la selección reciente. | Revisión monotónica por petición. |
| BAF-156 | La lista de webhooks podía cruzar el cambio de workspace. | Borrado inmediato y guard de carga. |
| BAF-157 | Las entregas tardías de un webhook se insertaban en el workspace nuevo. | Guard independiente por fila expandida. |
| BAF-158 | Varias filas de entregas no podían protegerse con un único guard sin bloquearse entre sí. | Un guard por ID de webhook. |
| BAF-159 | Un secreto de webhook recién generado seguía visible al cambiar de workspace. | Limpieza del formulario y secreto al cambiar contexto. |
| BAF-160 | Una creación tardía podía revelar el secreto del workspace anterior. | Guard independiente para mutaciones con secreto. |
| BAF-161 | Tokens podía mantener/restaurar la lista del workspace anterior. | Limpieza inmediata y guard de carga. |
| BAF-162 | Token plano, contraseña y factor MFA quedaban en memoria al cambiar workspace. | Borrado síncrono de los tres valores. |
| BAF-163 | Una creación tardía podía añadir token y secreto al workspace nuevo. | Guard de mutación por contexto. |
| BAF-164 | La paginación de Equipo podía publicar detalle del workspace anterior. | Revisión por workspace también en recargas recursivas. |
| BAF-165 | Detalle de enlace retenía enlace/reglas tras cambiar autorización. | Limpieza y guard de la carga principal. |
| BAF-166 | Analítica de enlace aceptaba periodos o contextos obsoletos. | Guard independiente de analítica. |
| BAF-167 | Actividad de enlace aceptaba el contexto anterior. | Guard independiente de actividad. |
| BAF-168 | Los componentes anteriores no compartían una defensa uniforme ante destrucción. | `LatestRequest` centraliza revisión, contexto y `DestroyRef`. |
| BAF-169 | Fallar al limpiar `sessionStorage` degradaba una escritura local ya exitosa. | Escritura y limpieza son operaciones independientes. |
| BAF-170 | Con cuota local agotada, un token local antiguo ocultaba el nuevo de sesión. | Marca temporal acotada y selección del registro más reciente. |
| BAF-171 | Arrays coercibles y estados desconocidos se aceptaban como tokens activos. | Validación estructural estricta de JSON persistido. |
| BAF-172 | Una caducidad manipulada retenía una intención más de 24 horas. | Cota local máxima y fechas finitas. |
| BAF-173 | Acceder a `window.localStorage` podía lanzar antes del bloque defensivo. | Acceso a cada Storage dentro de su propio `try`. |
| BAF-174 | Una invitación reaparecía si `removeItem` fallaba pero `getItem` funcionaba. | Tombstone en memoria hasta una captura nueva. |
| BAF-175 | Invitaciones persistidas aceptaban tipos coercibles, TTL excesivo o JSON roto repetido. | Tipos exactos, cota de siete días y purga defensiva. |
| BAF-176 | Un rechazo de la librería QR dejaba spinner eterno y rechazo no manejado. | Ruta de error visible y promesa capturada. |
| BAF-177 | La generación QR actualizaba señales después de cerrar el diálogo. | Comprobación de `DestroyRef` antes de publicar. |
| BAF-178 | Texto de URL sin acotar llegaba al nombre sugerido del PNG. | Caracteres permitidos y longitud máxima. |
| BAF-179 | Exportación y códigos MFA revocaban el Object URL antes de consumir el clic. | Helper común con revocación diferida y limpieza en error. |
| BAF-180 | IDs fraccionarios/inseguros llegaban al header de workspace y `matchMedia` ausente rompía webviews. | Enteros seguros positivos y detección de capacidad del navegador. |

## Evidencia ejecutada

- `npm test -- --watch=false --browsers=ChromeHeadless`: **125/125**.
- `npm run typecheck`: correcto.
- `npm run build`: correcto; artefacto en `frontend/dist/uvh`.
- Regresiones nuevas para el guard asíncrono, cambio de workspace en Analítica,
  destrucción del Dashboard, Storage parcial/malformado, invitaciones, QR,
  descargas y selección de workspace.

Esto no acredita E2E autenticado, comportamiento visual en navegadores reales,
cancelación física de las peticiones HTTP ni despliegue. Los guards impiden que
una respuesta tardía publique datos; no sustituyen autorización del backend.
