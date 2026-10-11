# Validación de las ocho mejoras

Alcance: el plan de gestión de enlaces aprobado y la mejora del menú lateral. Esta matriz recoge los flujos y las protecciones que deben conservarse. No sustituye una prueba nativa con dispositivos físicos.

| Requisito | Evidencia en el proyecto | Estado |
| --- | --- | --- |
| Duplicar desde biblioteca y detalle con editor y alias nuevo | Menús de `links.component` y `link-detail.component`; modo `duplicate` y pruebas `link-dialog.workflows.spec.ts` | Implementado y probado |
| Copiar destino, alternativo, dominio, colección, etiquetas, notas, todos los UTM, reglas, fechas, límites, contraseña y página personalizada | Prueba API `test_duplicate_preserves_every_setting_and_excludes_personal_and_campaign_data` | Probado con todos los ajustes a la vez |
| Mantener pausa/archivo; recalcular fechas y advertir una copia caducada | `LinkDuplicateController`, `LinkService::deriveState`; pruebas backend de fechas pasadas y editor de duplicación | Probado |
| Nuevo identificador, cero visitas, uso único disponible, sin favoritos ni variantes de campaña | Pruebas API de duplicación, con favorito y variante existentes en el original | Probado |
| Contraseña conservada en servidor, sustitución o retirada explícita | Contrato `passwordAction`; pruebas de las tres acciones y ausencia de contraseña/hash en el editor | Probado |
| Versiones, cuota, alias, destinos, dominio y relaciones revalidados; rechazar borrados/bloqueados/lectores | Pruebas `LinkWorkflowsTest`; creación y autorización bajo `WorkspaceMutation` y `WorkspaceWriteActor` | Probado |
| Reintentos concurrentes idempotentes y cuota concurrente | `LinkDuplicateConcurrencyTest`: dos procesos con peticiones HTTP reales, barrera de salida y base PostgreSQL independiente | Probado; una copia/acuse/auditoría por clave; solo una plaza disponible |
| Favoritos personales por workspace, incluidos lectores; papelera/restauración/borrado | `LinkWorkflowsTest`, `LinkFavoriteController`, claves foráneas aditivas | Probado |
| Estrella inmediata, consolidación de pulsaciones, reversión y respuestas tardías | `link-favorite.service.spec.ts`, pruebas de contexto y controles de biblioteca/detalle | Probado |
| Filtros personales, criterios completos, límite 50 y nombres de 80 caracteres | `SavedLinkFilterController`, `LinkPreferences`, pruebas de contrato/cuota/privacidad y exportación | Probado |
| Aplicar reinicia paginación; actualizar explícitamente; reparar referencias borradas | Componente de filtros, `saved-link-filters.workflows.spec.ts`, pruebas API de referencias, incluida etiqueta `0` | Probado |
| Avisos a 24 horas/90 %, configurables, sin secretos, con acceso al workspace correcto | Configuración `workflows`, `OperationalNotices`, `UvhMail`, pruebas de avisos/presentación y navegación por notificación | Probado |
| Propietarios/admin/creador que siga siendo miembro, preferencias y deduplicación por generación | Pruebas `OperationalNoticesTest` y `LinkWorkflowsTest`; ledger, admisión y avisos en una transacción | Probado |
| Página por enlace: títulos/mensajes diferenciados, botón opcional y vista móvil/escritorio | `ExpiredPageEditorComponent`, pruebas de límites/normalización y capturas de editor/publicación | Probado |
| Texto plano, URLs validadas al guardar/publicar, sin HTML/scripts/redirección automática | `ExpiredLinkPage`, `VisitorPage`, validación de destinos y reputación; pruebas de contenido hostil | Probado |
| Conservar contraseña, bloqueo, pausa/archivo/eliminación, HTTP 404/410 y ausencia de visitas | Pruebas de admisión, caducidad y agotamiento; respuestas públicas reales y recuentos comprobados | Probado |
| Disponibilidad y metadatos únicamente bajo petición; no cambian el estado | `DestinationInspectionComponent`, pruebas de petición explícita, revisión del enlace y cola real | Probado |
| Resultado fechado con estados diferenciados; título, dominio e icono local seguro | `DestinationInspector`, pruebas de HEAD/GET, errores HTTP, normalización PNG e iconos inválidos | Probado |
| Cambio de URL/sesión/cuenta/workspace/permisos invalida el resultado | Propiedad de inspecciones, versión de seguridad/enlace y `LatestRequest`; pruebas de respuestas tardías y revocación durante la consulta | Probado |
| Transporte seguro: puertos, credenciales, IPv4/IPv6 privados/reservados, todos los DNS y fijación de IP | `Ssrf`, `BoundedDnsResolver`, pruebas SSRF y transporte aislado | Probado |
| Conservar todas las IP fijadas para poder conectar con otra disponible | `SsrfDnsPinningTest`: cURL real y servidor HTTP aislado; prueba de fallo antes de la corrección | Probado |
| Máximo tres saltos, sin descensos HTTPS→HTTP, proxies/cookies/autenticación | `DestinationInspector::follow`, opciones de cURL y pruebas de redirecciones/transporte | Probado |
| No consultar URLs gestionadas por UVH ni generar visitas analíticas | Pruebas de host propio/directo/redirigido y comparación de contadores | Probado |
| Ocho segundos de red, límites HTML/icono/cabeceras/nodos, parser sin recursos externos | Resolver supervisado, cURL acotado y pruebas de timeout, proceso detenido, respuestas grandes, entidades e iconos falsos | Probado |
| Caché, cuotas usuario/workspace, deduplicación y dos trabajadores separados | Configuración y tres Compose; pruebas de caché/cuota compartida/redelivery; dos contenedores locales | Probado |
| Compartir PNG individual/campaña preparado antes del gesto, actualizado al cambiar diseño/URL/tamaño | Generador existente y pruebas del modal/servicio de compartir | Probado en código y navegadores automatizados |
| Cancelación normal, errores/permisos/contexto seguro y alternativa PNG | Pruebas de Web Share; alternativas reales Chromium/Firefox; PNG descargados decodificados con ZXing | Probado |
| Menú nativo real en Android y Safari de iPhone | Hace falta comprobar abrir, adjuntar PNG, cancelar y reintentar en los dos dispositivos | **Pendiente de dispositivos físicos** |
| Contratos versionados, API autenticada, CSRF, aislamiento y autorización transaccional | Decodificadores estrictos, rutas/interceptor, pruebas de MFA/contexto y APIs por rol | Probado |
| Exportar preferencias/personalización y borrar cuenta/workspace sin URLs temporales | `LinkWorkflowPrivacyTest`, `AccountExportDocument`, housekeeping y matriz de exportación actualizada | Probado |
| Controles claros, foco/teclado, estados, microinteracciones y movimiento reducido | Componentes existentes, pruebas de interacción, revisión de Chromium/Firefox/WebKit y capturas a 320 px | Revisado en los estados documentados |
| Menú lateral rápido sin parpadeo, foco, Escape, fijación personal y móvil | Diez pruebas `panel-sidebar-layout.spec.ts`, comprobaciones reales y capturas claro/oscuro | Probado |
| Evitar consultas por fila e índices adecuados | Resolución de referencias en lote; planes PostgreSQL sobre 50.000 enlaces ficticios, transacción revertida | Revisado |
| Migraciones aditivas, backend antes del frontend, activación configurable y observabilidad | Backup local verificado; dos migraciones aplicadas; flag activado; métricas, scheduler y pool de destinos | Aplicado localmente; sin despliegue a producción |

