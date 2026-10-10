# UVH — despliegue en UpCloud

## Estado comprobado, 10 de octubre de 2026

**El proyecto todavía no está desplegado en la VPS.** Solo se ha realizado inventario por SSH. No existe código de UVH, Docker ni datos de la aplicación en `87.58.157.156`; tampoco se han cambiado DNS ni contratado servicios.

La publicación del trabajo local en `origin/main` precede a cualquier transferencia al servidor. El frontend está publicado en `49d0487c0d702da4098e468a264224638bb8e7ed`; el backend en `8c257b4`, la revisión documental en `ff382ee` y la política de seguridad en `40885d1`. El release utilizará el **SHA completo final publicado**, desde una copia limpia, y verificará su coincidencia con GitHub. `ac760d0` corresponde al intento histórico y no es el candidato de este lanzamiento.

Los resultados actuales de código y la política de audit se documentan en [la política compartida](npm-audit-policy.md) y [la evidencia de publicación](release-evidence/2026-10-10-implementation/README.md). Los resultados históricos quedan en [el runbook anterior](release-evidence/2026-10-10-upcloud/historical-runbook.md). Los tests unitarios no sustituyen los ensayos de producción, colas, navegador, imágenes y restauración todavía pendientes.

## Inventario y correo añadido al alcance

VPS Debian 13, arquitectura amd64, 4 vCPU, aproximadamente 8 GiB RAM y 100 GiB de disco; no hay swap. Antes de instalar, actualizar el inventario y repartir memoria entre UVH, PostgreSQL, Redis y correo, conservando margen para el sistema. No restringir SSH root hasta probar un segundo administrador con sudo.

El usuario ha elegido alojar correo y webmail en la misma máquina y enviar por el relay SMTP de Resend. Preparar Mailu con Roundcube para `webmail.uvh.es`, buzón `legal@uvh.es`, host SMTP/IMAP `mail.uvh.es` y datos persistentes. MX, correo y protocolos SMTP/IMAP usan DNS sin proxy; el webmail HTTPS pasa por Cloudflare. Verificar `uvh.es` como dominio remitente del correo y `notify.uvh.es` para los mensajes transaccionales de UVH.

Las pruebas de salida desde esta VPS hacia Resend en 465, 587, 2465 y 2587 han agotado el tiempo de espera. Esto **bloquea la aceptación del correo**; revisar la red/firewall del proveedor y probar STARTTLS/autenticación antes de anunciar un servicio operativo. La documentación de [UpCloud SMTP](https://upcloud.com/docs/guides/sending-email-smtp-best-practices/) describe el bloqueo por defecto de salida 25; [Resend SMTP](https://resend.com/docs/send-with-smtp) ofrece puertos alternativos. El resultado observado no demuestra por sí solo qué componente bloquea estos otros puertos.

## Procedencia del release

1. Publicar todos los cambios revisados; comprobar `git rev-parse HEAD` contra `git ls-remote origin refs/heads/main`.
2. Ejecutar instalación desde ambos lockfiles, audits con la política compartida, lint/typecheck/Karma/build, Composer/Pint/PHPStan/PHPUnit. Ejecutar los comandos existentes de E2E, release, arranque de producción, colas y restauración.
3. Construir API, web, Caddy DNS-01 y herramienta de backup fuera de la VPS para `linux/amd64`. Escanear imágenes y bases, conservar SBOM e informe completo. No promover si alguna comprobación queda sin resultado.
4. Ensayar el stack final con las mismas imágenes. Exportar archivos con SHA-256, IDs completos de imagen y manifiesto ligado al SHA de origen. Transferir por SSH y comprobar hashes e IDs después de `docker load` antes de arrancar.
5. Manifiesto UpCloud sin `build:`; releases en `/opt/uvh/releases/<sha>/`, configuración privada y secretos en `/etc/uvh/`, datos duraderos separados. No incluir credenciales en Git ni en imágenes.

## Dependencias y exposición

- PostgreSQL 16 privado, SCRAM y TLS, cliente `DB_SSLMODE=verify-full`; roles distintos de aplicación, migraciones y backup. Redis privado con contraseña, AOF, `noeviction` y memoria limitada.
- Mantener entrypoints, workers por cola, scheduler y comprobaciones existentes. Migrar explícitamente antes de los nuevos procesos, comprobar índice concurrente válido y precisión de microsegundos. No ejecutar `migrate:fresh` ni seeders demo en producción.
- Revisar la zona Cloudflare existente antes de cualquier modificación. La última consulta pública de **uvh.es** todavía devolvía `dns10.ovh.net`/`ns10.ovh.net`; confirmar dominio y delegación en el panel. Conservar MX/TXT/CAA y coordinar DNSSEC.
- `A @` y `A app` hacia `87.58.157.156`, proxied; `CNAME www → uvh.es`, proxied. Añadir `mail` sin proxy y `webmail` proxied según el stack de correo. Sin AAAA, wildcard ni `edge` en este lanzamiento.
- Full (strict), Caddy con renovación DNS-01 y token restringido a la zona. mTLS en el origen con certificado cliente propio de la zona. Confiar únicamente en proxies concretos; comprobar IP real, rechazo de hosts inesperados y ausencia de caché compartida para API/autenticación/enlaces cortos.

## Requisitos pendientes de las cuentas

Se necesitan sesiones o credenciales de mínimo alcance para Cloudflare, Resend, hCaptcha, UpCloud Object Storage y Better Stack. No hay todavía credenciales de producción cargadas ni canal de alertas probado. El precio concreto del almacenamiento UE debe confirmarse antes de contratar.

El nombre completo del titular autónomo sigue pendiente. El contacto legal y los datos que indicó el usuario deben cargarse por configuración protegida, con situación `not_registered`; no inventar nombre o inscripción. `legal@uvh.es` todavía no recibe correo. Usar una dirección operativa para configurar y verificar proveedores hasta que el buzón esté probado.

## Aceptación y recuperación

Restringir el acceso inicialmente al operador, crear cuenta con correo verificado y MFA y promocionarla mediante `uvh:admin:promote`. Mantener registros pausados durante aceptación. Probar DNS/TLS/renovación, landing/panel, cookies/CSRF/CSP, rechazo de acceso directo al origen, correo, MFA/recuperación, enlaces normales y de un uso, analítica, persistencia y salud de todos los pools/scheduler.

Backups cifrados cada seis horas y antes de actualizar, incluyendo PostgreSQL, almacenamiento privado de UVH y los datos/configuración del correo. Custodiar claves fuera de la VPS, confirmar subida externa y retener siete días frecuentes y treinta copias diarias. Descargar y restaurar una copia en un entorno aislado; medir recuperación y comprobar una alerta de fallo real. Aún no existe RPO/RTO medido.

Ante un fallo inicial, cerrar exposición sin borrar volúmenes ni acceso de recuperación. En actualizaciones, volver a imágenes anteriores solo con esquema compatible; restaurar una copia verificada cuando sea necesario. No ejecutar `migrate:rollback` indiscriminadamente.
