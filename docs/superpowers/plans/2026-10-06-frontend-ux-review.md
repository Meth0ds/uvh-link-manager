# Revisión de diseño y UX frontend — O62

Petición: buscar lo que desentona o resulta pobre en diseño y mejorar UX con atención al detalle. Primera pasada de código en panel, biblioteca, gestores, equipo, ajustes, dominios, tokens, webhooks, analítica, actividad, seguridad y pantallas públicas. Distinguir problemas comprobados de propuestas y fronteras no revisadas. No declarar perfección ni cierre de S01–S13.

Dirección: identidad actual UVH (papel #fffcf5, tinta #262821, acento #b53c20, oscuro #2c3028, acento oscuro #f79573) a través de tokens, Manrope para lectura y monospace sólo para direcciones/código. Biblioteca con búsqueda a todo el ancho y tres filtros etiquetados debajo; herramientas de organización y CSV agrupadas. Gestores con introducción breve, recuento, filas legibles y estados que expliquen cómo continuar. Mantener acciones existentes y autoridad del backend.

Revisión del planteamiento: evitar cambiar toda la marca o añadir tarjetas decorativas. El recorrido URL corta→destino ya define el editor nuevo. Esta pasada concentra la intervención en encontrar y organizar enlaces. Las propuestas para otros módulos quedan priorizadas en el informe.

- [x] Leer fuentes/templates/styles y snapshots anteriores; 817 hashes O61 intactos.
- [x] Informe extenso con ubicación, impacto y prioridad; pendientes explícitos.
- [x] Reproducir pérdida de borrador, error confundido con vacío y opciones null invisibles.
- [x] Corregir esas fronteras y mejorar biblioteca/gestores sin tocar negocio externo.
- [x] QA Angular compilado real + API ficticia aislada, desktop/móvil/temas/teclado/errores.
- [x] Tests significativos, tipos/lint/build, comparación de fuentes y documentación.

No agentes, control compartido, DB/cuentas/correo/proveedores reales, migraciones, commit/push/deploy. S01–S13 continúa activo. Fuente revisada directamente según petición del usuario; navegador complementario. Guías frontend-design, web-design-guidelines, planning-with-files, agent-browser y verification-before-completion.

Resultado local: informe33 puntos, B205–B208,15 nuevos/1453 completos, tipos/lint/build0;819hashes/108specs previos íntegros. QA ycomparador en `.uvh-runtime/o62-frontend-ux/`. Todos los checks anteriores son del lote local; pendientes del informe yS01–S13 siguen activos.


## O64 — Ajustes por tareas y sesiones legibles (06/10)

Cinco vistas persistentes: perfil, seguridad, notificaciones, datos y cierre. Una visible; borradores, formularios, secretos/códigos MFA y guardado pendiente conservan su instancia. Enlaces canónicos/aria-current, apertura modificada nativa y salto local con foco al título; replaceState conserva el contrato anterior, sin nuevo historial. Perfil compacto, texto funcional legible y frecuencia de avisos con nombre accesible. Helper de navegador/sistema compartido; cadena técnica en detalles en Ajustes, UA sin autoridad de identidad.

B211/P2: se comparaba la caducidad de sesiones con el reloj anterior al await; dos rojos (respuesta tardía/límite exacto), reloj evaluado tras la respuesta vigente. B212/P2: requisitos de cierre fallidos dejaban tarjeta vacía; un rojo, error persistente y reintento GET sin abrir eliminación.17 casos nuevos;105 dirigidos previos,41 actuales de recuperación/exportación y **1490/1490 frontend de entrega**. Tipos/lint/build terminal0; build10,534s. QA aislada de cinco vistas,1440/390/320 y ambos temas;44 observaciones más7 de entrega, cero comandos.

Comparador O64:829 hashes actuales,811 fuentes previas ajenas intactas y112 specs previos íntegros. Un fixture existente cambió concurrentemente para abrir privacy; expectativas de foco y comandos conservadas. Cinco fuentes ajenas cambiadas/borradas y cinco scripts nuevos ajenos se registran aparte; manifests históricos O63 intactos. Inventario estático501/2369named/1271anonymous/3firmas/0provisional; anchors S01 388/86archivos,S02 205/32,S10 63/9. Enumeración de scripts compartidos no acredita revisión/ejecución del control ni CJS. Preparación fallida, primera full con3fallos de fixture y timeout CLI conservados; sólo los3 rojos nativos válidos sustentan B211/B212.

Informe33 puntos:16/17/18 resueltos; detalles, fuentes y límites en `docs/superpowers/plans/2026-10-06-settings-sections-ux.md` y `.uvh-runtime/o64-settings-ux/`. Sin DB/cuentas/mail/providers/migraciones/worker/scheduler/control/commit/publicación ni nuevo gate backend. Próximo visual: dominios/webhooks. Pendientes: sesión caducada con vista abierta, revocación/identidad del Centro, despacho auxiliar bajo TX exterior/CSV, AuthService/frontendauth, S13 yrelease externo. **Objetivo global y S01–S13 abiertos.**
