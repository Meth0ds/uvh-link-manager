# Validación de QR avanzados — 10 de octubre de 2026

Las seis funciones están implementadas. Se comprobaron sobre una compilación de producción y una base PostgreSQL aislada con cuentas, enlaces y sesiones ficticios. No se ejecutaron migraciones sobre `uvh_local`, ni se enviaron correos o webhooks reales.

Después de estas pruebas, y con autorización expresa del usuario, se realizó la [activación local](advanced-qr-activation.md), incluida la copia de seguridad y las migraciones de `uvh_local`.

## Código y dependencias

| Comprobación | Resultado |
| --- | --- |
| Suite completa frontend | 2.105 pruebas pasan |
| Suite completa backend | 2.932 pruebas, 34.363 aserciones, una omitida por falta de resolución DNS en el entorno aislado |
| Verificación backend de los últimos cambios | 28 pruebas, 653 aserciones: QR, cabeceras de seguridad y contrato de imágenes/Dependabot |
| ESLint, TypeScript y build de producción | Pasan |
| PHPStan | Sin errores; sin ampliar el baseline |
| Pint | 25 archivos PHP modificados/nuevos comprobados |
| Composer | Validación estricta y requisitos de plataforma pasan; auditoría del lock sin avisos ni paquetes abandonados |
| Imagen PHP de producción | Construida; GD con decodificación JPEG/PNG comprobado en ejecución |
| Dependabot | Cobertura Docker corregida; 8 pruebas y 476 aserciones pasan |
| Política de auditoría npm | Pasa con seis excepciones **preexistentes** de severidad alta, con vencimiento el 9 de noviembre de 2026 |

Las excepciones npm corresponden a `@angular/build`, `braces`, `chokidar`, `karma`, `karma-jasmine` y `karma-jasmine-html-reporter`. Este resultado no significa que el árbol npm carezca de vulnerabilidades; no se añadió una excepción para las nuevas dependencias QR.

La suite completa del backend precede a los últimos ajustes de comparación analítica y cabeceras. Las 28 pruebas dirigidas y PHPStan se ejecutaron después de esos ajustes. La prueba omitida es `SsrfTest`, que requiere resolución DNS externa; no se presenta como una prueba superada.

## Flujos de interfaz

Se probaron Chromium, Firefox en Linux y el motor WebKit. Las pruebas usan la CSP estricta de producción, incluido Trusted Types; también se exportaron PNG/SVG/PDF con `ng serve`. La URL de worker de Angular/Vite se admite únicamente en modo de desarrollo y con su consulta exacta. Las pruebas verifican que la generación funciona sin ampliar permisos de red ni admitir workers externos.

- PNG, SVG, PDF y A4 descargados desde el modal, con logo UVH y logo propio normalizado por Laravel.
- Copia PNG confirmada después de una escritura real en el portapapeles. Ante permiso denegado se verificó el mensaje y la descarga alternativa.
- Crear, aplicar, editar, duplicar y eliminar diseños. Lectores pueden aplicar y exportar logos privados, sin controles de escritura.
- Crear una campaña y actualizar explícitamente su diseño, conservando su URL. Comparación, días sin datos, archivo, reactivación y apertura del diseño original.
- Selección de 21 enlaces entre páginas, exportación ZIP PNG/SVG y PDF; la previsualización A4 contiene 21 QR distintos.
- Cancelación de un lote a 4096 px sin iniciar una descarga parcial. Generación incremental de 100 SVG, nombres únicos, manifiesto completo y rechazo de la salida que supera 64 MiB.
- Tema claro/oscuro, ancho de 320 px sin desbordamientos, foco contenido en el modal, cierre con Escape, movimiento reducido y comprobación axe sin infracciones en los estados revisados.
- Reintento de logos privados, respuestas tardías y cambios de workspace/rol. Un fallo al recuperar el logo confirmado no exige crear otra plantilla o campaña.

**Safari nativo sigue pendiente de comprobación manual.** Se intentó acceder a Safari, pero la automatización de macOS quedó pendiente de permisos de accesibilidad y captura de pantalla; no se concedieron ni eludieron esos permisos. WebKit prueba su motor, pero no sustituye una ejecución en Safari con sus permisos y configuración reales. Firefox se verificó en el contenedor Linux; el ejecutable automatizado de macOS fallaba al crear su perfil.

## Archivos finales

PyMuPDF y ZXing decodificaron los QR descargados, independientemente del generador de la aplicación:

- PNG/SVG/PDF con colores, logo propio y marco con texto; SVG autónomo, sin scripts, HTML ni referencias externas. PDF con módulos vectoriales, Manrope incrustada y texto buscable; solo el logo propio aparece como imagen.
- QR UVH vectorial y QR de campaña; el identificador de atribución está presente en la URL decodificada.
- 21 SVG y 21 PNG del lote descargado y 100 SVG del lote límite, comparados con su manifiesto.
- A4 de 210 × 297 mm, 28 QR en una hoja, 21 QR distintos en un lote y 29 copias en dos páginas. Se verificaron dimensiones, lectura de cada copia y presencia de marcas de corte.
- PDF individual con QR de 35 mm y marco: dimensiones finales 36,4 × 42 mm. El marco se añade fuera del margen blanco.

## Seguridad y persistencia

Las pruebas backend cubren permisos de propietario/administrador/editor/lector, aislamiento entre workspaces, versiones en conflicto, límites, idempotencia y repetición de creaciones eliminadas. Los logos se prueban con firma falsa, SVG, tamaño excesivo, orientación EXIF, transparencia, fallo de escritura y pérdida de permisos durante la carga. También se comprueba la limpieza después de borrar cuentas/workspaces y la conservación de logos referenciados por campañas.

La atribución se prueba con contraseña y errores de validación, dominios personalizados, variantes ajenas/archivadas, enlaces agotados y trabajos analíticos repetidos. La comparación lee una instantánea coherente incluso si llegan visitas concurrentes. La exportación de cuenta incluye los logos normalizados sin rutas privadas ni claves de idempotencia.

## Puesta en marcha pendiente

Aplicar las [instrucciones de despliegue](advanced-qr.md#despliegue): imagen PHP con GD, backend y tres migraciones aditivas, almacenamiento privado/housekeeping y CSP; después frontend, workers y fuente local. Comprobar Safari nativo y los permisos del portapapeles en el entorno destino. Las pruebas aisladas no constituyen un despliegue.

Los logs, archivos exportados y capturas de esta ejecución permanecen en `.uvh-runtime/advanced-qr`, excluido de Git; este documento conserva el resultado revisable sin publicar sesiones de prueba.
