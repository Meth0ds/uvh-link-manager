# Gestión de enlaces: ocho mejoras

Implementación del 11 de octubre de 2026. Las funciones se integran en la biblioteca, el editor, el detalle y el modal QR existentes. El menú principal también incorpora expansión temporal con ratón o teclado, cierre con Escape y una preferencia de apertura por cuenta y navegador.

## Uso y permisos

| Función | Ubicación | Permisos |
| --- | --- | --- |
| Duplicar | Menú de un enlace y detalle | Propietario, administrador, editor |
| Favoritos | Estrella de fila/tarjeta/detalle; filtro «Solo favoritos» | Todos los miembros; preferencias propias |
| Filtros guardados | «Mis filtros», junto a la búsqueda | Todos los miembros; filtros propios del workspace |
| Avisos | Editor, centro de notificaciones, correo y resumen existentes | Propietarios, administradores y creador que conserve su membresía; preferencias individuales |
| Página personalizada | Editor → Acceso → Página de enlace no disponible | Propietario, administrador, editor |
| Comprobar destino | Detalle → Disponibilidad del destino | Todos los miembros con acceso al enlace |
| Vista previa | Editor → Destino → Mostrar vista previa | Propietario, administrador, editor |
| Compartir QR | Modal QR → Archivo → Compartir como imagen | Miembros que puedan consultar el QR individual |

Duplicar abre el editor con un alias nuevo y copia los ajustes, las reglas y la página personalizada. La contraseña se conserva exclusivamente en el servidor; se puede mantener, sustituir o quitar. Las fechas originales no se desplazan automáticamente. Una fecha pasada se advierte antes de crear la copia. Se conservan pausa o archivo cuando corresponde, con un nuevo identificador, cero visitas y sin historial, favoritos ni campañas QR. La creación comprueba la versión del original, permisos, cuota y relaciones dentro de la transacción. La misma solicitud idempotente no crea otra copia.

Favoritos y filtros están separados por usuario y workspace. Las estrellas sobreviven a la papelera y se eliminan con el borrado definitivo. Las pulsaciones rápidas se consolidan; un error revierte el estado y se comunica. Un filtro guarda criterios, nunca resultados ni selección. Aplicarlo reinicia la página; modificar los criterios no sobrescribe el filtro. Las referencias eliminadas exigen reparación explícita. Los cambios utilizan versiones para detectar ediciones concurrentes.

Los avisos mantienen los umbrales de 24 horas y 90 % de uso. Los cambios efectivos de fecha o límite abren una nueva generación, conservando la deduplicación de avisos anteriores. El mensaje incluye alias, motivo y fecha/clics restantes, con acceso al detalle y al workspace correspondiente; no incluye destinos o contraseñas. Los enlaces caducados o agotados no generan avisos anticipados.

Las páginas personalizadas admiten texto plano, dos mensajes independientes y un botón HTTP/HTTPS opcional. Límites: título 80, mensaje 500 y botón 40 caracteres. Se valida el destino del botón al guardar y de nuevo al publicar. No se admite HTML, scripts, CSS, contenido incrustado ni redirección automática. La caducidad conserva HTTP 404; el agotamiento, HTTP 410. Se mantienen el orden de autorización/contraseña/estados, las cabeceras, los dominios personalizados y la ausencia de indexación. Estas respuestas no consumen visitas.

## Consultas de destinos

La resolución DNS de las consultas HEAD/GET se ejecuta en un proceso PHP breve y supervisado, dentro del presupuesto de red. Un resolver bloqueado se interrumpe y se recoge antes de continuar; no queda ocupando el trabajador. Se valida cada dirección devuelta antes de fijar la conexión. El comportamiento POST existente no cambia. El trabajador necesita PHP CLI y `proc_open`, disponibles en las imágenes Docker del proyecto.

Un icono con una URI mal formada se descarta sin cambiar el resultado HTTP ni ocultar el título. Un documento HTML vacío conserva su disponibilidad y utiliza la presentación sin metadatos.

### Revisión adicional de código

Se ha corregido el tratamiento de la etiqueta `0`: es una referencia real y exige reparación si se elimina. La resolución DNS incluye interrupción por tiempo, límite de salida y limpieza del proceso tanto al agotar el presupuesto como al recibir una respuesta inválida. Las pruebas del icono cifrado verifican el formato y la recuperación exacta de la imagen, sin buscar fragmentos que podrían aparecer por azar en el ciphertext.

Validación de esta revisión: 53 pruebas backend, 383 aserciones; 10 pruebas del menú lateral; PHPStan y Pint sin errores. Se ha probado también el transporte HEAD real a `example.org`, con HTTP 200 y sin cuerpo. La comprobación del menú nativo de compartir en dispositivos físicos Android/iPhone continúa pendiente.

