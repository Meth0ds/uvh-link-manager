# Continuación del diseño claro en acceso y panel

Objetivo completo del usuario: Ayuda/Denuncia profesionales y directas, extender la coherencia al resto de páginas y sumar transiciones/microinteracciones. O76 verifica primero el lote público; este plan conserva el alcance restante.

Trabajo inline en el checkout autorizado, sin agentes, commits, despliegue, DB/proveedores ni control compartido. Antes de editar producto, todos los procesos propios de verificación/QA deben estar terminales. Preservar los cambios concurrentes de auth/admin/backend.

## Acceso

Fuentes: auth-shell.component.ts/.scss, auth-card.scss, security-flow.scss. Leer los consumidores y sus pruebas antes de editar. El shell debe describir la función real («Acorta y gestiona tus enlaces») y mostrar un ejemplo claro de destino editable. Sustituir cartel girado, metáfora, microtexto monoespaciado y lema repetido por jerarquía sobria, borde sencillo y texto de 13–16 px. Conservar skip por foco sin tocar fragmentos que pueden contener credenciales. Todos los enlaces de navegación ≥44 px; móvil da prioridad al formulario. Una entrada discreta del contenido, foco claro, flechas al hover para pointer fine, feedback de pulsación y reduced-motion. Compartidos de recuperación: texto secundario ≥13 px, cuerpo 16 px, acciones legibles, hints Material dinámicos verificados sin solapamiento. No cambiar tokens, confirmaciones, guardas ni contratos de autenticación.

No editar auth.component.ts/.html/.scss ni admin.component.* mientras su trabajo concurrente continúe. Registrar las frases pendientes en esas superficies para conciliación posterior; no afirmar el objetivo completo terminado por el shell.

## Panel

Leer dashboard, analytics/charts, getting-started, domain-detail y colas admin-destinations/appeals. Buscar títulos abstractos y describir tareas, clics y configuración observada con nombres comprensibles. Mantener la distinción entre observación local y finalización verificada del servidor, entre clics y personas, y entre bloqueo de URL/host y moderación del enlace. Actualizar únicamente presentación; conservar directivas, permisos, decisiones y estados. Revisar legibilidad y acciones de las restantes pantallas; reutilizar transiciones de página/menu ya introducidas antes de añadir animaciones redundantes.

## Evidencia requerida

- [x] Lectura y baseline de fuentes propias/consumidores; cambios mínimos sin pisar trabajo ajeno.
- [x] Acceso coherente en todas sus rutas: login/registro/recuperación/verificación/invitación/seguridad, incluidos estado sin enlace y error, con contratos existentes preservados.
- [x] Copy del panel directo y estados honestos; revisar las restantes páginas del inventario y resolver los casos encontrados.
- [x] Pruebas afectadas, compilación, lint, tipos; una prueba de interacción sólo si el comportamiento cambia, no tests que reflejen CSS.
- [x] QA con build copiado y API ficticia, cinco anchuras, ambos temas, teclado, hover/pressed y reduced-motion; sin red real ni writes no autorizados.
- [x] Reconciliar frases pendientes de auth/admin cuando el estado permita un cambio seguro, verificar el alcance completo antes de marcar el objetivo terminado.

## Alcance concreto O77 y estado actual

Las diferencias Git auth/admin son preexistentes; los ficheros revisados no han cambiado desde08:16–08:17. No hay proceso propio vivo. Se capturan19 fuentes antes de una edición selectiva de presentación. Se permite tocar frases y SCSS de auth.component conservando íntegra su nueva pausa de registro y la lógica de verificación; no se modifica auth.component.ts ni admin.component.*.

Acceso: lado de marca con explicación literal y un ejemplo URL/destino claramente ilustrativo; retirar giro/serif/metáforas. Texto16/13–14 y navegación44; campos/hints Material mediante tokens documentados en Sass local, subscriptSizing dinámico en formularios para evitar solapamiento al envolver texto. Recuperación y todos los estados de seguridad usan las hojas compartidas. Hints/error de Material respetan reduced-motion dentro del shell. Entrada de página/etapa única, limitada a5px/220–300ms; no nueva transición de router ni animación constante. Panel: títulos concretos de clics/configuración/registros y explicación directa de bloqueos. Se conserva que las comprobaciones observadas no prueban llegada al destino ni producción. PageHeader compartido mejora lectura en todo el panel; sus consumidores conservan controles/contratos.

Antes de ampliar cualquier otra fuente, capturar baseline y añadir motivo. Nuevas pruebas sólo si cambia un comportamiento; este lote es de presentación y se valida con las pruebas existentes y QA de build.

Fuentes añadidas a baseline antes de editar: account-recovery-request/complete (sólo subscriptSizing del template), dashboard/getting-started SCSS (lectura de metadata y estados, sin modificar lógica). Total23 fuentes;129 specs previas capturadas intactas. Se revisan los métodos de recuperación pero no se alteran.

Primer full1766/1767: una expectativa de título seguía buscando «Recupera tu verificación». Se actualiza sólo ese literal a «Solicitar otro enlace de verificación», conservando el test de recuperación con email y todas sus aserciones de comportamiento.128 specs intactas; una adapta únicamente el texto deliberadamente cambiado. No es una regresión de registro ni un fallo concurrente.

## O77 — Acceso claro, coherencia del panel y microinteracciones (08/10/2026)