Los logs, los datos ficticios y las capturas están en `.uvh-runtime/link-workflows`, excluidos de Git. Las pruebas destructivas se ejecutan únicamente en bases con nombre terminado en `_test`. Los motores automatizados no prueban la integración con las aplicaciones nativas del móvil.

## Ejecución final

- Frontend: 2.208 pruebas, build, ESLint y tipos de aplicación/pruebas correctos.
- Backend: suite integral con 2.983 pruebas y 34.765 aserciones, sin omisiones; 17 pruebas adicionales dirigidas a duplicación/flujos/cURL, con 153 aserciones, incluyen los dos nuevos casos concurrentes HTTP añadidos después de comenzar la suite integral.
- PHPStan sin errores; Pint comprueba 574 archivos sin cambios de baseline.
- Configuración Compose local válida; los dos pools de colas locales conservan sus trabajadores tras una recarga de código mediante `queue:restart`.
- Prueba nativa Android/iPhone: pendiente, sin teléfonos conectados al entorno de trabajo y con solicitud de comprobación enviada al usuario.

La auditoría Composer no encuentra avisos. La política npm permite seis excepciones preexistentes en herramientas de desarrollo, con vencimiento el 9 de noviembre de 2026; no se han creado excepciones ni añadido dependencias para estas funciones. El resultado de esa política no equivale a ausencia de vulnerabilidades.

Formato y semántica de la lista de IP fijadas: [documentación oficial de CURLOPT_RESOLVE](https://curl.se/libcurl/c/CURLOPT_RESOLVE.html).

## Comprobación pendiente en móviles físicos

Registrar por separado modelo, versión del sistema y versión de Chrome/Android o Safari/iPhone. Usar un origen HTTPS accesible desde el teléfono: `localhost` en el móvil apunta al propio teléfono, no al ordenador donde corre UVH. No abrir una conexión HTTP insegura para sustituir esta prueba.

1. Abrir un QR individual y su sección Archivo. Esperar a que la imagen esté preparada; pulsar «Compartir imagen» debe abrir el menú nativo con un PNG adjunto.
2. Cerrar el menú. La aplicación debe comunicar la cancelación con normalidad, conservar el modal y permitir volver a compartir.
3. Cambiar colores, logo y tamaño. El botón debe esperar al nuevo archivo y compartir la imagen actual, sin reutilizar la anterior. Comprobar la resolución del PNG guardado y leer su QR.
4. Repetir con una variante de campaña: al leerlo debe conservar la URL corta con su identificador `qr`, sin alterar los UTM o el destino.
5. Si la plataforma permite denegar el permiso de compartir, comprobar el aviso y la alternativa «Descargar PNG». La descarga debe usar el mismo diseño y resolución.

Registrar únicamente el resultado observado. La resolución de la promesa del navegador no confirma que otra aplicación entregue el archivo a un destinatario.
