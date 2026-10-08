# O66 — Transición de tema, navegación y dashboard

Objetivo completo S01–S13 activo. O65 es progreso: cinco fixes,23 casos nuevos,1513 pruebas,830 fuentes actuales revalidadas. Estado Git actual incluye commits del usuario; no se revierten ni se atribuyen como cambios O66. Sin agentes, control compartido, worktree, commit/deploy ni DB/correo/proveedor real. Históricos O65 intactos.

- [x] Verificar snapshot O65 y leer tema/estilos y fuentes del dashboard actuales.
- [x] Reproducir transición nativa con build real, promesas y animaciones observables; diferenciar transporte/harness de producto. Leer spec primaria y registrar diagnóstico.
- [x] Diagnóstico de tema: sin causa de producto reproducida; no modificar su implementación.
- [x] Revisar navegación y dashboard por código completo; reproducir bugs y ajustar jerarquía según estado nuevo/recurrente y datos realmente respaldados.
- [x] Suites completas afectadas, tipos/lint/build; QA escritorio/móvil/temas con animación nativa habilitada; comparaciones, inventario, ledgers y documentación.

Diseño: preservar marca existente, papel#fffcf5/tinta#262821/acento#b53c20, oscuro#2c3028/acento#f79573 y Manrope. Tema como mejora visual, sin bloquear interacción; snapshot circular sólo cuando puede finalizar. Dashboard centrado en actividad y decisiones, no métricas inventadas. Primera lectura de fuentes actuales indica rediseño existente: reevaluar observaciones antiguas contra código antes de repetir cambios.

Límites globales: auth/frontend, sesiones abiertas/Centro, backend dominios/webhooks, TX exterior/CSV, S13 y gates externos pendientes. No declarar perfección o cierre por este lote.


Diagnóstico nativo: ready/updateCallbackDone/finished observados; cuatro clicks de puntero (~571–582 ms), dos cambios de viewport y una comprobación sin wrapper terminan con busy=false. El síntoma O65 sigue sin reproducir; no BugID ni solución inventada. Fuente primaria consultada: https://drafts.csswg.org/css-view-transitions/.

Plan visual concreto: cabecera con creación contextual; periodo y tres métricas reales, recientes recuperables de manera independiente, evolución y desglose, guía opcional y accesos secundarios al final. Manrope con texto funcional de 13–14 px; jerarquía por espacio y tamaño. Mantener la paleta de marca. Sustituir la cifra redundante de destacados por la lista real. Evitar meter nuevas tarjetas decorativas o promesas de actividad. La barra global deja de repetir Crear enlace; navegación lateral conserva la creación en páginas sin acción contextual y en móvil.

Casos a reproducir por código y pruebas nativas: denominador parcial/porcentaje pequeño, lecturas acopladas y GET innecesario al cambiar periodo; preferencia tardía de guía después de cambio de contexto y PATCH opuestos simultáneos. Preparaciones fallidas del harness (spec ausente / UTM incompleto) registradas aparte y no cuentan como bugs.


## O66 — dashboard, navegación y acciones de dominio (07/10)

Cinco bugs de consumidor corregidos: **B218/P2**, barras de países relativas a todos los clics y sin redondear tráfico pequeño a cero; **B219/P2**, fallo de una lectura no oculta la otra; **B220/P2**, preferencias tardías de la guía no alteran otro contexto; **B221/P2**, exclusión de PATCH opuestos en vuelo; **B222/P2**, cifra principal invisible por especificidad CSS, corregida en ambos temas. Optimización adicional: cambiar periodo y reintentar una sección sólo consultan su endpoint.

Diez rojos nativos válidos (8 iniciales + 2 de contraste). **28 casos nuevos y 1541/1541 pruebas finales**, tipos/lint/build con salida 0. Diez archivos de producto, dos specs nuevos; **116 specs anteriores y 820 fuentes previas ajenas intactos**, 832 hashes finales. Inventario estático: 501 archivos, 2373 funciones con nombre, 1271 anónimas, 3 firmas, 0 propietarios provisionales. Ledgers parciales S09/S12; S06 conserva controles previos y recibe QA de composición, sin nuevo cambio de lógica del dominio.

Dashboard ordenado por actividad/enlaces recientes, tres métricas respaldadas y accesos/guía secundarios. Creación contextual en dashboard/biblioteca; acceso lateral en otras páginas y drawer móvil. A petición del usuario, dominios separa configuración/enlaces, mantenimiento/preferencias y acciones destructivas en filas con consecuencias explícitas; comprobación/HTTPS contextual y confirmaciones/permisos conservados.

QA del build con API ficticia loopback 8477: **30 estados únicos** de dashboard y dominios, 1440/390/320 px, claro/oscuro con movimiento nativo habilitado; fallos 503 y recuperación GET independiente, workspace vacío, editor/viewer y cancelación de desactivación sin comandos enviados. Sin overflow horizontal global/área principal; controles de gestión de al menos 44 px y separación comprobada. No acredita DNS/TLS, cuentas, autorización API o lectores de pantalla reales.

Diagnóstico de tema nativo: promesas observadas y comprobación sin wrapper terminan con busy=false; no se reprodujo la causa del síntoma O65. Un navegador de QA quedó sin respuesta al snapshot y eval; sus endpoints CDP version/list también agotaron 5 s. Se cerró sólo esa instancia y se retomó en una nueva. La causa del bloqueo sigue sin determinar; no se asigna BugID ni se afirma resolverlo. Fallos de preparación de fixture, selector antiguo y expectativa 1.000/1000 se conservan como límites del harness, separados de los rojos de producto. Evidencia y comparador: `.uvh-runtime/o66-theme-navigation/`.

**Proyecto y S01–S13 abiertos.** Próximo: administración/equipo/estado público, AuthService/frontend auth, sesiones con vista abierta/Centro de seguridad, despacho bajo TX exterior/CSV y S13/release externo. Sin DB/correo/proveedores/migraciones/worker/control compartido/agentes/worktree/commit/push/deploy. Manifests históricos intactos.

La petición adicional del usuario de ordenar Desactivar/Revalidar se incorpora a esta pasada sin reemplazar el dashboard. Sólo HTML/SCSS de dominios cambian; DomainController::queueVerification/activate y DomainStatus::beginDnsCheck se leen como contratos de apoyo, no como auditoría backend completa.

Verificación final: normalizado únicamente el salto EOF del HTML; nueva compilación con salida 0 y los 128 archivos compilados byte a byte idénticos al build sometido a QA. diff --check limpio.