Son manuales y no modifican el enlace. La disponibilidad del destino principal distingue respuesta correcta, acceso restringido, error HTTP, fallo de conexión y destino no comprobable. La vista previa muestra título, dominio real e icono local normalizado o neutro. Cambiar la URL invalida la consulta. Ningún resultado se presenta como garantía de seguridad.

El transporte HEAD/GET comparte las protecciones SSRF y conserva la ruta POST existente. Rechaza credenciales, direcciones privadas/reservadas y destinos UVH que podrían consumir usos. Valida todos los registros DNS, fija las IP de conexión y revalida cada una de hasta tres redirecciones. No permite descenso de HTTPS a HTTP ni envía cookies, sesiones o autenticación. Se conserva la comprobación TLS y no se usa un proxy ambiental.

El parser no ejecuta HTML ni accede a recursos externos. Solo acepta iconos PNG/JPEG con firma y decodificación comprobadas; GD los normaliza antes de servirlos desde una ruta privada. Las URLs de inspección y los iconos se almacenan cifrados temporalmente. Los resultados quedan vinculados al usuario, sesión, workspace, permisos y versión del enlace; los resultados obsoletos no se publican.

Las inspecciones usan la cola independiente `destinations`: dos trabajadores inicialmente, timeout de 20 segundos y un intento. La deduplicación impide consultar dos veces un trabajo simultáneo. El scheduler elimina resultados caducados. Los contadores operativos registran resultados y duración sin URLs completas ni parámetros.

## QR y navegación

El archivo PNG se prepara al entrar en Archivo y se reutiliza mientras no cambien URL, diseño, logo, resolución o contexto. `navigator.canShare({files})` comprueba su compatibilidad. La llamada a `navigator.share` permanece en la pulsación original, sin generar el archivo después de perder la activación del navegador. La cancelación es normal; el resultado no afirma entrega a WhatsApp ni a otra aplicación. Ante incompatibilidad o denegación se explica el motivo y se ofrece descargar PNG.

En escritorio, el menú reserva 76 px y se expande a 264 px sobre el contenido: una espera de 70 ms al abrir y 100 ms al cerrar evita cruces accidentales y parpadeos. El teclado expande las etiquetas inmediatamente; Escape cierra la expansión temporal y recupera el foco fuera del menú. El botón permite mantenerlo abierto, recordando la elección por cuenta en el navegador. El modo móvil conserva un panel con apertura explícita, botón de cierre y Escape. Las transiciones respetan movimiento reducido.

## Configuración y despliegue

Las dos migraciones son aditivas:

- `2026_10_11_000001_link_workflows`: página personalizada, generaciones de avisos, favoritos, filtros e idempotencia de duplicación.
- `2026_10_11_000002_create_destination_inspections_table`: resultados temporales de inspección.

| Variable | Predeterminado | Límite efectivo |
| --- | --- | --- |
| `UVH_LINK_WORKFLOWS_ENABLED` | `false` | Activación explícita |
| `LINK_REMINDER_HOURS` | 24 | 1–168 horas |
| `LINK_REMINDER_CLICK_RATIO` | 0.9 | 0.01–0.99 |
| `LINK_SAVED_FILTERS_LIMIT` | 50 | 1–50 por usuario/workspace |
| `DESTINATION_INSPECTION_TIMEOUT_MS` | 8000 | 500–8000 ms |
| `DESTINATION_INSPECTION_HTML_BYTES` | 524288 | 1024–524288 bytes |
| `DESTINATION_INSPECTION_ICON_BYTES` | 262144 | 1024–262144 bytes |
| `DESTINATION_INSPECTION_CACHE_SECONDS` | 600 | 30–600 segundos |
| `DESTINATION_INSPECTION_USER_PER_MINUTE` | 10 | 1–60 |
| `DESTINATION_INSPECTION_WORKSPACE_PER_MINUTE` | 30 | 1–300 |

Desplegar primero backend y ejecutar `php artisan migrate --force`; nunca `migrate:fresh` sobre datos reales. Arrancar los dos trabajadores de destinos y el scheduler, activar la variable en todos los procesos y renovar la caché de configuración si se utiliza. Desplegar después el frontend. Las topologías local, producción y UpCloud incluyen el nuevo pool. Supervisar cola, errores, latencia y entregas duplicadas. Desactivar la función conserva los datos; no ejecutar una reversión destructiva como método de desactivación.

Los favoritos y filtros personales forman parte de la exportación de cuenta; la personalización se exporta con los enlaces creados. La eliminación de cuenta/workspace limpia referencias e inspecciones, sin exportar URLs temporales de borradores. Los trabajos analíticos y de redirección existentes no cambian de contrato.

## API autenticada

Todas las rutas utilizan el prefijo `/api/v1`, sesión verificada, protección CSRF en escrituras y contexto de workspace:

