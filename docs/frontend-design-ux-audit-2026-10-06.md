# UVH — revisión de diseño y UX del frontend, 6 de octubre de 2026

La identidad visual tiene una base coherente: Manrope, superficies de papel/tinta, acento cálido, listas con divisores y el recorrido entre dirección corta y destino. Lo que debilita el producto es la jerarquía de las tareas, la densidad de algunas pantallas y la calidad de los estados intermedios. No recomiendo sustituir toda la marca. Recomiendo resolver esos recorridos con el mismo lenguaje visual.

Esta es una revisión directa de código, complementada con pruebas de componentes y navegador. Las primeras correcciones se concentran en biblioteca, colecciones y etiquetas. La lista siguiente distingue **corregido**, **propuesta pendiente** y **candidato funcional por reproducir**. Un criterio de diseño no equivale a una vulnerabilidad ni recibe un ID de bug sin reproducción.

Prioridad **P1**: presentación que puede inducir una decisión equivocada; **P2**: tareas frecuentes, recuperación, legibilidad y accesibilidad; **P3**: pulido y simplificación. Son prioridades de esta revisión UX, no certificaciones de severidad de seguridad.

## Biblioteca y organización

1. **P2 · Corregido · Filtros sin composición clara.** En `frontend/src/app/panel/links/links.component.scss`, `.filters`, cuatro controles ocupaban una cuadrícula de tres columnas y dejaban la ordenación aislada. La búsqueda ahora ocupa todo el ancho y estado/dominio/ordenación tienen etiquetas visibles. La disposición adapta sus columnas al espacio disponible; en móvil hay que conservar la lectura completa de las opciones, no sólo evitar desbordamiento.

2. **P2 · Corregido · Una selección válida parecía estar vacía — B207.** `links.component.html`, selectores de dominio, colección masiva y dominio masivo. Angular Material no mostraba las opciones cuyo valor real es `null`: «Todos los dominios», «Sin colección» y «Dominio de plataforma». Se habilitó explícitamente la selección nullable, sin cambiar los valores del contrato. Tres reproducciones nativas, más un control de selección con cadena vacía.

3. **P2 · Corregido · Demasiadas herramientas con el mismo peso.** `links.component.html`, `.scale-tools`. Etiquetas, colecciones, importación y exportación eran cuatro botones delineados equivalentes. Ahora organización forma un grupo y CSV abre un menú. Importar mantiene su condición de escritura y exportar su estado de actividad. Crear enlace sigue siendo la acción principal.

4. **P2 · Corregido · Metadatos interactivos pequeños y acciones atenuadas.** `links.component.scss`, `.meta .tag` y `.link-actions`. Las etiquetas usaban 10,5 px y las acciones tenían opacidad reducida en reposo. Las etiquetas ahora usan 12 px, foco visible y objetivo de 44 px con puntero táctil; las acciones conservan su visibilidad. Esto mejora lectura e interacción sin afirmar que toda la app cumple WCAG.

5. **P2 · Corregido O63 · Jerarquía de acciones masivas y respuesta de dominio — B210.** `links.component.html`, `.bulk-line`: selección/recuento/cancelar, Etiquetar, Mover y menú Más acciones; los seis comandos restantes conservan handlers, permisos y confirmaciones. El cambio de dominio devolvía éxito desde el servidor pero el decoder no admitía `set-domain`, produciendo un error engañoso. Un fallo nativo y dos controles antes del arreglo; se añade sólo el literal válido, manteniendo rechazo de acciones desconocidas y recuentos inválidos. Browser compilado confirma que el éxito limpia la selección. Las selecciones entre páginas/resultados parciales siguen fuera de esta QA específica.

6. **P3 · Propuesta pendiente · Destinos difíciles de inspeccionar en listas estrechas.** `links.component.scss`, `.dest`, trunca la URL en una línea. El detalle existe; no es una ausencia total de acceso al destino. Dar prioridad al hostname y ofrecer la dirección completa/copiar desde el detalle, también con teclado y táctil. No hacer depender la información únicamente de `title` o hover.

