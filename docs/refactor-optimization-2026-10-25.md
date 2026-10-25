# Refactorización y optimización de UVH

Fecha: 25 de octubre de 2026. Base: `d5d0b7d01aa6f740fbe0312012b1edf1178c4960`.

La implementación conserva las rutas y respuestas administrativas, los aliases, el formato de las copias, las autorizaciones, las instancias de formularios y el diseño. No introduce API v2, SQLite, otro cifrado ni una sustitución de `docker/backup`.

La evidencia está en [2026-10-25-refactor](release-evidence/2026-10-25-refactor/README.md). Las correcciones posteriores están documentadas en [la tanda de seguimiento](refactor-optimization-followup-2026-10-25.md).

## Correcciones de comportamiento

- La categoría de la copia se guarda en `category`; `tag` conserva su función criptográfica. Las categorías históricas solo se reconstruyen con evidencia inequívoca de operaciones. Las desconocidas se conservan.
- Las copias semanales conservan su categoría durante creación, publicación y retención.
- Una copia diaria admitida impide consumir el checkpoint semanal mientras mantiene el bloqueo. La prueba reproduce el fallo anterior y comprueba la ejecución semanal posterior.
- La ausencia de un componente moderno ya no convierte una copia en legacy. Solo la ausencia del propio manifiesto permite ese camino. La autenticación del payload sigue siendo previa a la extracción.
- La firma externa lleva una única `Z`. GET y DELETE se construyen sin cuerpo. La reanudación consulta las partes confirmadas por el destino, detecta lecturas truncadas y valida tanto la finalización como el tamaño y SHA-256 del objeto recuperado.
- La reconciliación de auditoría conserva la primera aparición de un identificador repetido, como el bucle original. El recibo y la admisión del evento mantienen su transacción y su arbitraje mediante clave única.

## Responsabilidades delimitadas

| Área | Implementación | Límite conservado |
| --- | --- | --- |
| Catálogos y estado | `state-repository.mjs`, `store.mjs` | Documentos autenticados y formatos existentes |
| Admisión y ejecución | `operation-orchestrator.mjs` | Idempotencia, lease, resultado y persistencia |
| Puente administrativo | `bridge-publisher.mjs` | Snapshot con caducidad e indicador de mantenimiento |
| Planificación y diagnóstico | `health-monitor.mjs` | Cadencias, umbrales y bloqueo compartido |
| Copia y recuperación | `backup-runner.mjs`, `update-runner.mjs` | Copia preventiva, comprobación y recuperación única |
| Transferencia | `s3-signing.mjs`, `s3-transport.mjs`, `s3-multipart.mjs` | Firma, Fetch, reanudación y verificación separadas |

`engine.mjs` compone estas piezas y conserva la fachada anterior. La clasificación, recomendación y proyección pública del catálogo se calculan en un solo recorrido. Cada lectura de catálogo produce objetos propios; las proyecciones no comparten objetos mutables con el estado persistido.

El puente reutiliza su proyección mientras no cambia la revisión del store. Renueva la caducidad sin releer los catálogos y solo publica el indicador de mantenimiento si cambia o falta el archivo. Las escrituras de autorizaciones, admisión y resultados siguen siendo inmediatas.

El cifrado conserva su pipeline de streams. El SHA-256 se calcula mientras se escribe el payload y se reutiliza entre destinos de esa copia. El recorrido del almacenamiento usa I/O asíncrono y conserva el rechazo de enlaces y archivos especiales.

## Laravel y frontend

Laravel separa `RecoveryAuthorization` y `RecoveryCommandAdmission`. Los eventos se resuelven como datos antes de construir JSON. La reconciliación consulta los recibos existentes en bloque y solo abre transacciones para eventos pendientes.

Administración, Cuenta y Housekeeping trasladan métodos completos a traits por responsabilidad. Se compararon los cuerpos de **31 métodos**: los tokens permanecen idénticos, excluyendo comentarios y espacios. PHPStan comprueba el backend completo sin añadir entradas al baseline ni supresiones.

El editor extrae la construcción y serialización de reglas. La caché horaria retiene como máximo 32 formateadores y sigue calculando cada conversión con su fecha de referencia. Las pruebas cubren DST, veinte reglas y expulsión de entradas antiguas.

Ajustes mantiene sus formularios, señales y limpieza de identidad en la vista; cuatro coordinadores reúnen exportaciones, sesiones, privacidad y MFA. Administración extrae transporte y handshake del popup, valida origen y ventana emisora, conserva los borradores cuando el navegador bloquea la apertura y limpia los recursos al destruir la vista.

La recuperación independiente separa HTML, CSS y JavaScript en recursos congelados. El renderizado mantiene montadas las regiones sin cambios y conserva foco y campos activos. El empaquetado sigue el grafo de imports runtime y excluye pruebas, simuladores y herramientas de evidencia. Rechaza recursos enlazados fuera del controlador.

## Resultados medidos

Entorno de las medidas: macOS ARM64, Node 22.23.3. La comparación usa siete pares de procesos alternando antes/después, catálogos de 10/100/1.000 entradas, 30 lecturas de calentamiento y 300 muestras por tamaño. La copia de ensayo utiliza adaptadores aislados; sus tiempos no son una estimación de una copia real de producción.

