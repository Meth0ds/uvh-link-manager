# Apertura de aplicaciones — revisión de entrega

Implementación de proveedores conocidos y aplicaciones propias, con activación independiente y desactivada por defecto. Esta evidencia describe comprobaciones locales; no acredita integración con aplicaciones firmadas en dispositivos físicos.

## Funciones revisadas

- Editor avanzado dentro de Destino; creación rápida sin cambios.
- Spotify y YouTube por URL oficial; Google Maps y Apple Maps mediante lugar o ruta guiados. No se consulta al proveedor al introducir datos.
- Perfil único por dominio, publicación administrativa, versiones e idempotencia; diagnóstico solicitado explícitamente.
- AASA restringido a `/a/*`; Android Asset Links con huellas públicas y ejemplo de manifiesto limitado a `/a/`.
- Resolución nativa mediante un origen fijo de UVH, independiente del dominio del enlace. No se confía en un resolver que un nuevo titular del dominio pueda suplantar.
- Prioridad de reglas/fallback, contraseña, bloqueos, fechas, límites y uso único; comprobantes breves y revocables por cambios de configuración.
- Una admisión y un evento analítico ante seis reintentos concurrentes; conservación de atribución QR.
- Dirección recomendada para copiar y QR nuevos; dirección anterior compatible. Plantillas, duplicación, historial y exportación integrados.
- Las versiones antiguas sin configuración de aplicación conservan el valor vigente; clientes antiguos pueden seguir editando sin enviar el campo nuevo.

## Comprobaciones técnicas

- Suite backend completa antes de integrar la gestión de dominios `ce1d1de`: 3.051 pruebas correctas y 35.353 aserciones. Tras integrar ese commit, regresión conjunta de apertura y dominios: 53 pruebas y 433 aserciones.
- Suite frontend completa tras integrar la gestión de dominios: 2.296 pruebas correctas.
- Suites específicas de apertura, formatos de proveedor y limitadores de seguridad: 32 pruebas, 285 aserciones, incluida la revocación del acceso nativo tras trasladar el enlace y eliminar su dominio anterior.
- PHPStan (`--memory-limit=512M`), Pint, TypeScript, ESLint y build de producción, repetidos tras la integración. El primer intento de PHPStan con 128 MiB agotó memoria; la repetición con 512 MiB terminó sin errores.
- Sintaxis de Nginx comprobada con `nginx -t` usando la imagen instalada y configuración temporal con valores ficticios, sin publicar puertos.
- Requisitos de plataforma Composer comprobados; `symfony/http-foundation` actualizado a 8.1.9 por CVE-2026-108082. Auditoría Composer sin avisos; auditoría npm conforme a la política existente de dependencias de desarrollo.
- Ejemplo Swift comprobado con `swiftc -swift-version 6 -typecheck`. El ejemplo Kotlin requiere integración y compilación dentro de una app Android real.

## Revisión visual y del navegador

Chromium y WebKit: editor y perfil de dominio; 1440/1024/768/390/320 px, tema claro/oscuro y movimiento reducido. Sin desbordamiento horizontal. Comprobaciones axe de WCAG A/AA en los controles nuevos, formulario guiado de mapas y página pública.

El recorrido de proveedor usa HTML real de Laravel, cookie de continuación `HttpOnly` y destino externo interceptado localmente. Dos visitas iniciales producen dos consumos; pulsar apertura o alternativa no añade otro.

La continuación nativa se ejecuta con el bridge real y el resolver real mediante un proxy local de pruebas. Se verifica retirada del fragmento, ausencia de cookies ambientales en fetch, desafío, reutilización de la admisión y alternativa web. Este proxy adapta el salto HTTP local y **no certifica TLS público, asociaciones del sistema operativo ni apertura de una app instalada**.

Firefox no pudo arrancar en este host; su revisión queda pendiente. WebKit automatizado no sustituye Safari nativo de iPhone.

## Pendiente antes de activar en producción

Probar Android e iPhone físicos con aplicaciones firmadas y HTTPS público: instalada/ausente, mensajes, QR, navegador integrado, contraseñas, revocación y cachés de asociaciones. Las funciones no deben anunciarse como instalaciones detectadas ni aperturas confirmadas. Desplegar migraciones y backend antes del frontend.

## Repetir las comprobaciones visuales

`frontend/e2e/app-opening-fixture.php` crea únicamente datos locales desechables y contiene limpieza restringida a ese namespace. Guardar su salida de sesión en un archivo temporal con permisos 0600, nunca en el repositorio. `frontend/e2e/app-opening-smoke.mjs` usa esa fixture, prueba Chromium/WebKit/Firefox cuando arrancan y genera las capturas. No habilitar trazas o registros de cuerpos que contengan comprobantes.

Consultar el protocolo y los ejemplos en [la documentación de integración](../../native-apps/README.md).