7. **P2 · Corregido · Una colección rechazada borraba lo escrito — B205.** `collections-dialog.component.ts`, `create`/`mutate`. Una respuesta fallida igualmente vaciaba `newName` y recargaba el catálogo. La mutación ahora comunica si tuvo éxito; sólo entonces se limpia el mismo borrador y se recarga. Un borrador más nuevo tampoco se elimina. Un renombrado rechazado conserva filas y mensaje, sin un GET que tape el error.

8. **P2 · Corregido · Error de carga confundido con catálogo vacío — B206.** `collections-dialog.component.ts` y `tags-dialog.component.ts`, `reload` y templates. Un GET fallido terminaba en «Todavía no hay…». Ahora hay estados diferenciados de carga, error con reintento y vacío confirmado. El reintento evita duplicar lecturas activas y mantiene las comprobaciones de workspace.

9. **P2 · Corregido · Gestores con filas y estados poco explicativos.** Ambos diálogos y `panel/scale-dialog.scss`. Se rehízo la composición: propósito breve, nombres legibles, recuentos, acciones contextualizadas y vacío que explica dónde crear/asignar los recursos. Las instrucciones de vacío se adaptan a quien sólo puede leer. Cerrar deja de competir con la acción principal.

10. **P2 · Corregido · Borrar y renombrar una colección tenían el mismo tratamiento.** `collections-dialog.component.ts`, template. Ahora renombrar es una acción de texto y borrar es un icono de peligro con nombre accesible que identifica la colección. Se conservan la confirmación y el comportamiento que deja sus enlaces sin agrupar.

11. **P2 · Corregido · Fusionar sin destino no explicaba cómo salir.** `tags-dialog.component.ts`, `mergeTargets` y sección de fusión. Seleccionar todas las etiquetas deja cero posibles destinos. Ahora se explica que hay que dejar una sin seleccionar y se desactiva el selector sin opciones. El texto muestra el efecto sobre los enlaces; la confirmación existente continúa. No se cambió la semántica del endpoint.

## Jerarquía, navegación y composición

12. **P3 · Propuesta pendiente · Crear enlace se repite tres veces en escritorio.** Comprobado en navegador de la biblioteca: navegación lateral, barra superior y cabecera de página. Determinar una acción contextual principal y una global disponible cuando haga falta. Comprobar móvil, navegación colapsada y permisos antes de eliminar accesos; la redundancia puede ser útil en algunos tamaños.

13. **P2 · Propuesta pendiente · El lenguaje editorial invade texto funcional.** `panel/page-header.component.scss`, `panel/dialog-identity.scss`, estilos de navegación y administración: pequeñas etiquetas en mayúsculas y monospace funcionan como decoración, pero no deberían dominar instrucciones, nombres o datos importantes. Definir una escala común: cuerpo 14–16 px, metadatos aproximadamente 12 px y monospace reservado a URLs/código. Revisar contraste real en ambos temas y zoom, no sólo tamaños declarados.

14. **P2 · Propuesta pendiente · El dashboard retrasa la información que se viene a consultar.** `panel/dashboard/dashboard.component.html:1`, accesos rápidos y onboarding antes de las métricas. La composición puede dedicar demasiado espacio inicial a orientación para usuarios recurrentes. Diseñar variantes para workspace nuevo y recurrente; métricas/actividad antes, primeros pasos en un módulo compacto cuando procede. Requiere QA visual de las dos situaciones, no se declara overflow por inspección.

15. **P3 · Propuesta pendiente · Métrica que repite el tamaño de la selección inferior.** `dashboard.component.html:49`: «Enlaces destacados» cuenta `topLinks.length` y ya explica correctamente su alcance. No es el total de enlaces ni un contador incorrecto. Rebajar su peso como KPI y dejar el recuento en la cabecera del ranking; elegir una métrica útil sólo si la API y su definición la respaldan.

