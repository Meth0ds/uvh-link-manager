# Revisión y pulido del frontend — 26 de septiembre de 2026

Esta pasada conserva la identidad editorial existente (Manrope, papel, tinta y terracota) y corrige problemas reproducibles de interacción, accesibilidad y adaptación al espacio. No implica una certificación de accesibilidad ni una validación de operaciones reales contra Laravel.

## Cambios aplicados

### Biblioteca de enlaces

- Las filas ya no envuelven controles interactivos dentro de un `role=link` con manejador de teclado. El enlace nativo extiende su área clicable sobre la fila; copiar, QR, etiquetas y selección conservan sus controles independientes. Enter/Espacio no provocan navegaciones accidentales y los enlaces permiten abrir otra pestaña.
- Los nombres accesibles llegan al input real de los checkboxes de Material. La selección parcial muestra estado indeterminado y las filas seleccionadas se distinguen visualmente.
- Los filtros ocupan menos altura, eliminando el espacio reservado para ayudas inexistentes. La distribución depende del ancho del contenedor; las filas tienen sitio explícito para selección y acciones.
- El vacío distingue una biblioteca nueva, un usuario sin permiso de escritura y una búsqueda sin resultados; permite limpiar filtros y reiniciar la página/selección. El contador muestra carga o error en vez de un falso cero.
- La barra masiva deja de ser sticky cuando puede tapar buena parte de una pantalla estrecha. Las acciones de creación usan la misma etiqueta.

### Navegación y controles comunes

- La barra lateral completa puede desplazarse en ventanas de poca altura y reduce su cabecera. Las secciones siguen siendo accesibles en paisaje y con zoom.
- Campana y enlaces de los menús son enlaces nativos. El contador respeta el color de texto del acento en ambos temas.
- Los icon buttons de Material tienen área visible y objetivo de interacción de 48 px, evitando que el objetivo sobresalga del campo o de la fila.
- Esqueletos coherentes con los marcos del panel, sin sombra decorativa, adaptados mediante container queries y con brillo dependiente del tema.
- El QR se adapta al ancho disponible y reserva dimensiones de imagen; se comprueba apertura con teclado y devolución del foco.

### Notificaciones

- Lista con separación por filas, jerarquía de título/fecha/asunto y estado explícito «Sin leer». Las acciones se redistribuyen por ancho de contenedor.
- Estado vacío con acceso a preferencias, carga compuesta con skeleton y conservación de la lista durante una actualización.
- Los reintentos limpian errores anteriores; no se mezclan lectura/paginación y mutaciones mientras se refresca la bandeja.

### Analítica, ajustes y páginas públicas

- Listas de definición válidas en dashboard, analítica, lectura del gráfico y detalle de enlace: las explicaciones son `dd`, conservando su apariencia.
- «Personalizado» conserva su ancho legible en el selector de periodos. Los alias largos se parten sin desbordar.
- Ajustes: el aviso MFA no estrecha su explicación hasta volverla ilegible, y la sesión actual no sobresale por márgenes negativos.
- Iconos inexistentes en Material Icons sustituidos por glifos disponibles en ajustes, equipo, denuncias y avisos MFA. Se verificó la diferencia midiendo el glifo real; los alias legacy válidos se conservan.
- Landing: mayor contraste en el póster (antes 4,38:1) y colores semánticos en el cierre, cuyo texto claro perdía contraste sobre el acento del tema oscuro.
- Ayuda y denuncias: enlaces dentro del texto subrayados, reconocibles sin depender del color.
- Páginas 403/404: código legible y separado del titular, en vez de texto superpuesto con contraste insuficiente.

## Verificación reproducible

Desde `frontend/`:

```sh
npm run typecheck
npm run lint
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

La suite contiene 522 pruebas, incluidas seis nuevas sobre interacción de filas, selección, filtros y recuperación de errores. Los scripts visuales requieren Chrome instalado y los servidores locales indicados:

```sh
npm start -- --configuration design-preview --port 4310
# En otro terminal:
node design-preview/audit.mjs
node design-preview/interactions.mjs

# Páginas públicas, servidor ordinario:
npm start -- --port 4311
node design-preview/public-audit.mjs
```

- Panel: 42 combinaciones de siete pantallas, 320/768/1440 px, claro/oscuro y movimiento reducido. Cero hallazgos de axe, overflow de contenedores o excepciones JS en el barrido final.
- Detalle de enlace con alias largo: 320/768/1440 px, sin overflow ni hallazgos de axe.
- Interacciones reales en el navegador: QR mediante Enter y retorno de foco; selección parcial; buscar y limpiar; carga/vacío/error en biblioteca y notificaciones; menú a 667×375 y acceso a Ajustes.
- La vista de diseño vuelve a compilar y añade biblioteca, detalle y notificaciones usando componentes reales, respuestas ficticias y escrituras bloqueadas. No forma parte del build de producción.
- El audit público comprueba seis páginas en dos anchuras y ambos temas. Los flujos de autenticación/envío, hCaptcha externo y cambios de cuenta requieren pruebas integradas con backend; aquí sólo se verifica presentación.

## Mejoras de producto para una siguiente iteración

1. Persistir filtros, orden y paginación de la biblioteca en la URL, con pruebas de Atrás/Adelante y cambio de workspace. Actualmente siguen siendo estado local del componente.
2. Definir navegación consistente por colecciones y filtros guardados antes de introducir otra barra lateral o más controles permanentes.
3. Ampliar los escenarios visuales a dominios, equipo, moderación y todos los diálogos con datos extremos; la pasada actual no acredita todos sus flujos.
4. Revisar densidad tipográfica con usuarios: conservar el contenido técnico monoespaciado, pero reducir progresivamente las etiquetas pequeñas y repetidas donde no ayuden a orientarse.
5. Completar la comprobación manual con VoiceOver y un dispositivo táctil real. Axe y Chromium no cubren toda la experiencia de accesibilidad.

No se han modificado los cambios de backend que ya estaban en curso, ni se han creado commits o desplegado el proyecto.
