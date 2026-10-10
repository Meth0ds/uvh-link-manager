# Preparación de producción — 10 de octubre de 2026

Backend de la copia limpia publicada `d3d5f18efc26530cc8cc34c73d0d84832b5e2b07`: instalación Composer desde lockfile, validate, audit, Pint (534 ficheros), PHPStan, esquema y **2899 tests / 33643 aserciones** aprobados, sin fallos, en 771,32 segundos. Base aislada `uvh_test`, volumen desechable y limpieza terminada con código 0. [Estados](backend-clean-status.tsv). La evidencia histórica conserva el intento con tres fallos por el nombre de la base.

Los nuevos artefactos operativos, revisados separadamente, pasan la comprobación efectiva de Compose, el ensayo real PostgreSQL (TLS/SCRAM/roles/dump/reinicio) y el ensayo real Caddy (mTLS/proxies/cabeceras/acceso/hosts/webmail). Los certificados del ensayo son desechables; ACME real sigue pendiente. Imágenes locales nativas ARM64 de validación, todavía no artefactos de promoción amd64. Trivy IaC HIGH/CRITICAL: código 0. La política npm mantiene sus nueve regresiones aprobadas.

Los [hashes de los logs locales](local-log-sha256.json) permiten contrastar los archivos conservados en `.uvh-runtime/`; no sustituyen el acceso a los logs ni acreditan despliegue. Las pruebas del webmail utilizan un upstream desechable y prueban el proxy; no son aceptación de Roundcube/Mailu.

El VPS todavía no tiene UVH, Docker o correo instalados. Pendientes: huella contrastada en consola, configuración real y acceso a proveedores, Mailu/relay/certificado de correo, E2E/release/boot/colas/restauración, construcción y escaneo completo de imágenes y bases, archivo/hashes/IDs, backups externos, DNS y aceptación de producción. No se ha contratado ningún servicio. [Runbook](../../upcloud-production-runbook.md).
