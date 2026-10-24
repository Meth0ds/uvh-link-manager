# Centro local de actualizaciones y recuperación

UVH Control puede servir una entrada local estable con una página de mantenimiento aunque Angular, Laravel o PostgreSQL estén detenidos. El centro solo funciona en el entorno local; no publica el socket de Docker ni habilita recuperación de producción.

## Activación

1. Compila el panel y el controlador con `cd panel && npm ci && npm run build` y `node scripts/build-uvh-control.mjs --only=macos` (usa el destino de tu plataforma cuando corresponda).
2. En `.env.docker.local`, establece `UVH_RECOVERY_ENABLED=true`.
3. Inicia el ejecutable dentro del checkout: `./dist/uvh-control-macos-arm64`.
4. Abre la aplicación a través de `http://127.0.0.1:4200/`; UVH Control reserva `4201` para Angular y conserva `4200` como gateway estable.
5. En Administración → Actualizaciones abre el centro de recuperación, confirma con contraseña y MFA y genera los códigos de emergencia. Se muestran una sola vez y se guardan fuera de la aplicación.

La bandera está desactivada por defecto. La primera activación exige una restauración de prueba antes de admitir una actualización.

## Flujo seguro

El controlador comprueba que `main` sea el checkout activo, que no haya cambios locales, que `origin` sea el repositorio HTTPS oficial y que el SHA remoto no haya cambiado durante la preparación. Consulta el canal de versiones con ETag y solo admite una versión con todas las comprobaciones de calidad y seguridad completadas correctamente para ese SHA.

Antes de instalar entra en mantenimiento, detiene escritores y workers, crea una copia cifrada de PostgreSQL, almacenamiento privado, configuración y código, y comprueba la copia en una base aislada. La instalación conserva el SHA fijado, ejecuta migraciones pendientes y realiza tres comprobaciones consecutivas de salud antes de reabrir.

Si una instalación falla antes de reabrir, se intenta una única restauración automática. Un fallo posterior requiere una restauración explícita desde el centro. Los cambios locales nunca se guardan, mezclan ni descartan automáticamente.

## Backups

Las copias se guardan en `.uvh-runtime/recovery/backups` por defecto. La política inicial conserva siete copias diarias, cuatro semanales y tres previas a operaciones sensibles; las copias protegidas, asociadas a incidentes o necesarias para recuperación no se eliminan. La copia local es siempre obligatoria y el destino externo es opcional: desde el centro administrativo se puede configurar una carpeta/NAS o un almacenamiento compatible con S3 sin bloquear la protección local.

Cada copia incluye la base de datos, almacenamiento privado, configuración autorizada, código recuperable, lockfiles, manifiestos, imágenes y migraciones aplicadas. El payload se cifra antes de salir del equipo; las claves, códigos de emergencia y el diario independiente permanecen fuera del conjunto restaurable. Las transferencias externas se validan por tamaño y SHA-256, se escriben de forma atómica en carpetas y quedan degradadas si el destino no responde. Una copia solo es apta si su integridad y su restauración aislada están confirmadas.

El manifiesto canónico versionado valida cada componente antes de extraerlo. Las transferencias grandes usan multipartes de 8 MiB, checksum final y limpieza del upload si falla. El controlador prefiere el almacén seguro del sistema operativo para la clave y conserva un fallback local con permisos estrictos cuando el equipo no ofrece un keyring disponible.

El dashboard muestra el estado local, la sincronización externa, la próxima ejecución, la retención y las alertas. Crear, proteger, eliminar, cambiar la política o restaurar exige MFA reciente y una confirmación vinculada a la operación; la página independiente permite diagnóstico y recuperación cuando Laravel o PostgreSQL no están disponibles.

La restauración selectiva permite elegir archivos privados mediante rutas relativas. Se valida la allowlist, se rechazan traversal, symlinks y archivos especiales, se crea una copia preventiva y no se toca la base de datos, el código ni los secretos.

Las defensas de transporte limitan el gateway a loopback, validan `Host` y `Origin`, aplican una política CSP sin recursos remotos, rechazan cuerpos grandes y fijan tiempos de espera. Los destinos compatibles solo aceptan HTTPS, no admiten credenciales en la URL, hosts de loopback ni prefijos con traversal, y se prueban antes de marcarse como preparados. Las rutas de copias rechazan symlinks, archivos especiales, cambios de propietario y escrituras parciales; las órdenes se autentican, caducan, se consumen una vez y se reconcilian por identificador.

La lógica está separada por catálogo de backups, eventos, orquestación, destinos, formato, claves y monitorización. La fachada pública conserva las rutas y el protocolo anteriores para que el controlador pueda actualizarse sin invalidar operaciones existentes.

El formato usa AES-256-GCM, manifiesto de SHA-256 y una clave separada. Una copia solo es apta si `created`, `integrity` y `restored` están confirmados. El ensayo real se ejecuta con:

```sh
node scripts/recovery/backup-drill.mjs
node --test scripts/recovery/recovery.test.mjs
```

El ensayo crea un PostgreSQL temporal, restaura datos y almacenamiento en aislamiento y rechaza una copia manipulada sin escribir en la base.

La matriz de fallos del motor también simula descargas fallidas, drenado incompleto, backup incompleto, verificación inválida, aplicación de cambios fallida, reapertura no saludable, recuperación automática fallida, restauración manual sin copia preventiva, respuestas perdidas, concurrencia y reinicio del controlador. En todos los casos se comprueba que no se repita una mutación, no se libere el bloqueo prematuramente y no se reabra el servicio sin tres comprobaciones satisfactorias.

## Acceso de emergencia

Los códigos son hashes, de un solo uso y con cinco intentos antes de un bloqueo temporal. El acceso de emergencia solo permite diagnóstico y recuperación; no permite instalar, cambiar la política ni borrar copias. Cuando Laravel vuelve a estar disponible, el controlador reconcilia los administradores activos y revoca credenciales que ya no correspondan.

La página pública de mantenimiento no muestra rutas, logs, nombres de base, copias ni secretos. Las API responden JSON `503` y las páginas HTML responden `503` con `no-store`, `noindex` y `Retry-After`.

## Recuperación tras reinicio

Una operación no terminal se convierte en `requires_intervention` al reiniciar el controlador. El sistema conserva mantenimiento, no repite migraciones ni restaura automáticamente y muestra el diagnóstico y la copia recomendada. `Consultar resultado` reconcilia una respuesta perdida mediante el identificador de operación.
