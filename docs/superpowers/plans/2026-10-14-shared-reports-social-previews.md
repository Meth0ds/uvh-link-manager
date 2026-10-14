# Informes compartibles y tarjetas sociales — ejecución

Plan aprobado en el chat. Ejecución sin subagentes e integración con los cambios previos del proyecto.

- [x] Servicio común y API de informes con selección, permisos, idempotencia y acceso revocable.
- [x] Gestión visual, editor y página pública de informes.
- [x] Configuración social, carga segura, lectura sin consumo e integración histórica.
- [x] Interfaz de tarjeta social, recorte, referencias y limpieza.
- [x] Pruebas locales frontend/backend, análisis, lint, build y revisión visual en Chromium/WebKit.
- [ ] Validación externa: Firefox operativo, Safari nativo/dispositivos físicos y lectores sociales reales sobre HTTPS público.

Decisiones: propietarios/admins publican; informes vivos de hasta 100 enlaces; contraseña opcional; caducidad inicial 30 días; tarjeta neutra con contraseña.

Evidencia y reproducción: `docs/release-evidence/2026-10-14-sharing/README.md`.
Migraciones aplicadas únicamente al entorno local y a `uvh_test`. Funciones activas en local; las plantillas de producción conservan las activaciones deshabilitadas. La validación descrita no incluye un despliegue a producción.
