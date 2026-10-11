# Nombres internos y búsqueda global

## Uso

El editor admite «Nombre del enlace — opcional» en Destino. El nombre identifica
el enlace en la biblioteca, su detalle, la papelera y el selector QR. La URL
corta sigue visible y mantiene su función. Los enlaces antiguos conservan su
presentación y no necesitan rellenar un nombre.

Se puede buscar por nombre y ordenar Nombre A–Z / Nombre Z–A; estos órdenes
pueden guardarse en Mis filtros. Una vista previa de destino solicitada muestra
«Usar como nombre». La sugerencia nunca se aplica automáticamente: sustituir
un nombre requiere confirmación y cambiar el destino descarta el resultado.

La barra superior abre Buscar…; también Ctrl+K o ⌘K. La paleta muestra el
workspace, acciones permitidas, navegación, enlaces y dominios. Los otros
workspaces de la membresía aparecen como cambios explícitos de contexto.
«Abrir editor QR» pide elegir un enlace y recupera sus datos vigentes.
«Ver todos los enlaces» aplica la consulta a la biblioteca y reinicia la página.

Flechas recorren resultados, Enter abre y Escape cierra. Desde Elegir un enlace
para QR, el primer Escape vuelve a la búsqueda. El foco se contiene en el
diálogo y se restaura al cerrar, también al abrir mediante un clic en Safari.
En móvil ocupa el área visible de la pantalla, se reajusta con el teclado,
mantiene el buscador y permite desplazar resultados.
Admite temas claro/oscuro y movimiento reducido.

## Contratos y seguridad

- `name`: nullable, hasta 120 caracteres Unicode, texto plano, sin controles ni
  caracteres de formato. Espacios exteriores recortados; vacío se guarda `null`.
- Nombre compartido por el workspace; no se exige unicidad ni cambia el alias.
  PATCH omitido conserva el nombre y `null` explícito lo borra.
- Creación, duplicación, plantillas, API con token, CSV y descarga de cuenta
  conservan el campo. Los CSV anteriores siguen aceptándose; `name` se añade al
  final del export y utiliza la protección existente frente a fórmulas.
- Endpoint `GET /api/v1/search`: sesión verificada y membresía del workspace,
  limitador `uvh-status`, máximo 200 caracteres. Desde dos caracteres y con
  debounce de 180 ms en el cliente.
- Máximo diez enlaces y cinco dominios, con indicadores de filas adicionales.
  La proyección excluye destinos, notas, credenciales y verificaciones DNS.
  No incluye enlaces eliminados ni consultas de otros workspaces.
- Coincidencias de nombre, alias, destino y notas con patrones literales:
  `%` y `_` no amplían la búsqueda. Prioriza exactos y prefijos de nombre/alias,
  con desempate estable por identificador.
- Navegación y permisos de edición compartidos con el panel. Lectores pueden
  consultar y abrir QR; no se ofrece crear enlaces. No hay pausa, eliminación,
  publicación ni otras mutaciones directas desde la paleta.
- Cambiar cuenta, sesión, membresías, rol o workspace invalida el contexto y
  aborta lecturas. Una respuesta tardía nunca abre un resultado del contexto
  anterior. Consultas y resultados no se persisten en almacenamiento local.
- Resaltado mediante nodos de texto; nunca HTML procedente de nombres o búsquedas.
- La inspección de destinos conserva su transporte y sus protecciones; solo se
  ejecuta al solicitarla expresamente.

## Despliegue

1. Respaldar la base de datos y aplicar
   `2026_10_11_000003_add_link_names.php` mediante `php artisan migrate --force`.
2. Publicar el backend compatible y reiniciar trabajadores según el despliegue
   habitual; mantener su configuración de cookies y colas.
3. Publicar el frontend. El decoder admite respuestas anteriores sin `name`.

La migración es aditiva: columna nullable e índice parcial
`links_workspace_name_index` sobre workspace, nombre normalizado (alias como
alternativa) e identificador, excluyendo enlaces eliminados. Se construye con
CREATE INDEX normal; planificar su bloqueo de escritura en bibliotecas grandes.

## Evidencia de validación

Las pruebas de `LinkNamesSearchTest` cubren nombres Unicode, límites, controles,
PATCH, versiones, duplicación, aislamiento, revocación, lectores, proyección,
patrones literales, orden, plantillas, CSV y exportación de cuenta. La búsqueda
no expone dominios ajenos incluso ante una relación antigua inconsistente.

Las pruebas frontend cubren respuestas antiguas, permisos compartidos,
cancelación, consultas consolidadas, estados de error, teclado, contenido hostil,
cambio de workspace, lecturas QR tardías y sugerencias que no pisan ediciones.

QA en Chromium y WebKit comprobó flujos reales, teclado, foco, editor QR,
creación, cambio de workspace, lectores, 320 px y movimiento reducido. Axe no
reportó infracciones WCAG A/AA en la paleta con tema claro y oscuro. Se revisaron
capturas de escritorio y móvil. WebKit automatizado no sustituye una prueba en
un iPhone con teclado físico o virtual.

Firefox queda pendiente de revisión: el runtime de este entorno no pudo abrir
su perfil y el lanzamiento gráfico falló por restricciones del sandbox de
macOS. Se intentaron perfiles propios y una instalación aislada nueva, sin
modificar la caché global ni reducir las protecciones del sistema.

EXPLAIN ANALYZE en PostgreSQL 16 con 50.000 enlaces ficticios: la ordenación por
nombre utilizó el índice parcial (0,599 ms de ejecución); la búsqueda por
contenido con ranking devolvió once filas mediante una única consulta y un
sort top-N (245,586 ms bajo carga de QA). No hay consultas por fila ni recuentos
completos en la paleta. La búsqueda con comodín inicial aún requiere escanear
filas; estos tiempos no son una garantía de latencia en producción. La fixture
se insertó en una transacción que se revirtió al terminar.

Comprobaciones finales de frontend: 2.227 pruebas aprobadas, tipos de aplicación
y de pruebas, ESLint y build de producción. PHPStan y Pint aprobados. Composer
sin avisos de seguridad; npm cumple la política vigente, con las seis
excepciones previas de desarrollo que caducan el 9 de noviembre de 2026.

Suite completa de backend: 2.995 pruebas aprobadas / 34.848 aserciones en
PostgreSQL aislado. La migración local se aplicó tras verificar el respaldo;
backend y frontend responden en 8000 y 4200. El endpoint de búsqueda sin sesión
devuelve 401. Los trabajadores recibieron un reinicio gradual.
