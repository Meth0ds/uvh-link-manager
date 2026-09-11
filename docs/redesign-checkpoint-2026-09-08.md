# Rediseño UVH — punto de continuidad

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
