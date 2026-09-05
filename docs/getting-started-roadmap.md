# PRODUCT-001 — Primeros pasos por workspace

Iniciado el 5 de septiembre de 2026, por petición expresa de abordar el roadmap
opcional al terminar BAF-138. No implica que producción o validación estén cerradas.

## Implementado y revisado estáticamente

- GET `/api/v1/workspaces/:id/getting-started` para sesión verificada, con
  pertenencia y versión de cuenta reconsultadas en la misma sentencia SQL que
  los hechos. Subconsultas correlacionadas al workspace autorizado, sin usar la
  cabecera para cambiar de tenant. No agrega usuarios ni expone recursos crudos.
- Estado derivado de tablas existentes: enlace no borrado; redirección admitida
  (`click_count > 0`); dominio añadido; otro miembro verificado no suspendido;
  invitación pendiente vigente con emisor aún autorizado; MFA del usuario actual.
- Invitaciones ocultas con `null` a roles inferiores a admin. Capacidades por rol
  para crear enlace, añadir dominio e invitar. No son autorización para mutar.
- Contrato `WorkspaceGettingStarted` y pantalla `/app/getting-started` con acceso
  desde el menú. El mismo componente ofrece una tarjeta compacta en Dashboard;
  se oculta al omitir o tener presentes enlace, redirección admitida y MFA.
  Dominio y equipo son opcionales y no forman parte de esas tres señales.
- Cinco pasos con acciones internas por capacidad y estados cargando/error/vacío,
  guía omitida y señales presentes. La explicación distingue datos observados de
  pruebas personales, recepción de correo y DNS/TLS. No visita URLs automáticamente.
- Omisión/reanudación por usuario/workspace: se guarda sólo el valor `1` en
  `uvh.getting-started.hidden.v1:<userId>:<workspaceId>`, nunca hechos completados.
  Reanudar vuelve a leer el backend; también se puede omitir mientras carga o falla.
  Si storage falla, la preferencia sólo dura en esa vista y se informa del límite.
- Respuestas ligadas a identidad/workspace/rol/MFA y número de petición. Cambio
  de contexto invalida la vista inmediatamente; respuestas tardías o posteriores
  a destruir el componente no sustituyen datos. Refrescar elimina el snapshot
  anterior y un error no conserva una falsa guía completada. No se añadió migración.
- Cinco casos preparados en `WorkspaceOnboardingTest`: vacío, aislamiento por
  ruta/cabecera, cambios de recursos/MFA, caducidad/autoridad/roles y acceso
  revocado/sin sesión. Sin ejecutar; guard `*_test` antes de fixtures destructivos.

## Validación pendiente

- Trece casos frontend preparados en `getting-started.component.spec.ts`: diez
  de componente (incluyendo plantilla, carga/omisión, storage, contexto y respuestas
  tardías) y tres de derivación de pasos. No ejecutados, ni tampoco los cinco PHP.
- Typecheck, build, integración Dashboard, ruta lazy, navegación atrás/adelante,
  cambios reales de sesión/roles/MFA, error/red lenta y reanudación entre visitas.
- Visual claro/oscuro, móvil/escritorio, teclado, foco tras cambios y lector de
  pantalla. No se ha renderizado ni abierto esta nueva pantalla en navegador.
- Comprobación manual de redirección con un enlace de prueba reutilizable y
  credenciales/base aisladas autorizadas; nada de consumir enlaces del usuario.
- La omisión no se sincroniza entre pestañas abiertas/dispositivos ni se purgan
  automáticamente claves de preferencias antiguas; no contienen progreso o emails.

## Semántica que la interfaz debe conservar

- Un clic almacenado sólo acredita que UVH admitió una redirección. Puede venir
  de otro visitante; no acredita prueba personal, llegada al destino ni E2E.
  Guiar a una comprobación manual sin abrir URLs ni consumir enlaces de un uso
  automáticamente. No marcar un clic en un botón de UI como prueba satisfactoria.
- Dominio añadido no equivale a DNS, TLS o activación correctos. La ruta existente
  de dominios sigue siendo quien muestra esas fases.
- Invitación vigente no equivale a correo recibido ni a invitación aceptada.
- Omitir la guía no completa recursos ni cambia seguridad. MFA sigue dependiendo
  del backend; la guía no puede fabricar códigos ni cambiar credenciales.

No se ejecutaron suites, typecheck/build, lint, migraciones, navegación de prueba,
tráfico de redirección, DNS/TLS o envíos. PRODUCT-001 tiene implementación completa
revisada estáticamente; PRODUCT-VALID-001 permanece abierto y no se acredita producción.
