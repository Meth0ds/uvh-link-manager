# Activación local de QR — 10 de octubre de 2026

Tras la autorización del usuario se activó la implementación en el checkout local.

- Reconstruida `uvh-php:8.4` con GD; requisitos de plataforma de Composer comprobados.
- Guardada una copia PostgreSQL en formato custom antes de modificar `uvh_local`. Permisos privados; archivo en `.uvh-runtime/advanced-qr/activation`, excluido de Git.
- Aplicadas las seis migraciones pendientes: ajustes operativos, índice de autor, precisión de eventos y las tres migraciones QR. Sin reinicializar la base de datos.
- Arrancados Laravel, worker y scheduler mediante UVH Control; Angular utiliza su supervisor administrado en el puerto 4200.
- Comprobados HTTP 200 en frontend y backend, fuente Manrope disponible y HTTP 401 sin sesión en las nuevas rutas de diseños/logos.
- Verificados en ejecución las seis tablas QR, la columna de atribución, soporte GD JPEG/PNG, normalización de una imagen de prueba y escritura/lectura en el disco privado. El archivo temporal se eliminó después de la comprobación.
- Estado final del controlador: backend/frontend operativos, PostgreSQL saludable y migraciones actuales sobre `uvh_local`.

Aplicación: <http://localhost:4200/>. Backend: <http://localhost:8000/health>.

La activación corresponde al entorno local. La validación funcional anterior y la limitación de Safari nativo se mantienen en [advanced-qr-validation.md](advanced-qr-validation.md); no se efectuó un despliegue remoto.