16. **P2 · Corregido O64 · Ajustes concentra demasiadas tareas distintas.** `panel/settings/settings.component.html/ts/scss`: cinco vistas, una tarea visible y las otras montadas mediante `hidden`. Perfil compacto y texto funcional legible; formularios, borradores, códigos MFA y guardado pendiente conservan su instancia. Se mantiene el contrato de salto local sin extraer la lógica de credenciales. **B212/P2:** la lectura fallida de requisitos de cierre dejaba una tarjeta vacía; ahora muestra un error persistente y reintento GET. Un rojo nativo y controles de recuperación sin abrir la operación de cierre.

17. **P3 · Corregido O64 · La navegación de Ajustes no orienta durante el scroll.** Enlaces canónicos y `aria-current="page"` identifican la única vista visible. El clic primario mantiene `replaceState`, sin desmontar formularios; clics modificados y apertura en otra pestaña conservan la navegación del navegador. El destino se revela antes de recibir foco. Su título indica el foco de teclado sin rodear todo el formulario. No se introduce seguimiento del scroll ni un historial por sección.

18. **P2 · Corregido O64 · Sesiones presentadas como cadenas de navegador — B211.** `core/session-agent-label.ts` comparte nombres como «Safari en macOS» entre Ajustes y Centro de seguridad; antes este último sólo truncaba la cadena. El agente técnico se conserva en detalles en Ajustes y las acciones identifican el dispositivo. **B211/P2:** `loadSessions` evaluaba el reloj antes de esperar la respuesta, mostrando sesiones ya caducadas al recibirla. Dos rojos nativos, incluido el límite exacto; se evalúa después de la respuesta vigente. Es presentación, sin admisión indebida atribuida al backend. Caducidad con la pantalla abierta y carreras de revocación del centro requieren revisión adicional.

## Integraciones y administración

19. **P1 UX · Corregido O63 · Token caducado representado como activo — B209/P2 funcional.** `core/api-token-label.ts` y `panel/tokens/tokens.component.ts`: estado activo/caducado/revocado/desconocido según el instante real. Tres fallos nativos previos: caducado, límite exacto y vencimiento con pantalla abierta. Se usa un único temporizador al próximo vencimiento, con limpieza al destruir/cambiar filas y actualización al volver a la pestaña. Trece controles cubren microsegundos sin redondeo anticipado, offsets, fechas inválidas, prioridad de revocación y deadlines distantes. Es presentación: no demuestra una admisión indebida del backend.

20. **P2 · Corregido O63 · Fechas de tokens con hora y contexto.** `tokens.component.html` muestra creación/último uso/caducidad con el formateador localizado compartido, segundos y zona horaria visible; `<time datetime>` conserva el original. Metadatos a 13 px. Sin cambiar precisión persistida ni límites de autenticación.

21. **P3 · Propuesta pendiente · Crear tokens ocupa espacio permanente sobre el registro.** `tokens.component.html`, formulario inicial. El recorrido recurrente suele consistir en consultar/revocar. Ofrecer «Crear token» que despliegue el formulario con alcances comprensibles y caducidad, sin perder el aviso ni la copia del secreto de un solo uso. Esta observación es de composición, no una afirmación de permisos incorrectos.

22. **P2 · Propuesta pendiente · Conectar dominio empieza con terminología técnica.** `panel/domains/domains.component.html:17`: «Apex, flattening y proxies…». Mantener restricciones exactas, pero abrir con un ejemplo de subdominio y un recorrido claro: añadir → configurar DNS → comprobar → activar. Dejar los requisitos avanzados accesibles sin convertirlos en la primera instrucción.

23. **P2 · Propuesta pendiente · Las instrucciones DNS se repiten en tarjetas pendientes.** `domains.component.html`, bloques TXT/CNAME; `domain-detail.component.html` ya proporciona un detalle específico. En la lista, resumir el paso pendiente y la siguiente acción; llevar diagnóstico e instrucciones largas al detalle. No ocultar estados degradados, pruebas de propiedad ni restricciones TLS.

24. **P2 · Propuesta pendiente · Webhooks mezcla configuración e investigación de entregas.** `panel/webhooks/webhooks.component.html`, acordeones de endpoint y entregas/inspector. Diseñar lista compacta con estado y último resultado, y un detalle que reúna configuración e historial. Separar éxito de entrega, reintento y estado del endpoint. Validar navegación de retorno y filtros antes de sustituir componentes.

