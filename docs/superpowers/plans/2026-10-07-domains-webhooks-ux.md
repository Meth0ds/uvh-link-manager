# O65 — Dominios y webhooks: configuración y diagnóstico

Continuación global S01–S13. O64 verificado contra árbol actual,829 hashes. Anterior turno: progreso (dos bugs/diseño/verificación/documentación), no espera ni cierre global. Sin agentes/control compartido/DB real/migraciones/mail/proveedores/commit/publicación. Fixtures aisladas, suites nativas, comparación de fuentes; conservar cambios compartidos e históricos.

Dirección: marca UVH existente (papel#fffcf5,tinta#262821,acento#b53c20; oscuro#2c3028/acento#f79573), Manrope funcional13–16px, código/URL13–14px. Dominio: añadir subdominio → registros DNS en detalle → comprobar → HTTPS; lista compacta por nombre/salud/impacto/siguiente acción, sin repetir todos los TXT/CNAME. Restricciones avanzadas siguen accesibles. Webhooks: receptor/estado/suscripciones/acciones; entregas expandibles con resultado/fecha/intentos, diagnóstico técnico bajo details; inspector conserva datos filtrados y reúne suscripciones/historial.

Crítica: no sustituir marca ni agregar métricas de salud no respaldadas por API. Estado activo del webhook no implica entrega. Dominio degraded/grace y errores siguen visibles. Mantener permisos, confirmaciones, handlers/identidad/idempotencia/secretos de un uso. Se elimina expansión de todo receptor como requisito para editarlo; entrega sigue carga diferida y con recuperación propia.

- [x] Contexto/snapshot y lectura completa de componentes/listas/detalles/estilos; modelos relacionados. Specs antiguos sólo localización/contexto, sin editar.
- [x] Reproducir borradores de dominio/add y visitante/saveSurface, feedback de patch fuera del workspace y caché vaciada al reenviar webhook; IDs sólo tras rojo nativo.
- [x] Corregir causas y rediseñar composición; controles de demora/error/contexto/secretos/rutas/foco/solo lectura.
- [x] Build real y QA aislada escritorio/móvil/temas, recuperación de lectura y comandos ficticios.
- [x] Verificación completa frontend/tipos/lint/build; hashes/inventario/ledgers/informe33/documentación/cleanup propios.

Fuera de este lote: DNS/CAA/TLS y entrega con proveedor real; carreras backend de S06/S08; sesión abierta/Centro seguridad; despacho auxiliar TX/CSV; AuthService/frontendauth; S13/roles/retención/capacidad/CI/release. No redefinir cierre del proyecto como suites verdes ni auditoría visual.


Resultado O65: cinco fixes B213–B217 (7+1 rojos),23 casos nuevos;41 dirigidos iniciales y1513 completos finales;types/lint/build0. Diez fuentes modificadas/830hashes;115specs antiguos íntegros. Ledgers S06/S08 parciales, callbacks leídos en contexto; no nueva cobertura exhaustiva de todos los decoders/backend. QA24 combinaciones más errores/recovery/secretos/viewer con API ficticia.

La matriz final emula movimiento reducido: la transición nativa de tema quedó busy>35s durante automatización y sigue diagnóstico separado. HAR prueba errores de conexión de la fixture Python inicial; versión HTTP1.1/backlog128 recupera carga, sin atribuirlos a producto. Ningún ID para preparaciones/harness. Capturas en ruta errónea se sustituyen tras comprobar URL ytema; no se afirma acceso/proveedor real ni perfección global.
