# Rediseño UVH — punto de continuidad

> Actualización 2026-09-13: las secciones originales de abajo son históricas.
> No usar su inventario pendiente para deshacer ni repetir los commits recientes.
> Referencia visual actual: `docs/design-system.md`; estado del lote: sección siguiente.

## Revisión y continuación del 13 de septiembre

### Segundo lote: estado público e inspector de webhooks

- `/status`: identidad pública compartida, tema claro/oscuro, actualización manual,
  fecha de medición y componentes separados. Un snapshot caducado, desconocido
  o un fallo de transporte muestra «Estado desconocido», no una falsa señal verde.
- Inspector: resumen del destino, registro reglado, estados traducidos sin cambiar
  los valores del servidor, fechas explícitas, datos filtrados desplegables,
  controles ocupados y orientación por rol. Un error no se presenta como historial vacío.
- Métodos de envío/reintento y autorización del backend intactos. Solo se deshabilitan
  adicionalmente los botones mientras hay una carga o un error de lectura.
- Vista aislada: `/status` y `/app/webhooks/9001`, estados y datos largos ficticios;
  no se conecta a ningún monitor ni receptor. Escrituras bloqueadas.
- Verificación: TypeScript app/preview, lint focalizado y build de producción
  correctos (inicial 496,22 kB). 16 pruebas ChromeHeadless correctas, salida 0:
  presentación de ambas páginas y decodificadores de estado/credenciales.
- Navegador: claro/oscuro, 320/768/1024/1440; sin desbordamiento persistente medido.
  A 320px el inspector asentado tiene main client/scroll 310/310. El shell y el
  cambio de tema producen dimensiones transitorias durante su animación; no se
  certifican esas transiciones como libres de recorte en todos los frames.
- Teclado: Enter abre el payload y la guía; el enlace de salto enfoca el contenido.
  Workspace viewer sin ping/reenvíos; vacío/error/carga y datos largos revisados.
  Movimiento reducido revisado en CSS, no emulado ni auditado con lector de pantalla.
- Se conservan cambios ajenos adicionales en backend y eslint.config.js.
  Sin DB, migraciones, credenciales, envíos reales, commit, push ni merge.

Siguiente lote: formulario/listado de webhooks y modales de integración. La
independencia del monitor y la entrega real siguen siendo gates de despliegue,
no resultados acreditados por estas pruebas de presentación.

### Primer lote: 403/404 y tokens

Base inspeccionada: main limpio en `a9e69db`. Los commits del usuario ya han
convertido enlaces, dominios, analítica, integraciones, ajustes, seguridad,
administración, actividad, uso, equipo, estado público y primitivas compartidas.
Se conserva esa dirección y el marco de 3px. No se declara que todas esas
páginas hayan recibido validación visual exhaustiva en este lote.

Rama de trabajo: `codex/redesign-polish-2026-09-13`. Sin pull, commit, push o merge.

Implementado en este lote:

- 403 y 404 rehechas con wordmark actual, cambio de tema, composición propia,
  explicación y acciones distintas, orientación contextual y pie público.
  No reflejan URL/query/fragment ni revelan datos de recursos. Skip link con
  foco real y títulos de documento. Guards y autenticación sin cambios.
- Tokens: emisión/registro diferenciados, permisos y confirmación ordenados,
  estados de espera/éxito más claros. Se anuncia la disponibilidad del secreto,
  no su valor. Métodos de emisión/revocación, scopes y requisitos intactos.
- Corregidos ancho fijo móvil de caducidad, campos sin contracción y acción
  de registro con width 100% + margen 50px. Nombres y secretos largos envuelven.
- Vista aislada ampliada a Tokens y 403/404; metadatos ficticios, sin secretos,
  todas las escrituras rechazadas. Corregido nullable workspaceId preexistente
  de la propia vista. No es un bypass del router de producción.

Evidencia actual:

- TypeScript app/preview y ESLint focalizado correctos.
- 13 pruebas ChromeHeadless correctas: Tokens, credenciales, rutas y 403/404.
  Proceso terminó con código 0; Karma avisó de lentitud al cerrar Chrome.
- Build de producción correcto, sin avisos de compilación: inicial 496,19 kB.
- Navegador real con datos ficticios: Tokens claro/oscuro a 320px, registro con
  nombre sin espacios, teclado Space en un scope, carga/error/vacío y anchos
  768/1024/1440 sin overflow horizontal medido.
- 404 oscuro/móvil y claro/escritorio; 403 oscuro/escritorio/móvil y anchos
  768/1024. Skip link mueve el foco. Movimiento reducido revisado en CSS;
  no se ha hecho una sesión con lector de pantalla ni una auditoría WCAG completa.
- Sin backend, DB, migraciones, emisión de tokens, revocaciones ni credenciales reales.

Pendiente: pulido profundo por lotes del resto de páginas del usuario (no sólo
tokenizar estilos). Revisar modales MFA/invitaciones, estados extremos y datos
largos de enlaces, dominios, webhooks, equipo, ajustes, administración, uso,
actividad y `/status`; éste debe mantener la veracidad del monitor externo.
La deuda de contraste/pila monoespaciada documentada en design-system.md sigue
pendiente: no se ha cambiado la paleta global en este lote.

## Registro histórico del 8 de septiembre

## Alcance activo

