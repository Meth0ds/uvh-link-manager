# O100 — paginador español dentro de las rutas privadas

## Problema demostrado en fuente y grafo

appConfig importa MatPaginatorIntl y SpanishPaginatorIntl de forma estática. El cierre de main en el build O98 incluye702422bytes JS y módulos paginator/select/form-field/forms/overlay. La hipótesis de causalidad se comprobará con el mismo build tras mover sólo el provider. Todos los paginadores de producto están en cinco superficies de panel: Links, Papelera, Equipo, Ajustes y QueueSection (colas Admin). No hay paginadores públicos.

## Refactor y contrato

Mover los dos imports y el provider existente al route padre de panelRoutes, cargado ya por loadChildren. Mantener una instancia de Intl compartida por ese inyector, todas las etiquetas españolas, aria, range y cambios de página, incluidos acceso directo y navegación de vuelta. No duplicar configuración en cada componente; no modificar guardias, rutas, componentes ni textos. Dependencias deben quedar detrás del límite lazy sin nuevos loaders/timers. Actualizar el comentario de ownership y la prueba de appConfig para reflejar la frontera real.

## Pasos

- [x] Fuente de appConfig/panelRoutes/paginator Intl y cinco consumidores identificados, baseline O98 con413hashes verificado.
- [x] Pruebas previas que fallen por provider global y ausencia de provider privado; comprobar paginador real con injector lazy y etiquetas/aria/rango/navegación/instancia compartida.
- [x] Mover provider al padre lazy de panel y conservar una sola implementación española.
- [x] Grafo antes/después de main, landing, auth, panel y Links: bytes raw/gzip y presencia de módulos, incluyendo compartidos. Distinguir inicial de la ruta completa y evitar claims LCP.
- [x] Calidad, pruebas dirigidas, suite frontend/build, inventario frontend/hash y terminales; recursos propios cerrados. PHP/SQL/O99 siguen pendientes por Docker apagado y el alcance global sigue activo.

## Resultado verificado

Provider trasladado al padre lazy de panelRoutes; copia española y guardias/rutas intactas.7 nuevos contratos,11 dirigidos y1976 integrales correctos; tipos/lint/build y diff --check exit0. Pruebas con MatPaginator real verifican cinco superficies, aria/rango/cambio de página y misma instancia entre páginas y retorno desde una ruta pública. Red anterior11/7fallos confirma frontera incorrecta antes del cambio.

Bundle inicial Angular raw860,94→522,15kB; CSS global byte-identical. Comparación de JS por unión de outputs (incluyendo compartidos, main y polyfills): inicial737007→398213 (−338794), landing849512→707256 (−142256), login919943→860295 (−59648). Gzip por archivo: inicial204823→126542, landing236105→208543, login254471→238520. Rutas privadas incluyen su módulo padre: Links1239122→1239670(+548), Admin1152111→1152514(+403), sin fingir ahorro total por diferir módulos. Intl/paginator ausentes de cierre inicial y presentes en panel; no claimLCP/HTTP/CPU.

414hashes frontend confirmados antes/después y captura frontend independiente262archivos/1334nombradas/697callbacks. No se reutiliza inventario PHP obsoleto. Todos los runners terminales y puerto9990 cerrado; sin DB/servicios compartidos modificados. Evidencia .uvh-runtime/o100-lazy-paginator/verification-summary.json. O99/PHP/SQL y restantes fases globales continúan pendientes.