| Medida | Antes | Después |
| --- | ---: | ---: |
| Escrituras atómicas por copia local de ensayo | 34 | 21 |
| Lecturas de documentos en ese escenario | 31 | 27 |
| Mediana de la copia de ensayo | 5,80 ms | 4,36 ms |
| 30 renovaciones con catálogo de 1.000 entradas | 44,84 ms | 20,58 ms |
| Snapshot directo de 1.000 entradas, mediana | 0,671 ms | 0,682 ms |
| Snapshot directo de 1.000 entradas, p95 | 0,803 ms | 0,856 ms |
| 120 conversiones horarias, mediana en caliente | 7,94 ms | 0,80 ms |
| Formateadores creados en esas conversiones | 480 | 2 |
| 100 eventos ya recibidos | 100 consultas / 100 transacciones | 1 consulta / 0 transacciones |
| Recursos de recuperación embebidos | 154.348 bytes | 127.002 bytes |

Las conversiones producen el mismo SHA-256 de resultados. Los snapshots directos quedan dentro del margen del 10 % en mediana y p95; la renovación mejora al reutilizar la proyección. Una regresión inicial del microbenchmark se investigó y se eliminó combinando los recorridos del catálogo antes de aceptar el lote.

La transferencia por partes de 8 MiB verificó archivos de 8, 64 y 256 MiB. El pico RSS del proceso fue aproximadamente 86, 143 y 170 MiB, respectivamente. Estos valores incluyen Node, buffers y GC; el código conserva solo una parte y la lectura remota usa streaming.

El JavaScript total compilado aumenta aproximadamente **0,21 %**. El chunk diferido de Ajustes pasa de 242.651 a 255.235 bytes (**5,19 %**) por los adaptadores tipados de los coordinadores. Es una mejora de mantenibilidad con un coste de tamaño medido, no una reducción del bundle. La carga inicial pasa de 684,33 a 684,49 kB; estilos y distribución se conservan.

## Verificación y evidencia

- **90 pruebas Node correctas** de controlador y recuperación, incorporadas a CI.
- **2.316 pruebas Angular correctas**, además de typecheck, lint, build de producción español e integridad de las 4.151 traducciones inglesas.
- **3.138 casos PHP ejecutados por lotes: 3.136 correctos y dos fallos previos**. Después se añadió y ejecutó una regresión de auditoría; los 11 casos finales de recuperación pasan.
- PHPStan completo sin errores y Pint correcto en los archivos PHP modificados.
- Roundtrip real y aislado de PostgreSQL: volcado, cifrado autenticado, restauración de código/datos/almacenamiento y rechazo de manipulación.
- Ejecutables generados para macOS ARM64, Windows x64 y Linux x64. Smoke de macOS con Angular real y sin Node externo; smoke de Linux x64 dentro de Docker con assets y recuperación independiente congelados.
- **55 capturas y 20 comparaciones visuales**: 19 tienen PNG idéntico. La restante difiere en cinco píxeles, con un máximo de un nivel de canal sobre 255. No hay errores de ejecución ni desbordamiento horizontal detectados.

Las pruebas de fallo de actualización usan el motor con adaptadores aislados; las pruebas HTTP externas usan Fetch real y un servidor local de ensayo. Son alcances distintos de una actualización sobre un entorno de usuario o de la interoperabilidad con todos los destinos compatibles.

## Límites y deuda restante comprobada

1. El contrato de imágenes ahora pasa tras eliminar la interpolación mutable `${UVH_LOCAL_PHP_IMAGE:-uvh-php:8.4}` del Compose y usar la selección persistente por digest descrita en el informe de seguimiento.
2. El análisis axe encuentra en ambas versiones las mismas incidencias de estructura ARIA del tablist y contraste. Se conservan en `visual-results.json`; esta entrega no certifica WCAG 2.2 AA ni cambia el diseño para ocultarlas.
3. Windows se ha compilado, pero no se ha ejecutado en Windows nativo. La comprobación Linux x64 usa un contenedor sobre el host ARM64; no sustituye la prueba en hardware nativo ni el ciclo completo de actualización en las tres plataformas.
4. La comparación de tamaño y build usa el frontend español. Las traducciones inglesas pasan su verificador; la publicación de francés conserva su configuración anterior.

Se descartan las migraciones de formato, almacenamiento y API propuestas en planes anteriores. No aportaban una mejora medida que justificase cambiar contratos en esta pasada. También se conservan los recursos HTML/CSS sin una reescritura estética y el motor de `docker/backup`.

## Reproducción

Desde la raíz del repositorio:

```sh
node --test scripts/uvh-control.test.mjs scripts/recovery/*.test.mjs
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test -- --watch=false --browsers=ChromeHeadless
node scripts/benchmark-refactor.mjs . resultado.json
node scripts/benchmark-transfer.mjs 256
node scripts/recovery/backup-drill.mjs
node scripts/build-uvh-control.mjs
node scripts/uvh-control-smoke.mjs
node scripts/uvh-control-linux-smoke.mjs
```

El benchmark acepta como primer argumento otro checkout con el mismo escenario. La evidencia visual requiere dos builds `design-preview` con el fixture administrativo de solo lectura: la base y el árbol actual. Se ejecuta mediante `node scripts/refactor-visual-evidence.mjs <checkout-base>`.

Las pruebas PHP requieren una base aislada terminada en `_test`, el esquema completo y variables de PHPUnit alineadas. Los lotes separan procesos para evitar que la memoria acumulada de toda la suite active la protección de exportaciones. El proyecto Compose de ensayo usa tmpfs con inodos suficientes y nunca comparte su PostgreSQL con la aplicación local.