El shell de acceso explica enlaces cortos y destinos editables con un ejemplo identificado como ilustrativo. Se sustituyen metáforas y cartel girado por jerarquía Manrope, lectura16/13px y navegación44px. Login, registro, invitación y recuperación tienen títulos directos; formularios con hints dinámicos, acciones48px, entrada única5px/260ms y reduced-motion incluso en wrappers Material. Se corrige la especificidad del aviso del proveedor: fuente13px y enlaces44px comprobados en navegador. Modal MFA cabe en320px. Panel: PageHeader compartido13/15px y copy directo en dashboard/analítica/primeros pasos/dominio/uso/actividad/colas/webhooks. La guía conserva comprobaciones observadas; no promete verificación de producción ni llegada al destino.

23 fuentes de presentación y una expectativa de título adaptada;128 specs anteriores intactas. Las clases de AuthShell/Invitación/Recuperación permanecen idénticas a baseline. AuthComponent TS/admin principal/backend preexistentes se conservan. Lectura adicional de enlaces/equipo/tokens/notificaciones/ajustes/seguridad confirma tareas y estados concretos; siguen usando el encabezado compartido y sus controles/transiciones existentes. No se cambian tokens, permisos, decisiones, guards ni contratos de seguridad.

1767/1767 frontend después del último ajuste cosmético; build12,728s, lint y tipos exit0. QA final del build copiado/API ficticia:341 estados (16 rutas de acceso y17 del panel en1440/1024/768/390/320 y ambos temas, más flujos de registro/recuperación/verificación/MFA/moderación y movimiento reducido). Cuatro comandos exclusivamente ficticios:registro, recuperación, rechazo de verificación y challenge MFA.33 estados extra: hover de navegación/CTA desktop y menú móvil, foco por teclado, Escape/inert, reduced-motion0s, tamaño de proveedor/acción y estados error/pausa de registro + vacío/error del panel. Entrada táctil390 verificada: navegación cierra menú y no retiene desplazamiento hover. Sin pageerrors/red externa/desbordamiento global; esta fixture no proporciona todas las proyecciones del panel y conserva su estado de error cuando faltan. No sustituye pruebas con backend/proveedor reales ni revisión Firefox/lector de pantalla.

Preservación/evidencia: `.uvh-runtime/o77-remaining-pages/verify.py`, manifests24 fuentes/128 archivos de build y registro de procesos terminales. O76 revalidado:20 fuentes y128 archivos de su build histórico; cláusulas legales intactas. La comprobación final de whitespace detectó una línea vacía al EOF de report SCSS: se retira y se conserva prueba exacta de esa única diferencia frente al hash O76. La compilación posterior9,022s produce los128 archivos idénticos byte a byte al build ya probado; no cambia CSS ni requiere repetir navegador. Git diff --check pasa. El inventario estático503/2455named/1335anonymous/3signatures/0provisional enumera fuentes y no acredita auditoría backend nueva.

Intentos separados: primer full tuvo una expectativa del título anterior (se cambia sólo ese literal); primer navegador terminó330 estados y falló por selector `confirm` del harness (registro usa `confirmPassword`). Primer actions completó flujos pero el init script del harness intentaba localStorage en iframe sandbox; se limita al documento principal y luego se usa un único init por contexto. Primer extra asumía que la pausa/error ocultaba el formulario, cuando el contrato existente lo muestra y bloquea el envío; se comprueba su segunda etapa real, aviso y botón deshabilitado. No se adapta producto para satisfacer esos supuestos. Hallazgos visuales reales corregidos: acciones Material de40px y tamaño10px del aviso del proveedor. Todos los intentos/logs se conservan.

Sin control compartido, panel independiente, agentes, DB/cuentas/mail/proveedores, commit ni despliegue. El objetivo activo de diseño queda cubierto por O76+O77; los antiguos sistemas S01–S13 y la preparación de producción conservan sus pendientes históricos y no son certificados por este cierre.

## Conciliación del objetivo completo

| Petición | Resultado y evidencia |
| --- | --- |
| Terminar el landing en curso | O75 concluido y O76 conserva su navegación, footer/wordmark y anclas; fuentes del landing presentes en hashes O76. Hover/foco desktop y hover/tap móvil revalidados con el build final O77. |
| Ayuda seria y profesional | O76: búsqueda local, accesos por tarea, índice, guías con títulos concretos y contenido técnico preservado. Pruebas existentes y QA público97 estados. |
| Denunciar enlace claro | O76: formulario prioritario en DOM, secciones de datos/motivo/antiabuso, estados de envío/error/acuse explícitos, copia del procedimiento directa. Dos envíos sólo ficticios y validación inválida sin comando. |
| Extenderlo a páginas públicas restantes | Shell común, documentos legibles, estado del servicio y403/404; cláusulas/versiones legales preservadas y anclas/foco comprobados. |
| Extenderlo a acceso y panel | O77: shell y hojas comunes de acceso, copy de login/registro/invitación, hints dinámicos y acciones cómodas; PageHeader común y textos literales seleccionados del panel.16 rutas de acceso y17 del panel revisadas en cinco anchos/ambos temas. |
| Más transiciones y microinteracciones | Entradas discretas, subrayados y flechas, estados pressed/focus, menú móvil animado con Escape/inert, preferencias de movimiento y comprobación táctil sin hover persistente. O76+O77,1767 frontend,build/lint/tipos y QA registrados. |
| Preservar trabajo existente | Clases de acceso seleccionadas idénticas,128 specs intactas y una adaptación exclusiva de título; lógica auth/admin/backend preexistente conservada. Sin control compartido/panel ajeno/agentes/DB/proveedores/commit/deploy. |

Resultado: alcance activo de diseño completado. No implica cerrar los sistemas históricos S01–S13 ni acreditar operación/seguridad de producción.