25. **P3 · Propuesta pendiente · Los errores de entrega dominan las filas.** En el mismo template, eventos y mensajes técnicos se presentan junto al resumen. Usar resumen de resultado/fecha y detalles expandibles para error/cuerpo. Los estilos ya contemplan ajuste de texto: no se afirma un desbordamiento sin reproducirlo. Nunca añadir secretos al resumen para «facilitar el diagnóstico».

26. **P2 · Corregido O63 · Importación CSV por pasos.** `links/csv-import-dialog.component.ts`: elegir archivo o pegar, comprobar y confirmar el recuento importable. Ayuda avanzada expandible y resumen que distingue comprobación e importación real. El botón de importación exige una comprobación vigente; editar invalida el informe. Cuatro controles nuevos y los nueve antiguos conservan recuperación y cuerpo/clave del reintento 409. El contenido se desplaza dentro de una altura acotada, manteniendo las acciones visibles también a 320×568.

27. **P2 · Corregido parcialmente O63 · Un solo ejemplo CSV completo.** El placeholder usa una cabecera `alias,destination,tags_json` y dos filas completas; la ayuda conserva la alternativa `tags` y la advertencia de nombres con punto y coma. Pendientes: descarga de plantilla y nueva ejecución del ejemplo contra el parser Laravel real. Esta pasada valida presentación/contratos del consumidor con API ficticia; no añade un Bug ID de parser.

28. **P2 · Propuesta pendiente · Administración usa texto demasiado pequeño para operar.** `panel/admin/admin.component.scss`, `.system-overview`, `.check-row`, `.outbox-main` y `[data-label]::before`: numerosos tamaños de 8,5–10,5 px. Elevar el texto funcional y diseñar columnas según espacio disponible. Las decisiones operativas necesitan leer consecuencias y estados sin zoom constante. La revisión actual de administración es de estilos y fragmentos, no de toda su lógica.

29. **P3 · Propuesta pendiente · Movimiento genérico en controles y secciones.** `frontend/src/styles.scss:442`, hover con desplazamiento para botones Material, y animaciones de entrada. El soporte de movimiento reducido ya existe. Simplificar animaciones repetidas en pantallas de trabajo y reservarlas para cambios con significado; revisar respuesta con teclado y touch, no sólo hover.

## Accesibilidad y comunicación

30. **P2 · Propuesta pendiente · Acciones del equipo sin contexto accesible.** `panel/team/team.component.html:47`/`:56`: varios selectores se llaman «Rol» y botones «Eliminar miembro». Añadir nombre/email del miembro a sus etiquetas accesibles. Mantener visibles el rol y la identidad, y comprobar lector de pantalla/foco después de quitar una fila. No se atribuye un fallo de autorización a estas etiquetas.

31. **P3 · Propuesta pendiente · «Ver detalle» no ofrece navegación nativa.** `panel/notifications/notifications.component.html:48` usa un botón con `openDetail(item)`. Puede impedir abrir el destino en otra pestaña con el comportamiento habitual de un enlace. Antes de sustituirlo, revisar el efecto de marcar como leído y el cálculo seguro del destino. Diseñar un enlace real cuando existe destino, conservando aparte la operación de lectura; no cambiar sólo el tag y perder ese comportamiento.

32. **P3 · Propuesta pendiente · El estado público incluye instrucciones internas de validación.** `public-status/public-status.component.html:34`: la explicación sobre comprobar la independencia del monitor en despliegue corresponde al runbook. Mantener para visitantes frescura, última lectura, incidencias y significado de «desconocido»; mover las tareas operativas a documentación. No sustituir ausencia de señal por verde ni inventar garantías de disponibilidad.

