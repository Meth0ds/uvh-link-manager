# Optimización adicional y corrección de errores — 25 de octubre de 2026

Esta tanda continúa la refactorización de UVH sin cambiar rutas, contratos HTTP, diseño, permisos ni formato de backups.

## Imagen runtime persistente

Se corrigió una pérdida de estado en recuperación: la imagen PHP seleccionada durante una restauración solo vivía en memoria. Tras reiniciar el controlador se podía volver a usar la imagen local por defecto, aunque el backup hubiese identificado otra imagen.

Ahora `scripts/recovery/image-selection.mjs`:

- Persiste únicamente identificadores `sha256:` verificados fuera del payload restaurable.
- Genera una configuración Compose privada por digest con `pull_policy: never` para `php`, `app`, `queue`, `queue-destinations` y `schedule`.
- Reutiliza esa configuración después de reiniciar el controlador.
- Conserva configuraciones de imágenes anteriores cuando cambia la selección.
- Rechaza tags mutables, metadatos desconocidos, symlinks y archivos especiales.
- Limpia la selección solo después de validar el checkout y justo antes de aplicar una actualización nueva.

La plantilla principal ya no interpola `${UVH_LOCAL_PHP_IMAGE}`. Esto elimina la contradicción que hacía fallar el contrato de supply chain. La imagen restaurada se selecciona por archivo privado autenticado y no por una variable de entorno mutable.

Regresiones añadidas: reinicio con imagen persistida, reset explícito, metadata manipulada, output enlazado, cambio de imagen sin sobrescribir la anterior, fallo de checkout sin limpiar la selección y resolución Compose posterior a una restauración.

## Transferencias externas

Se reforzó la frontera HTTP:

- Las respuestas de error cancelan su body antes de propagarse.
- Los cuerpos de verificación con longitud incorrecta se cancelan antes del error.
- Un resultado multipart perdido se reconcilia leyendo el objeto ya completado antes de crear otra subida.
- Las subidas recién iniciadas se abortan si falla su primer checkpoint persistente.
- Las transferencias sin estado duradero abortan su upload cuando la mutación falla.
- Se mantienen streaming, reanudación, checksum final y límites de memoria.

La batería pasa **11 pruebas**: Fetch real, GET/DELETE sin body, lectura truncada, error embebido en HTTP 200, checksum corrupto, reanudación, respuesta de finalización perdida, cleanup de uploads y errores de fuente.

Las copias a carpeta/NAS también usan una sola tubería de lectura, escritura temporal y hash incremental. Antes se copiaba el archivo y después se volvía a recorrer el temporal para calcular el digest; ahora el archivo se lee una vez, se verifica el tamaño y se renombra atómicamente. Un digest incorrecto elimina el temporal y nunca publica el destino final. La regresión comprueba además que un fallo de integridad no deja `.uploading` ni destino final.

## Accesibilidad y evidencia visual

El tablist administrativo ahora expone los grupos como presentación, describe cada pestaña con su plataforma y conserva la navegación por flechas. La comparación visual de la app real mantiene 55 capturas, cero errores de navegador, cero overflow y ninguna regresión de accesibilidad entre base y refactor.

## Carga diferida del centro administrativo

El centro de actualizaciones y backups se carga con `@defer` cuando se selecciona la pestaña de actualizaciones. La plantilla mantiene un placeholder accesible mientras llega el chunk y después muestra exactamente el componente anterior.

Medición del build español de producción:

- Chunk principal de Administración: **193.597 → 165.475 bytes**.
- Chunk diferido de `AdminUpdatesComponent`: **29.001 bytes**.
- Chunks JavaScript: **238 → 239**.
- La ruta administrativa conserva sus 2.316 pruebas, navegación por teclado y capturas reales.

El ahorro se produce en la carga inicial del panel; la funcionalidad no se elimina y se descarga al abrir la sección.

## Configuración local

El controlador y el motor de recuperación reutilizan el parseo de `.env.docker.local` mientras no cambien su `mtime` o tamaño. Cada acceso sigue comprobando que el archivo sea regular, privado y menor de 64 KiB; cualquier cambio invalida la caché en la siguiente operación. Esto evita releer el mismo archivo durante cada comando Docker, diagnóstico y redacción de logs sin conservar una configuración obsoleta tras una edición.

## Restauración selectiva

La admisión y el restaurador aplican ahora la misma frontera de entrada: la selección debe ser un array no vacío de como máximo 1.000 rutas, cada una string y de hasta 1.024 caracteres. Las entradas no estructuradas se rechazan con `invalid_restore_paths` antes de adquirir el lock o tocar el almacenamiento; las rutas relativas válidas conservan el flujo anterior.

El puente administrativo también rechaza cursores de eventos no numéricos antes de consultar el historial; así una entrada como `abc` no vuelve silenciosamente al principio de la secuencia.

## Dependencias

La auditoría actual del árbol frontend no encuentra vulnerabilidades (`0` informativas, bajas, moderadas, altas o críticas en 736 dependencias). Composer tampoco devuelve advisories ni paquetes abandonados en el árbol bloqueado. Las comprobaciones permanecen reproducibles con `npm run audit:policy` y `composer audit --locked` en CI.

El formateo numérico de fechas del panel reutiliza ahora un `Intl.DateTimeFormat` por locale, igual que el formato medio, en lugar de construirlo durante cada render. La salida validada para ISO y timestamps de PostgreSQL se mantiene igual.

## Verificación

- 90 pruebas Node del controlador y recuperación: todas correctas.
- 2.316 pruebas Angular: todas correctas.
- TypeScript, ESLint y build SEA correctos.
- PHP supply-chain contract: 8 pruebas y 476 assertions correctas.
- PHPStan: sin errores.
- Lint PHP: 683 archivos correctos; prueba de recuperación local: 12 casos correctos (con advertencias de entorno por `.env` local ausente).
- Smoke SEA macOS ARM64 y Linux x64: correctos.
- Docker quedó apagado durante una primera comprobación y el contrato se repitió después de iniciarlo; el resultado final fue correcto.

La evidencia de esta tanda se conserva en `.uvh-runtime/optimization-followup/`; la evidencia visual compartible permanece en `docs/release-evidence/2026-10-25-optimization-followup/`.
