# UVH Control · verificación del rediseño

Fecha: 2026-10-06. Rama observada: main. Sin commits ni cambios de staging.
Alcance: panel local independiente, controlador, SEA, build y documentación. No se
modificaron los cambios concurrentes del producto.

## Resultado final

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` en panel | PASS |
| `npm run lint` en panel | PASS, cero advertencias |
| `npm run build` en panel | PASS, plantillas Angular estrictas |
| `node --test scripts/uvh-control.test.mjs` | PASS, 27/27, sin skips |
| `npm run test:e2e` en panel | PASS, 10/10, Chromium real (tres ejecuciones completas seguidas) |
| Axe en resumen claro/oscuro, móvil, logs y diálogo | PASS, sin violaciones detectadas |
| `node --check` control/build/bootstrap/smoke | PASS |
| Generación SEA de los tres destinos | PASS |
| `node scripts/uvh-control-smoke.mjs` | PASS, macOS ARM64 |
| `codesign --verify --strict` macOS | PASS, firma ad-hoc |
| Tamaño y SHA-256 de artefactos contra manifiesto generado | PASS, tres destinos |
| `git diff --check` de los cambios de trabajo pertinentes | PASS |

No se ensayaron migraciones sobre datos reales ni reparación elevada: las pruebas
usan raíces temporales y comandos deterministas que no delegan en Docker real.

## Defecto encontrado y corregido durante esta revisión

La primera ejecución completa destapó un fallo intermitente real: el panel se declaraba
`stale` de forma especulativa (valor inicial `true` y también cada vez que un refresco
tocaba o estaba en vuelo), lo que mostraba "PENDIENTE DE COMPROBACIÓN" sin base y
deshabilitaba todas las acciones; una pulsación en un botón aún habilitado podía no hacer
nada y `runOp` se salía en silencio. Ahora solo un fallo de lectura o la pérdida del
controlador marcan el diagnóstico como obsoleto, una lectura programada o en curso no lo
hace, y una acción bloqueada explica el motivo en lugar de no responder. La regresión
determinista se validó reintroduciendo la lógica anterior: la prueba falla con ella y
pasa con la corrección.

## Interfaz comprobada

- Angular Material real (DOM de tarjetas/botones), identidad UVH, fuentes/iconos locales.
- Iconos: prueba de ligaduras evita nombres ausentes que producirían texto recortado.
- Escritorio 1440 × 1000; móvil 390 × 844; claro/oscuro y sin scroll horizontal global.
- Teclado: skip link, foco principal, abrir/cancelar diálogo y restaurar foco.
- Abrir aplicación con noopener, navegación simulada sin contactar el puerto del usuario.
- Confirmación sensible cancelada sin ejecución; bloqueo inmediato al admitir.
- Logs redactados/búsqueda/seguimiento; historial separado.
- Desconexión y recuperación sin afirmar que los servicios se apagaron.
- Respuesta de operación perdida o malformada reconciliada sin duplicar la mutación.
- HTTP 409 explícito y `ok:false` con HTTP 200 tratados correctamente.

## Controlador comprobado

Host/Origin/contexto cruzado, token requerido, JSON/tamaño/campos/métodos, confirmación
vinculada al destino y de un uso, replay de requestId, lock entre procesos CLI reales,
identidad OS frente a hora de escritura, nonce de liberación, dueño muerto/incierto,
metadata legada no borrada, PID ajeno/reutilizado, symlink fuera de assets, timeout,
proceso hijo real abortado y supervisor de Angular falso real cerrado sin huérfano.

Sonda HTTP real: 200 después de >=3 s se clasifica `slow`; 503 es `error`; redirect y
fallo de red no se convierten en éxito. No se reivindica una mejora de rendimiento.
El bundle inicial final es aproximadamente 852 kB bruto; la estimación Angular de
transferencia (~174 kB) no es una medición de rendimiento de usuario.

## Ejecutables

Los binarios e imágenes de evidencia son artefactos generados e ignorados por Git: no se
versionan. Se regeneran con `node scripts/build-uvh-control.mjs`, que deja
`dist/uvh-control-macos-arm64`, `dist/uvh-control-windows-x64.exe`,
`dist/uvh-control-linux-x64` y el manifiesto de tamaños/SHA-256 en
`dist/uvh-control-checksums.json`.

El smoke macOS ejecuta el binario en checkout mínimo privado sin `panel/dist` y sin
Node en PATH, verifica Angular renderizado, API con sesión y assets embebidos. Docker
está simulado por un script shell fail-closed. El binario no necesita Node para servir
el panel; iniciar el frontend de desarrollo requiere Node y sus dependencias.

Windows/Linux se generaron y se inspeccionaron como PE x64/ELF x64; **no se ejecutaron**
en sus sistemas nativos. La reparación Windows y sus mecanismos de parada requieren
ensayo nativo antes de considerarlos verificados. macOS sin notarización; Windows sin
firma comercial; Linux requiere runtime glibc compatible.

## Evidencia visual

Las capturas (escritorio/móvil, claro/oscuro, mantenimiento del binario macOS y hoja
comparativa) se generan localmente en `panel/test-results/visual/` con
`npm --prefix panel run test:e2e` y `node scripts/uvh-control-smoke.mjs`; también se
ignoran por Git y no forman parte del commit.

Preview registrado en loopback con fixture privada (datos simulados, no controla el
checkout del usuario). El webview de Freebuff no produjo frames para screenshot;
las capturas y las comprobaciones proceden de Playwright Chromium, que sí ejecutó la
interfaz completa. El servidor de preview permanece disponible mientras vive el hilo.

## Archivos retirados en este cambio

El cambio sustituye los lanzadores por sistema operativo
(`UVH Control.cmd`, `tools/uvh-control.ps1`, `tools/repair-docker-sailor-socket.ps1`
y `tools/tests/control-stop.tests.ps1`), ya reemplazados por la CLI multiplataforma,
la regresión `node:test` y los ejecutables embebidos. También se elimina
`scripts/uvh-control-dashboard.html`: era el panel HTML artesanal de respaldo y ya no
tiene ninguna referencia en tiempo de ejecución, porque el panel Angular compilado es
obligatorio. Los ledgers históricos (`docs/progress-checkpoint-*`,
`docs/backend-audit-findings.md`, `docs/superpowers/plans/2026-10-02-source-function-inventory*`)
siguen citando esas rutas como registro de su fecha y no se reescriben.

## Límites y recuperación

Ver [guía de control local](local-control.md). No hay daemon ni seguridad absoluta
contra software con los privilegios del usuario. Redacción de logs no detecta todos
los secretos arbitrarios. La precisión de creación macOS es de segundos, complementada
para el frontend por nonce/raíz/comando. Un gate interrumpido, metadata antigua o un
resultado incierto se bloquean para revisión manual, no se limpian ciegamente.

El índice Git conserva staged versiones del trabajo anterior. Sus contenidos no son
las versiones finales de este turno; se dejó intacto por la política de checkout
compartido. El `diff --cached --check` reveló un espacio final preexistente en la antigua
CLI staged; no se alteró staging para corregirlo. El árbol de trabajo final pertinente
sí pasó el chequeo. No se ha preparado ni creado ningún commit.
