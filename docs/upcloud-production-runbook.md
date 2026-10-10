# UVH — despliegue en UpCloud

## Estado comprobado, 10 de octubre de 2026

**El proyecto todavía no está desplegado en la VPS.** El código está publicado en GitHub y el host ya está preparado, pero aún no se han transferido imágenes ni creado datos de UVH. Docker 29.9.0 y Compose v5.6.0 están instalados; el administrador `uvh-admin` y sudo se han probado en una segunda sesión SSH. No se han cambiado DNS desde este despliegue ni contratado servicios.

La publicación del trabajo local en `origin/main` precede a cualquier transferencia al servidor. El frontend está publicado en `49d0487c0d702da4098e468a264224638bb8e7ed`; el backend en `8c257b4`, la revisión documental en `ff382ee` y la política de seguridad en `40885d1`. El release utilizará el **SHA completo final publicado**, desde una copia limpia, y verificará su coincidencia con GitHub. `ac760d0` corresponde al intento histórico y no es el candidato de este lanzamiento.

Los resultados actuales de código y la política de audit se documentan en [la política compartida](npm-audit-policy.md) y [la evidencia de publicación](release-evidence/2026-10-10-implementation/README.md). Los resultados históricos quedan en [el runbook anterior](release-evidence/2026-10-10-upcloud/historical-runbook.md). Los tests unitarios no sustituyen los ensayos de producción, colas, navegador, imágenes y restauración todavía pendientes.

El [preflight del candidato](release-evidence/2026-10-10-candidate-preflight/README.md) añade la corrección de invitaciones, 2048 pruebas frontend y la preparación real del host; todavía exige los gates finales.

La [validación desde copia limpia y preparación operativa](release-evidence/2026-10-10-production-preparation/README.md) registra la suite backend completa aprobada: 2899 tests / 33643 aserciones sobre el código publicado `d3d5f18`.

## Inventario y correo añadido al alcance

VPS Debian 13 en Madrid (`es-mad1`), arquitectura amd64, 4 vCPU, 7907 MiB RAM y aproximadamente 100 GiB de disco. Se han instalado 2 GiB de swap, actualizaciones automáticas de seguridad y logs Docker limitados (10 MiB × 3 por contenedor). LLMNR/mDNS están desactivados. Mantener el acceso de recuperación SSH hasta terminar la aceptación. La huella almacenada se sigue comprobando estrictamente por SSH; la comprobación independiente desde la consola de UpCloud continúa pendiente y fue aplazada por el usuario.

El firewall aplicado cubre IPv4 e IPv6: permite SSH, tráfico establecido, ICMP y DHCP; el tráfico publicado por Docker queda restringido a los rangos oficiales de Cloudflare y puertos 80/443. SMTP/IMAP siguen cerrados. Se conserva una recuperación de las reglas en `/etc/uvh/recovery/`. La persistencia del firewall se ha comprobado tras reiniciar Docker y abrir una nueva sesión SSH. La aplicación todavía necesita comprobar exposición real y mTLS configurado para la zona antes de abrir.

El usuario confirmó Madrid (`es-mad1`) y aplazó la recepción de `legal@uvh.es` y el despliegue de buzones/webmail. El alcance de apertura es UVH con Resend transaccional; no arrancar el stack Mailu ni añadir sus MX/SMTP/IMAP/webmail en este lanzamiento. La cuenta administradora y las alertas usarán la dirección operativa facilitada, almacenada en configuración privada. La recepción del contacto público continúa pendiente y no debe anunciarse como verificada.

El usuario ha elegido alojar correo y webmail en la misma máquina y enviar por el relay SMTP de Resend. Preparar Mailu con Roundcube para `webmail.uvh.es`, buzón `legal@uvh.es`, host SMTP/IMAP `mail.uvh.es` y datos persistentes. MX, correo y protocolos SMTP/IMAP usan DNS sin proxy; el webmail HTTPS pasa por Cloudflare. Verificar `uvh.es` como dominio remitente del correo y `notify.uvh.es` para los mensajes transaccionales de UVH.

