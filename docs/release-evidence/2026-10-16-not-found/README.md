# 404 — Reconecta el camino

Implementación de las dos superficies: navegación Angular (`/not-found`) y enlaces inexistentes de Laravel. La 403 y los estados de contraseña, pausa, bloqueo, caducidad y agotamiento conservan sus presentaciones.

## Diseño y funcionamiento

- Composición compartida, Manrope local, claro/oscuro y cinco tramos giratorios sobre un tablero 3 × 3.
- Tres posiciones iniciales resolubles, comprobación real de continuidad, teclado, anuncio del resultado y reinicio sin saltos de contenido.
- Motor independiente de Angular, sin almacenamiento, llamadas de red ni bibliotecas nuevas. Los listeners se eliminan al destruir la vista; el adaptador independiente conserva su funcionamiento al volver desde la caché de navegación.
- Laravel utiliza el desenlace explícito `not_found`, conserva HTTP 404 y no refleja la URL, fragmentos ni parámetros recibidos. Los JSON existentes no cambian.
- Marca propia: hostname procedente del dominio resuelto, juego neutro, sin promoción de UVH y botón al sitio solo si la raíz configurada supera validación y denylist. Los enlaces UVH se construyen desde configuración.
- Recursos servidos desde `/visitor-assets/`, con lista cerrada, tipos MIME explícitos y empaquetado en la imagen PHP. El proxy local y Nginx público reservan esta ruta; los dominios personalizados conservan su paso por Laravel. No se relajan CSP ni Trusted Types.
- Sin JavaScript, Laravel conserva el documento completo y el tablero estático. La SPA ofrece una salida estática común que explica cómo activar JavaScript; no intenta identificar una ruta sin ejecutar Angular.

## Verificación realizada

- Motor: 3 pruebas, incluyendo comprobación exhaustiva de las 1.024 orientaciones.
- Angular: 2 pruebas de 404/403, montaje, limpieza de listeners, metadatos, foco y destinos de navegación.
- Laravel: 30 pruebas / 334 aserciones (DomainVisitorSurface, RedirectAdmission, SecurityHeaders, EdgeLimitContract y DesignTokenParity), con PostgreSQL aislado `uvh_test`.
- TypeScript, ESLint, build de producción, PHPStan, Pint y `git diff --check` correctos. La plantilla Nginx renderizada supera `nginx -t` en la imagen del proyecto.
- Chromium y WebKit: ambas superficies, claro/oscuro, 320/390/768/1024/1440 px, ventana corta de 512 × 320, teclado, reinicio y clics repetidos. Sin desbordamientos, controles del tablero de al menos 44 px y sin errores de CSP o JavaScript.
- Axe sobre las 20 combinaciones Chromium: sin infracciones WCAG A/AA detectadas. Esto complementa la revisión visual y de foco; no sustituye una prueba humana con lector de pantalla.
- Sin JavaScript: alternativas estáticas verificadas en ambos motores y ambas superficies.
- Jugar y resolver: cero peticiones de red. El resultado no afirma reparar el enlace.

La prueba Firefox quedó pendiente: el ejecutable de Playwright falla antes de abrir la página con «Could not find profile folder», también usando `/tmp`. WebKit automatizado no equivale a Safari nativo en un iPhone físico. No se afirma haber realizado esas comprobaciones ni un despliegue de producción.

## Repetir la revisión

Con frontend y backend locales en marcha:

```sh
node --test frontend/e2e/not-found-puzzle.test.mjs
NOT_FOUND_BROWSERS=chromium,webkit node frontend/e2e/not-found-review.mjs
```

El script usa por defecto Chromium, Firefox y WebKit. `NOT_FOUND_FRONTEND_ORIGIN` y `NOT_FOUND_BACKEND_ORIGIN` permiten cambiar los puertos. No crea ni modifica datos de cuenta. `browser-results.json` contiene los resultados de la última revisión completada.

## Capturas reales

| Superficie | Escritorio claro | Escritorio oscuro | Móvil claro | Móvil oscuro | Resuelto |
| --- | --- | --- | --- | --- | --- |
| Web | [Ver](web-light-1440.png) | [Ver](web-dark-1440.png) | [Ver](web-light-390.png) | [Ver](web-dark-390.png) | [Ver](web-solved-dark.png) |
| Enlace inexistente | [Ver](link-light-1440.png) | [Ver](link-dark-1440.png) | [Ver](link-light-390.png) | [Ver](link-dark-390.png) | [Ver](link-solved-dark.png) |

Las capturas usan movimiento reducido para mostrar el estado final, sin capturar fotogramas intermedios de las transiciones. El script también comprueba giros con movimiento normal.