- `GET /link-workflows`: capacidades y configuración pública de estas funciones.
- `POST /links/{id}/duplicate`: versión del original, ajustes y clave de idempotencia.
- `PATCH /links/{id}/favorite`: estado booleano personal.
- `GET/POST /link-filters`, `PATCH/DELETE /link-filters/{id}`: especificaciones v1 y versión para ediciones.
- `POST /links/{id}/destination-inspection`: comprobación del principal con su versión.
- `POST /destination-previews`: consulta de una URL de borrador, requiere edición.
- `GET /destination-inspections/{uuid}` y `/icon`: resultados e iconos privados, con contexto vigente.

## Evidencia de validación

Los logs y capturas se conservan en `.uvh-runtime/link-workflows`, excluido de Git y sin publicar cookies de las cuentas ficticias. La validación funcional utiliza bases PostgreSQL independientes de `uvh_local`.

- 2.208 pruebas frontend pasan; build de producción, ESLint y comprobación TypeScript pasan.
- Las 42 pruebas backend dirigidas a flujos, privacidad, destinos, avisos y correo pasan con 295 aserciones. PHPStan pasa sin ampliar el baseline; Pint comprueba 569 archivos.
- Chromium: duplicación real con identificador nuevo y cero visitas, favoritos, filtro guardado actualizado explícitamente, vista previa y disponibilidad mediante la cola real, personalización guardada y respuestas públicas 404/410 sin incrementar visitas.
- Menú: apertura y cierre reales con ratón, Escape, foco recuperado y preferencia conservada al recargar. El contenido permanece a 76 px durante la expansión temporal.
- QR: con permiso de compartir bloqueado, descarga alternativa real. ZXing decodifica el PNG de 2048 × 2048 px y comprueba su URL.
- Vista móvil de biblioteca, editor personalizado y QR sin desbordamiento a 320 px. Los estados revisados con axe no presentan infracciones WCAG A/AA.

Firefox en Linux y el motor WebKit pasan la revisión del menú, teclado, preferencia, panel móvil, editor personalizado y exportación PNG, sin infracciones axe en los estados revisados. Firefox verifica además la alternativa por ausencia de Web Share; Chromium la verifica con el permiso bloqueado. Los tres PNG descargados se decodifican con ZXing. WebKit comprueba la imagen preparada, pero no la entrega a una aplicación nativa.

Con 50.000 enlaces ficticios en una transacción revertida, PostgreSQL utiliza el índice de workspace/campaña y consulta únicamente los favoritos relevantes para el filtro personal. Las dos consultas paginadas revisadas tardan 0,127 ms y 0,323 ms en esa base aislada; son evidencia del plan de consulta, no una promesa de latencia en producción.

La última suite integral backend pasa con 2.983 pruebas y 34.765 aserciones, con DNS externo habilitado y sin omisiones. Se añadieron después dos casos de concurrencia HTTP y se ejecutaron junto con todas las pruebas de flujos y el caso de cURL real: 17 pruebas y 153 aserciones pasan. Los dos casos concurrentes verifican una copia/acuse/auditoría para reintentos y respeto de la cuota entre solicitudes distintas. El código de aplicación no cambió entre ambas ejecuciones. PHPStan y Pint también pasan; Pint comprueba 574 archivos. Sigue pendiente una prueba manual del menú nativo de compartir en Android y Safari de iPhone; los motores automatizados y los mocks no sustituyen esta comprobación. La política npm conserva seis excepciones preexistentes de severidad alta con vencimiento el 9 de noviembre de 2026; no se añadieron dependencias ni excepciones para estas mejoras.

## Activación local

El 11 de octubre se verificó una copia privada de `uvh_local` y se aplicaron únicamente las dos migraciones nuevas, antes de activar las funciones y actualizar el frontend. El servidor local responde en `http://localhost:4200`; backend, scheduler, cola habitual y los dos trabajadores de destinos están en ejecución. `/health` y `/api/v1/config` responden HTTP 200. La configuración efectiva confirma `workflows.enabled=true` y GD disponible. No se desplegó a producción.

Las colas locales utilizan `restart: unless-stopped`: un `php artisan queue:restart` permite cargar el código nuevo y Docker vuelve a arrancar los trabajadores, conservando dos para destinos. Una parada explícita del contenedor sigue siendo respetada.

Se comprobó además una cuenta ficticia con rol propietario en un workspace y lector en otro: los filtros se cargan únicamente del espacio seleccionado y un lector renombra su filtro con versión nueva sin modificar el del otro espacio, la estrella se guarda en el workspace correcto y una comprobación completa del destino devuelve HTTP 200 al lector sin ofrecer edición ni duplicación. Las rutas nuevas transportan tanto el workspace como la expectativa de cuenta; las escrituras pendientes se invalidan tras cambios de espacio, incluso A → B → A durante una espera CSRF.