Las pruebas de salida desde esta VPS hacia Resend en 465, 587, 2465 y 2587 han agotado el tiempo de espera. Una segunda comprobación confirmó timeout también hacia Gmail en 587, mientras HTTPS/443 a Resend y Cloudflare funciona. El usuario confirmó el bloqueo de salida 25 y mantiene Resend como relay. Esto **bloquea la aceptación del correo** hasta probar STARTTLS y autenticación; revisar restricciones de cuenta/firewall del proveedor. [UpCloud](https://upcloud.com/docs/products/networking/faq/) documenta restricciones adicionales durante el periodo de prueba; [Resend SMTP](https://resend.com/docs/send-with-smtp) ofrece puertos alternativos. Las pruebas no identifican por sí solas el componente que bloquea esos otros puertos.

Resend no sustituye al receptor SMTP de Mailu. Para recibir correo de otros servidores, el puerto 25 entrante debe estar permitido; todavía falta confirmar el alcance del bloqueo del proveedor y probar recepción externa real.

## Artefactos preparados y ensayados

- `docker-compose.upcloud.yml`: imágenes por ID, `pull_policy: never`, arquitectura amd64, PostgreSQL/Redis privados, roles separados, workers existentes y límites de memoria. `docker-compose.upcloud-mail.yml` adapta la plantilla oficial Mailu 2024.06 para Roundcube, Rspamd y ClamAV, sin exponer HTTP/HTTPS del contenedor de correo.
- Imagen PostgreSQL sin root: SCRAM, TLS obligatorio, usuario de aplicación sin permisos DDL y backup de solo lectura. La imagen Caddy sin root incorpora el módulo Cloudflare fijado a un commit; limita hosts, exige certificado cliente firmado por la CA propia de la zona y restaura IP solo desde los proxies configurados.
- `node scripts/upcloud-compose-check.mjs` comprueba la configuración efectiva sin arrancar contenedores. `node scripts/upcloud-postgres-drill.mjs` y `node scripts/upcloud-caddy-drill.mjs` crean proyectos desechables; nunca cargan `.env` de producción. Los ensayos locales de configuración usan imágenes nativas ARM64; todavía hay que construir, escanear y ensayar los artefactos finales amd64.
- El ensayo PostgreSQL comprueba rechazo de texto claro/CA ajena/hostname incorrecto, autenticación SCRAM, separación de roles, `pg_dump` y persistencia tras reinicio. El de Caddy comprueba mTLS, certificado ajeno, IP confiada, cabeceras falsificadas, restricción al operador, hosts, www y proxy del webmail. Sustituye únicamente ACME por certificados desechables; no demuestra todavía emisión o renovación DNS-01 real.
- Trivy IaC HIGH/CRITICAL terminó con código 0. Mailu pasa la validación de Compose, pero **no está arrancado ni aceptado**. La emisión/renovación del certificado SMTP/IMAP, el mailbox, relay, registros DNS y pruebas de entrega siguen pendientes.

Los techos actuales suman 3744 MiB para UVH en ejecución y 2912 MiB para correo, dejando aproximadamente 1251 MiB de los 7907 MiB inventariados para el sistema y margen. La tarea de migración es temporal. La swap de 2 GiB ya está instalada; comprobar RSS real, picos, latencia y reinicios/OOM durante aceptación; los límites no sustituyen mediciones. FPM comienza con dos hijos; los workers ordinarios usan PHP 128 MiB y exportaciones conserva 256 MiB.

La asignación de IP es determinista para evitar que Docker entregue a otro proceso una dirección del proxy confiado. Redes: borde `172.29.0.0/24`, aplicación/datos `172.30.0.0/24` y correo `172.31.0.0/24`. Solo Caddy y el frontend de Mailu comparten la red del borde; el correo no accede a PostgreSQL/Redis de UVH.

Instalar `/etc/uvh/` con acceso solo de root. Los `.env` privados usan modo 0600; los ficheros individuales montados como secretos necesitan lectura para los UID de sus contenedores y pueden usar 0444 dentro de un directorio padre 0700. Nunca montar la carpeta completa de secretos. PostgreSQL usa UID/GID 70 para TLS/datos; Caddy UID/GID 10001 para sus volúmenes. `origin/` contiene únicamente la CA pública y la política de acceso, legibles por Caddy; las claves privadas de CA quedan fuera del VPS.

Durante aceptación, copiar exactamente `docker/caddy/access-operator.caddy.example` a `/etc/uvh/origin/access.caddy`, configurar `UVH_ACCESS_MODE=operator` e IPs individuales en `UVH_OPERATOR_CIDRS`. Caddy rechaza una política diferente, ausente o rangos amplios. Solo después de aceptación se instala un fichero explícitamente vacío y `UVH_ACCESS_MODE=open`.

## Procedencia del release

1. Publicar todos los cambios revisados; comprobar `git rev-parse HEAD` contra `git ls-remote origin refs/heads/main`.
2. Ejecutar instalación desde ambos lockfiles, audits con la política compartida, lint/typecheck/Karma/build, Composer/Pint/PHPStan/PHPUnit. Ejecutar los comandos existentes de E2E, release, arranque de producción, colas y restauración.
3. Construir API, web, Caddy DNS-01 y herramienta de backup fuera de la VPS para `linux/amd64`. Escanear imágenes y bases, conservar SBOM e informe completo. No promover si alguna comprobación queda sin resultado.
4. Ensayar el stack final con las mismas imágenes. Exportar archivos con SHA-256, IDs completos de imagen y manifiesto ligado al SHA de origen. Transferir por SSH y comprobar hashes e IDs después de `docker load` antes de arrancar.
5. Manifiesto UpCloud sin `build:`; releases en `/opt/uvh/releases/<sha>/`, configuración privada y secretos en `/etc/uvh/`, datos duraderos separados. No incluir credenciales en Git ni en imágenes.

`scripts/upcloud-image-bundle.py export` exige copia limpia, SHA coincidente con `origin/main`, imágenes amd64 y etiqueta `org.opencontainers.image.revision` para las imágenes propias. Genera un archivo por ID y un manifiesto con hashes. `verify` e `import` exigen el hash de manifiesto y SHA conservados por el remitente, comprueban todo el lote antes de cargar y rechazan archivos alterados, arquitectura incorrecta o IDs distintos. `import` escribe el fichero de IDs con modo 0600 solo tras inspeccionar todas las imágenes cargadas; no arranca servicios. Necesita Docker con soporte de selección `--platform`. El estado de validación del bundle comienza como pendiente: la integridad de transporte no sustituye audits, SBOM ni gates de promoción.

## Dependencias y exposición

- PostgreSQL 16 privado, SCRAM y TLS, cliente `DB_SSLMODE=verify-full`; roles distintos de aplicación, migraciones y backup. Redis privado con contraseña, AOF, `noeviction` y memoria limitada.
- Mantener entrypoints, workers por cola, scheduler y comprobaciones existentes. Migrar explícitamente antes de los nuevos procesos, comprobar índice concurrente válido y precisión de microsegundos. No ejecutar `migrate:fresh` ni seeders demo en producción.
- Revisar la zona Cloudflare existente antes de cualquier modificación. La última consulta pública de **uvh.es** todavía devolvía `dns10.ovh.net`/`ns10.ovh.net`; confirmar dominio y delegación en el panel. Conservar MX/TXT/CAA y coordinar DNSSEC.
- `A @` y `A app` hacia `87.58.157.156`, proxied; `CNAME www → uvh.es`, proxied. `mail`, MX y `webmail` quedan aplazados con el correo. Sin AAAA, wildcard ni `edge` en este lanzamiento.
- Full (strict), Caddy con renovación DNS-01 y token restringido a la zona. mTLS en el origen con certificado cliente propio de la zona. Confiar únicamente en proxies concretos; comprobar IP real, rechazo de hosts inesperados y ausencia de caché compartida para API/autenticación/enlaces cortos.

## Requisitos pendientes de las cuentas

Se necesitan sesiones o credenciales de mínimo alcance para Cloudflare, Resend, hCaptcha, UpCloud Object Storage y Better Stack. Cloudflare llegó a autenticarse mediante el complemento: la zona existente `uvh.es` estaba pendiente y sin registros; nameservers asignados `alina.ns.cloudflare.com` y `aragorn.ns.cloudflare.com`. El usuario indica que ya cambió la delegación en OVH y pide comprobar propagación al final. Resend figura instalado en el catálogo; todavía no se ha accedido a su API desde esta sesión. No hay credenciales de producción cargadas ni canal de alertas probado.

La [tarifa publicada de UpCloud Object Storage](https://upcloud.com/pricing/) es 5 €/mes por los primeros 250 GB, con incrementos automáticos de 250 GB por otros 5 €/mes; facturación por horas. Confirmar importe e impuestos de la cuenta antes de contratar, y elegir otra región UE distinta de la VPS. No se ha contratado almacenamiento.

El usuario ya proporcionó nombre completo y datos del titular autónomo. Cargarlos por configuración protegida con situación `not_registered`; no publicar NIF/domicilio en documentación del repositorio. `legal@uvh.es` todavía no recibe correo y será el contacto indicado. Cuando se retome el correo, crear y probar también alias concretos para los canales existentes de UVH (`soporte`, `privacidad`, `abuse` y `postmaster`), evitando un catch-all. Las cuentas existentes de proveedores permiten preparar el envío mientras se crea el buzón.

## Aceptación y recuperación

Restringir el acceso inicialmente al operador, crear cuenta con correo verificado y MFA y promocionarla mediante `uvh:admin:promote`. Mantener registros pausados durante aceptación. Probar DNS/TLS/renovación, landing/panel, cookies/CSRF/CSP, rechazo de acceso directo al origen, correo, MFA/recuperación, enlaces normales y de un uso, analítica, persistencia y salud de todos los pools/scheduler.

Backups cifrados cada seis horas y antes de actualizar, incluyendo PostgreSQL y almacenamiento privado de UVH; incorporar los datos/configuración del correo cuando se despliegue. Custodiar claves fuera de la VPS, confirmar subida externa y retener siete días frecuentes y treinta copias diarias. Descargar y restaurar una copia en un entorno aislado; medir recuperación y comprobar una alerta de fallo real. Aún no existe RPO/RTO medido.

Ante un fallo inicial, cerrar exposición sin borrar volúmenes ni acceso de recuperación. En actualizaciones, volver a imágenes anteriores solo con esquema compatible; restaurar una copia verificada cuando sea necesario. No ejecutar `migrate:rollback` indiscriminadamente.