33. **P2 · Corregido · Selección de etiquetas sin nombre accesible — B208.** `tags-dialog.component.ts:50` vinculaba `attr.aria-label` al componente Material, pero el input de checkbox quedaba sin etiqueta en el árbol accesible. Se cambió a la propiedad `aria-label` que Material transmite al control nativo. Reproducción nativa antes del cambio: un fallo y diez controles. El navegador compilado confirma los nombres específicos después del arreglo. No equivale a una revisión completa con lectores de pantalla reales.

## Orden recomendado de los siguientes lotes

1. Completado O63: estado/caducidad de tokens y presentación temporal con controles de límites.
2. Completado O63: acciones masivas y recorrido CSV; pendiente validar el ejemplo con parser real y descarga de plantilla.
3. Dividir visualmente Ajustes y unificar sesiones, cuidando la vida de borradores y secretos.
4. Simplificar dominios/webhooks por tarea y diagnóstico.
5. Afinar dashboard, navegación global, tipografía de administración y microinteracciones.

En cada lote: leer código completo de las funciones afectadas, demostrar primero cualquier bug funcional, conservar controles de permisos/contexto, comprobar teclado/móvil/temas y documentar qué queda sin validar. No cerrar todo S01–S13 por este informe.

## Evidencia de la primera intervención O62

- Cinco archivos de producto: HTML/SCSS de biblioteca, dos gestores y estilos compartidos de gestores. Dos nuevos specs, 15 casos; los 108 specs de la foto anterior se conservan íntegros.
- B205/B206: cuatro fallos nativos antes del arreglo, más controles posteriores de recuperación/empty/error/borrador. B207: tres fallos y un control con el template original completo; la reproducción definitiva espera a que Material termine de resolver la selección.
- Regresión dirigida inicial: **45/45**. Tras añadir B208 y el ajuste móvil, suite completa final: **1.453/1.453**. Tipos/lint/build finales con salida 0; logs y comparación de fuentes en `.uvh-runtime/o62-frontend-ux/`. Los fallos de preparación/timing del harness están conservados y separados de las reproducciones válidas.
- QA con Angular compilado real y API ficticia en memoria, loopback 8446. Capturas de biblioteca/gestores, estados de error y recuperación; ningún dato de `uvh_local`, correo, cuenta ni proveedor real utilizado.
- El navegador confirma presentación y recorrido en esta fixture. No certifica integración de producción, lectores de pantalla reales, grandes catálogos, rendimiento global ni todos los permisos de la API. El backend no se modifica por esta intervención.

Guías de referencia: skill `frontend-design` y [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Las observaciones concretas se apoyan en las fuentes del proyecto y la evidencia indicada.


## O63 — tokens, acciones masivas y CSV (06/10)

B209/P2: tokens caducados parecían activos, también en el instante límite y con la vista abierta; tres rojos nativos,13 controles finales. Temporizador único al próximo vencimiento, cleanup y visibilidad; fechas localizadas con segundos/zona y estados desconocidos conservadores. B210/P2: decoder rechazaba el éxito set-domain del bulk; un rojo/dos controles, sólo se agrega el literal documentado.

Barra masiva con Etiquetar/Mover/Más acciones y confirmaciones/handlers originales. CSV elegir/pegar→comprobar→confirmar, ayuda expandible y un ejemplo tags_json; cuatro controles UI nuevos conservan body/key al reintentar409. Diálogo acotado en móvil320×568. Total20 casos nuevos,1473/1473frontend; tipos/lint/build de entrega salida0. Nueve archivos producto,822 hashes finales,810 fuentes previas ajenas y110 specs anteriores intactos; clase CSV íntegra conservada. Inventario499/2369named/1233anonymous/3firmas/0provisional; S04ledger97/14 yS07ledger30/5. Comparador/terminales/QA en `.uvh-runtime/o63-frontend-actions/`.

Informe33 puntos actualizado:5/19/20/26 resueltos,27 parcial (parser real/descarga pendientes). Próximo visual: Ajustes/sesiones ydominios/webhooks; también pendientes despacho auxiliar bajoTX exterior/CSV, AuthService/frontendauth, S13 estático yrelease/migraciones/gates externos. Este lote no cambia backend/DB/correo/proveedores reales ni acredita perfección/cierre S01–S13.