Extender la identidad editorial de la landing a **todas** las páginas antiguas,
componentes, subpáginas y modales, con adaptación móvil, oscuro, microinteracciones
y atención profesional al detalle. No está terminado. El informe previo de
depuración F01–F26 tampoco se declara cerrado por este trabajo visual.

Conservar los cambios ajenos en este checkout. No se ha hecho pull, commit,
push ni merge en este lote. No ejecutar migraciones/suites sobre `uvh_local`.

## Implementado

- Landing editorial con contenido real, ejemplos locales etiquetados, pestañas,
  FAQ Material, navegación móvil y animación de revelado sin contenido oculto.
- Shell público, acceso/registro, navegación legal, privacidad/términos sin
  reescribir cláusulas, formulario de denuncia guiado y ayuda ampliada con
  búsqueda local, guías, anclas, copia de ejemplos y resolución de problemas.
- Tema compartido: papel/oliva/terracota; tokens centrales y Material con
  `use-system-variables`. Menús/selects/diálogos fuera de los componentes
  heredan la misma paleta. Estados de peligro/éxito/advertencia siguen distintos.
- Panel: estructura, wordmark, navegación, estados activos y de foco, pie de
  ayuda, workspace accesible también en móvil, avatar sin indicador ficticio
  de presencia y cambio de tema con la misma transición que las páginas públicas.
- PageHeader compartido, diálogos de confirmación sensible y crear workspace.
  Sin mínimos de ancho que desborden en móviles; controles sensibles mantienen
  cancelación y foco inicial. Selector de workspace con desplegable más ancho
  que su trigger móvil para distinguir nombres completos.
- Fallback de hCaptcha solicitado por el usuario: ver `local-captcha-fallback.md`.
  Activado sólo en el `.env` local; ejemplos por defecto false. El backend exige
  local + debug + opt-in + hosts loopback, lo rechaza en arranque de producción y
  vuelve a verificar la restricción en runtime. Las denuncias no tienen bypass.

## Evidencia de este lote

- TypeScript de la aplicación y de la vista aislada: correcto.
- ESLint focalizado en los archivos TS/HTML modificados y la vista: correcto.
- Build de producción: correcto; los módulos internos también compilan.
- Angular/ChromeHeadless: 69 pruebas correctas (acceso, decodificador público,
  tema, ayuda, landing, denuncia, navegación por rol y diálogo de workspace).
- PHPUnit de la política local y ProductionSecurity: ejecutado en contenedor
  sin red, código montado de sólo lectura y dobles de DB/HTTP. Sin arrancar
  Laravel completo ni acceder a bases de datos: **34 pruebas, 67 aserciones correctas**.
- Pint focalizado: 8 archivos correctos.
- Navegador: estructura del panel, tema claro/oscuro, diálogo sensible con foco
  en Cancelar, menú móvil y diálogo de workspace a 320 px. Sin desbordamiento
  horizontal del documento; diálogo de workspace 294 px. Revisión mediante
  `frontend/design-preview`, con datos ficticios y API bloqueada.
- Contrastes calculados de tokens principales: texto claro 13,32:1, secundario
  claro 5,45:1, acento claro 4,91:1, texto oscuro 13,79:1, secundario oscuro 6,91:1.
  Esto no sustituye una auditoría de accesibilidad de todas las pantallas.
- API local en 8000 apagada durante la revisión. La pantalla real de acceso
  mantiene el bloqueo cuando `/config` no responde: no concede bypass por caída
  del propio backend. No se ha acreditado login/registro real en este lote.

Los builds y pruebas focalizadas no acreditan toda la aplicación, navegador
autenticado con los cuatro roles, producción, DNS/TLS, webhooks reales ni E2E.

## Trabajo pendiente, sin reducir el objetivo

1. Rehacer con la misma atención las páginas internas: dashboard, primeros
   pasos, enlaces y detalle/papelera, actividad, uso, analítica/gráficos,
   dominios/detalle, tokens, webhooks/inspector, equipo, ajustes, seguridad y admin.
   Heredar los nuevos colores no equivale a haber terminado su rediseño.
2. Modales específicos: enlace (pestañas y edición), QR, seguridad/MFA,
   equipo/invitaciones y diálogos embebidos en ajustes/admin.
3. Subpáginas de acceso: verificación/cambio de email, contraseña olvidada y
   reset, recuperación, incidentes, exportación, eliminación/cancelación de
   cuenta, reautenticación e invitaciones. El shell ya es nuevo; revisar cada
   composición y `auth-card.scss`, todavía antiguo.
4. Estado público `/status` y páginas 403/404; preservar la verdad operativa:
   nunca presentar el frontend local como monitor externo real.
5. Revisión de páginas con datos largos/vacíos/carga/error, teclado, motion
   reducido y claro/oscuro a varios anchos. Verificar contratos y permisos.

## Reanudar de forma reproducible

- Aplicación: `ng serve --host 127.0.0.1 --port 4300 --no-open` desde frontend.
- Vista de componentes: instrucciones en `frontend/design-preview/README.md`.
  Es otro entry point, no una ruta sin auth en la aplicación. No se despliega.
- No depender de procesos o pestañas del chat: comprobar handles/puertos vivos
  antes de abrir otro servidor. No arrancar colas ni scheduler para mirar CSS.
