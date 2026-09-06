# UVH — análisis de 100 defectos candidatos y huecos de validación

Fecha: 5 de septiembre de 2026.

## Resultado y límites

Se revisaron de forma estática los flujos de autenticación, Ajustes, administración,
diálogo de enlaces, rutas Laravel, exportación privada, migraciones y gates de
producción. El objetivo de 100 puntos revisables se alcanzó, pero **no hay 100 bugs
confirmados**: inflar el número reduciría la utilidad del informe.

La clasificación usada es:

- **C (confirmado por control de flujo):** el comportamiento defectuoso se deduce
  directamente del código. Falta aún una reproducción E2E cuando interviene el
  navegador o la red.
- **P (probable):** existe una carrera, contrato débil o invariante ausente con una
  secuencia concreta que puede fallar; requiere una prueba dirigida antes de
  corregir.
- **V (validación):** no es un bug demostrado. Es un gate que puede ocultar fallos
  de producción y no debe convertirse en una afirmación de vulnerabilidad.
- **D (descartado al revalidar):** candidato inicial contradicho por el flujo
  completo o por un requisito explícito de la interfaz. Se conserva para que el
  recuento sea auditable, pero no debe corregirse como bug.

Resumen revalidado: **70 C**, **3 P**, **16 V** y **11 D**. No se ejecutaron migraciones ni pruebas
contra `uvh_local`. El análisis inicial fue estático; los lotes de corrección
posteriores se validan de forma separada y no reutilizan como nuevos los BAF ya
cerrados. La prioridad `P1` indica riesgo de sesión, operación
sensible o integridad; `P2`, fallo funcional relevante; `P3`, robustez/UX.

## Estado de corrección

- **BUG-001–020 y BUG-024–029:** corregidos el 5 de septiembre. Se añadieron
  generación monotónica de sesión, última carga de workspaces gana, aislamiento
  de 401/403 y cabecera tenant, errores útiles en Ajustes, separación entre
  mutación confirmada y refresco, fallback manual de MFA y rollback de navegación.
- **BUG-070–073:** confirmados y corregidos con peticiones correlacionadas por
  generación, página y tamaño, además de descarte al destruir la vista. Las
  cuatro intercalaciones ya tienen regresión directa.
- **BUG-036, BUG-038–041 y BUG-043–046:** corregidos en el diálogo de enlaces:
  submit no accidental, fechas y reglas validadas con el contrato servidor,
  límites de UTM/tags/reglas, deduplicado de tags, alias no disponible bloqueado
  y resultados asíncronos descartados al destruir la vista.
- **BUG-087:** brecha de prueba cerrada con cinco regresiones directas del diálogo.
- **BUG-047–051:** corregidos en la pantalla de acceso con revisiones separadas
  para hCaptcha, login/MFA/recovery y registro/reenvío; ningún resultado obsoleto
  cambia el paso ni navega y el login interactivo navega una sola vez.
- **BUG-052–055:** endurecidos en invitaciones con identidad de bearer, generación
  de sesión y ciclo de vida. BUG-054–055 quedan confirmados; BUG-052–053 siguen
  como probables al no haberse reproducido aún una reutilización normal de ruta
  con otro bearer. Además se corrigió el loading perpetuo si `auth.init()` falla.
- **BUG-056–067:** los flujos públicos de recuperación, bearers y confirmaciones
  descartan finalizaciones de vistas destruidas. Las respuestas que limpian la
  cookie reconcilian `AuthService` sólo para la generación que las inició;
  BUG-056–065 y 067 quedan confirmados, mientras BUG-066 permanece probable
  endurecido porque la plantilla ya serializaba inicialización y submit.
- **BUG-068–069:** confirmados y corregidos. La denuncia pública mantiene la
  configuración hCaptcha más reciente y no altera una vista destruida; el
  diálogo de workspace tampoco puede cerrarse ni publicar un resultado tardío.
  Se preservaron y ampliaron todas las pruebas históricas de ambos componentes.
- **BUG-074–082:** confirmados y corregidos en la consola administrativa. Cada
  listado y snapshot conserva su propia revisión y parámetros capturados; las
  respuestas antiguas o posteriores a destroy no cambian datos, error ni loading.
  Las recargas completas sólo finalizan la revisión vigente y las acciones sobre
  filas quedan deshabilitadas durante la recarga de su listado.
- **BUG-083:** confirmado y corregido. `ApiService` transforma fallos de contrato
  runtime en un error 502 controlado sin adjuntar cuerpo ni detalle del decoder.
  El inventario completo de respuestas JSON consumidas queda cubierto antes de
  publicar estado o navegar: identidad/cuenta, credenciales, intenciones,
  workspaces/Equipo, enlaces/reglas/analítica/actividad, dominios, administración,
  privacidad, onboarding, configuración pública y confirmaciones públicas. Las
  páginas quedan ligadas a los parámetros capturados; URLs, IDs, enums, límites,
  secretos de una sola visualización y proyecciones minimizadas se reconstruyen
  explícitamente. La actividad de workspace conserva su lector runtime manual y
  las respuestas cuyo cuerpo se ignora no alimentan estado. Diecisiete regresiones
  nuevas desde 214 casos cubren este cierre transversal.
- **BUG-084:** confirmado y corregido. Presupuesto y 12 secciones del export se
  leen en una única transacción PostgreSQL `REPEATABLE READ READ ONLY`; JSON,
  cifrado, filesystem y outbox se ejecutan después de cerrarla. La prueba dirigida
  y la suite backend completa pasaron exclusivamente en `uvh_test`.
- Validación actual del lote: typecheck y build correctos; **148/148** pruebas
  del lote de enlaces, **155/155** tras autenticación y **160/160** tras
  invitaciones, **174/174** tras los flujos bearer, **177/177** tras denuncia y
  diálogo de workspace, **188/188** tras administración, **194/194** tras el
  borde HTTP de identidad, **197/197** al completar Ajustes, **202/202** al
  completar los contratos sensibles de `AuthService` y **209/209** tras
  credenciales e intenciones, **214/214** tras Equipo/workspaces y **231/231** al
  cerrar todos los consumidores de BUG-083, incluidas 106 regresiones nuevas
  desde la base de 125 casos.
- **BUG-021–023, BUG-030–035, BUG-037 y BUG-042:** descartados al revisar el flujo completo;
  las cargas ya capturaban sus errores y el borrado de regla vacía es conducta
  explícita; el backend de enlaces sólo exige contraseña no vacía y máximo 72,
  no el mínimo supuesto por BUG-042. Permanecen documentados abajo como D para
  no ocultar la rectificación.

## Hallazgos 001–038: defectos demostrables por control de flujo

| ID | Prio. | Evidencia | Defecto y efecto | Corrección recomendada |
|---|---:|---|---|---|
| BUG-001 · C | P2 | `frontend/src/app/core/services/auth.service.ts:66-81` | `initPromise` nunca vuelve a `undefined`. Un fallo transitorio deja `loaded=true` y bloquea cualquier reintento real hasta recargar la página. | Limpiar la promesa en `finally` y separar “carga terminada” de “carga válida”. |
| BUG-002 · C | P1 | `auth.service.ts:68-79,168-184` | Una respuesta tardía de `init()` puede escribir usuario/workspaces después de `logout()` o invalidación local. | Generación monotónica de autenticación y comprobación antes de cada escritura. |
| BUG-003 · C | P1 | `auth.service.ts:84-91` | Un `refreshWorkspaces()` antiguo que falla borra el listado escrito por una petición posterior correcta. | Última petición gana; no vaciar estado desde una generación obsoleta. |
| BUG-004 · C | P2 | `auth.service.ts:84-91` | Una respuesta antigua correcta puede reemplazar los workspaces de la cuenta o sesión más reciente. | Ligar petición a usuario/security-version y generación. |
| BUG-005 · C | P1 | `auth.service.ts:93-108` | Dos login solapados: el fallo del intento viejo ejecuta `clearLocalAuth()` y cierra el login nuevo ya correcto. | Serializar login o descartar la finalización antigua. |
| BUG-006 · C | P1 | `auth.service.ts:93-108` | Dos login solapados: el éxito antiguo puede sobrescribir la identidad del intento más nuevo. | Token de intento ligado a email/sesión y última petición gana. |
| BUG-007 · C | P1 | `auth.service.ts:111-116` | `verifyMfa()` puede repoblar la identidad después de logout, revocación o cambio de cuenta. | Validar generación/challenge activo antes de escribir. |
| BUG-008 · C | P1 | `auth.service.ts:118-123` | `recoverMfa()` tiene la misma resurrección tardía de identidad. | Invalidar operaciones MFA al cambiar el estado de autenticación. |
| BUG-009 · C | P1 | `auth.service.ts:202-211` | `me()/refreshUser()` puede restaurar usuario tras una invalidación local ocurrida durante el GET. | Capturar y comparar generación de sesión. |
| BUG-010 · C | P1 | `auth.service.ts:237-241` | `updateProfile()` tardío puede escribir datos de la cuenta anterior sobre la nueva sesión. | Correlacionar mutación con usuario/security-version. |
| BUG-011 · C | P1 | `auth.service.ts:251-259` | La respuesta tardía de solicitud de email puede repoblar o contaminar otra sesión. | Aplicar resultado sólo si continúa la misma identidad. |
| BUG-012 · C | P1 | `auth.service.ts:261-268` | La cancelación tardía de email presenta el mismo cruce entre sesiones. | Guardia de identidad/generación. |
| BUG-013 · C | P1 | `frontend/src/app/core/interceptors/api.interceptor.ts:20-27` | Cualquier 401, incluso de una petición pública o antigua, invalida la sesión actual. Un 401 del login anterior puede cerrar un login nuevo. | Invalidar sólo endpoints autenticados y sólo para la generación que originó la petición. |
| BUG-014 · C | P2 | `api.interceptor.ts:28-34` | Cualquier 403 con ese cuerpo activa reautenticación admin aunque la petición sea antigua o ya no pertenezca al contexto admin. | Correlacionar con sesión, ruta y petición vigente. |
| BUG-015 · C | P3 | `api.interceptor.ts:12-18` | Se envía `X-Workspace-Id` también a autenticación y endpoints públicos si existe selección local; contamina contratos, caché y diagnóstico. | Añadir la cabecera sólo a rutas tenant-aware. |
| BUG-016 · C | P2 | `frontend/src/app/panel/settings/settings.component.ts:186-191` | `toast()` muestra el texto `ok` para errores inesperados; casi todos los callers pasan `""`, generando un snackbar vacío y ocultando la causa. | Usar un fallback de error no vacío y separar éxito/error. |
| BUG-017 · C | P1 | `settings.component.ts:289-300` | Si cambiar contraseña triunfa pero `refreshUser()` o sesiones falla, la UI anuncia error de la operación ya aplicada e invita a repetirla. | Separar commit remoto de refresco; éxito confirmado + aviso de refresco. |
| BUG-018 · C | P2 | `settings.component.ts:343-355` | Una exportación solicitada con éxito se presenta como fallida si falla el refresco de usuario. | No envolver refresco posterior en el mismo resultado transaccional de UI. |
| BUG-019 · C | P2 | `settings.component.ts:369-376` | Cancelar exportación puede completarse en servidor y mostrarse como fallo si falla `loadExportStatus()`. | Confirmar cancelación y refrescar de forma independiente. |
| BUG-020 · C | P1 | `settings.component.ts:415-428` | Solicitar eliminación puede quedar creada aunque la UI muestre fallo por un refresco posterior; repetir es especialmente confuso. | Tratar la mutación como irreversible/idempotente y comunicar su resultado antes del refresh. |
| BUG-021 · D | — | `settings.component.ts:473-483` | Descartado: `loadPrivacyRequests()` ya captura internamente el fallo; la mutación correcta no entra en el catch exterior. | Mantener prueba de mutación correcta + refresco fallido. |
| BUG-022 · D | — | `settings.component.ts:498-509` | Descartado por el mismo control de flujo que BUG-021. | Mantener prueba dirigida. |
| BUG-023 · D | — | `settings.component.ts:521-529` | Descartado por el mismo control de flujo que BUG-021. | Mantener prueba dirigida. |
| BUG-024 · C | P1 | `settings.component.ts:577-586` | El servidor puede crear/rotar el secreto MFA y luego fallar sólo `QRCode.toDataURL`; la UI atribuye el fallo a la operación completa y permite repetirla. | Separar setup remoto de render QR; conservar secreto/URI y ofrecer modo manual. |
| BUG-025 · C | P1 | `settings.component.ts:598-609` | MFA puede quedar activado y los recovery codes recibidos, pero un fallo de `refreshUser()` lo presenta como fracaso. | Mostrar y proteger los códigos inmediatamente; refresco secundario. |
| BUG-026 · C | P1 | `settings.component.ts:615-642` | MFA puede quedar desactivado aunque el refresco posterior muestre un error genérico. | Confirmar el nuevo estado antes del refresh y reconciliar en segundo plano. |
| BUG-027 · C | P1 | `settings.component.ts:709-723` | Los códigos anteriores pueden quedar invalidados y los nuevos recibidos aunque un refresh posterior anuncie fracaso. | Nunca mezclar rotación confirmada con refrescos auxiliares. |
| BUG-028 · C | P2 | `settings.component.ts:545-548` | Se cambia el workspace global antes de navegar; si el router cancela/falla, el usuario permanece en Ajustes con otro contexto seleccionado. | Navegar primero o revertir selección cuando `navigate()` devuelve `false`. |
| BUG-029 · C | P2 | `settings.component.ts:550-560` | Revocar la sesión actual puede triunfar y el fallo/cancelación de navegación se comunica como revocación fallida. | Separar revocación y navegación; forzar shell anónimo tras éxito. |
| BUG-030 · D | — | `frontend/src/app/panel/admin/admin.component.ts:269-285` | Descartado: los loaders de `Promise.all` capturan sus propios errores y no rechazan la mutación exterior. | Conservar prueba de regresión al endurecer Admin. |
| BUG-031 · D | — | `admin.component.ts:345-364` | Descartado por el mismo control de flujo que BUG-030. | Conservar prueba dirigida. |
| BUG-032 · D | — | `admin.component.ts:370-389` | Descartado por el mismo control de flujo que BUG-030. | Conservar prueba dirigida. |
| BUG-033 · D | — | `admin.component.ts:581-599` | Descartado: `loadMailOutbox()` absorbe el fallo; no escapa del handler ni convierte un POST correcto en fracaso. | Conservar prueba dirigida. |
| BUG-034 · D | — | `admin.component.ts:706-714` | Descartado: los refresh administrativos capturan sus errores. | Conservar prueba dirigida. |
| BUG-035 · D | — | `admin.component.ts:740-753` | Descartado: la moderación confirma éxito antes de loaders que no rechazan. | Conservar prueba dirigida. |
| BUG-036 · C | P3 | `frontend/src/app/panel/links/link-dialog.component.html:102` | El botón de quitar etiqueta está dentro del formulario y no declara `type="button"`; el tipo HTML predeterminado es submit. | Añadir `type="button"` y una prueba DOM. |
| BUG-037 · D | — | `frontend/src/app/panel/links/link-dialog.component.html:118` | Descartado: la interfaz indica expresamente “Deja el destino vacío para borrar la regla”; la omisión es intencional. | No convertir el destino en obligatorio sin cambiar antes el requisito de producto. |
| BUG-038 · C | P2 | `link-dialog.component.ts:65-69,118-119,321-322` | Una fecha no parseable se transforma en `null`; al editar puede borrar silenciosamente una fecha válida del servidor. | Validador de fecha y bloqueo del submit ante valor inválido. |

## Hallazgos 039–084: carreras y contratos probables que requieren prueba dirigida

| ID | Prio. | Evidencia | Secuencia de fallo candidata | Prueba/corrección recomendada |
|---|---:|---|---|---|
| BUG-039 · C | P2 | `link-dialog.component.ts:118-119` | Confirmado: no había validador cliente que exigiera `scheduledAt < expiresAt`; el usuario sólo recibía un 422 tardío. | Corregido con validador cruzado y prueba de igualdad/inversión. |
| BUG-040 · C | P3 | `link-dialog.component.ts:121-127` | Confirmado contra `LinkService::validate`: UTM no tenía límite cliente de 100 ni control de caracteres. | Corregido con los límites del backend. |
| BUG-041 · C | P2 | `link-dialog.component.ts:257-271` | Confirmado contra `normalizeRule`: los campos de reglas carecían de longitudes, rangos y formatos equivalentes. | Corregido por fila; una fila con destino vacío sigue representando borrado. |
| BUG-042 · D | — | `link-dialog.component.ts:114`; `LinkController.php:495-498` | Descartado: la contraseña de enlace admite cualquier valor no vacío hasta 72 bytes; no existe el mínimo supuesto por el candidato. | No imponer una política distinta sólo en el cliente. |
| BUG-043 · C | P3 | `link-dialog.component.ts:239-255`; `LinkService.php:411-438` | Confirmado: la UI deduplicaba con mayúsculas sensibles, mientras el servidor resuelve identidad mediante `lower(name)`. | Corregido con deduplicado case-insensitive y límite de 20. |
| BUG-044 · C | P2 | `link-dialog.component.ts:132-135,197-236` | Confirmado: las subscripciones y el debounce sobrevivían al cierre y podían emitir un POST posterior. | Corregido con `takeUntilDestroyed`, invalidación y prueba con reloj. |
| BUG-045 · C | P2 | `link-dialog.component.ts:138-172` | Confirmado: dominios o reglas tardíos escribían señales después de cerrar el diálogo. | Corregido con `DestroyRef` antes de cada escritura. |
| BUG-046 · C | P2 | `link-dialog.component.ts:301-347` | Confirmado: guardar podía completar y cerrar/actualizar un diálogo ya abandonado. | Corregido con identidad de guardado y descarte tras destroy. |
| BUG-047 · C | P2 | `frontend/src/app/auth/auth.component.ts:211-239,568-579` | Confirmado: una carga tardía de hCaptcha podía sobrescribir un reintento nuevo o mutar una pantalla abandonada. | Corregido con revisión propia, `DestroyRef` y prueba de resolución inversa. |
| BUG-048 · C | P1 | `auth.component.ts:283-308` | Confirmado: login navegaba sin comprobar que sobrevivieran la vista y el destino capturado; además el effect podía duplicar la navegación. | Corregido con revisión, destino capturado, guardia de destroy y navegación interactiva única. |
| BUG-049 · C | P1 | `auth.component.ts:326-341` | Confirmado: una verificación MFA tardía podía navegar después de abandonar o sustituir el desafío. | Corregido ligando revisión, paso y challenge. |
| BUG-050 · C | P1 | `auth.component.ts:350-365` | Confirmado: recovery presentaba el mismo salto de ruta con una finalización obsoleta. | Corregido y probado de forma independiente a MFA. |
| BUG-051 · C | P2 | `auth.component.ts:374-456` | Confirmado: registro, cambio de email y reenvío actualizaban pasos/mensajes sin identidad de flujo. | Corregido con contexto capturado, revisiones separadas e invalidación al cambiar de paso. |
| BUG-052 · P | P2 | `frontend/src/app/auth/invitation-accept.component.ts:64-84,134+` | Candidato endurecido: `initialize()` podía reemplazar estado si el servicio cambiaba de bearer; falta reproducir una ruta normal que lo provoque. | Ya ligado a bearer/componente; conservar prueba y validar route reuse E2E. |
| BUG-053 · P | P2 | `invitation-accept.component.ts:73-84` | Candidato endurecido: rechazo tardío podía escribir tras navegación/cambio de token; la ruta concreta de cambio de token sigue sin reproducir. | Ya comprueba bearer, generación y ciclo de vida. |
| BUG-054 · C | P1 | `invitation-accept.component.ts:92-100` | Confirmado: “Cambiar cuenta” completaba logout y navegaba sin comprobar que el componente siguiera vivo. | Corregido con petición vigente; prueba destruye la vista durante logout. |
| BUG-055 · C | P1 | `invitation-accept.component.ts:111-125` | Confirmado: aceptación tardía podía limpiar bearer/refrescar otro contexto tras cambio de sesión; el refresco `false` tampoco mostraba su aviso. | Corregido con bearer + generación + petición vigente y resultado de refresco explícito. |
| BUG-056 · C | P2 | `frontend/src/app/auth/forgot-password.component.ts:56-100` | Confirmado: configuración/reintento hCaptcha y submit carecían de generación/destroy; una respuesta vieja podía pisar la nueva. | Corregido con revisiones independientes y pruebas diferidas. |
| BUG-057 · C | P2 | `frontend/src/app/auth/reset-password.component.ts:93-105` | Confirmado: un reset tardío escribía éxito sobre una vista destruida. | Corregido ligando token y ciclo de vida. |
| BUG-058 · C | P2 | `frontend/src/app/auth/account-recovery-request.component.ts:98-138` | Confirmado: configuración hCaptcha y solicitud podían terminar fuera del flujo que las originó. | Corregido con revisiones independientes y `DestroyRef`. |
| BUG-059 · C | P1 | `frontend/src/app/auth/account-recovery-confirm.component.ts:50-65` | Confirmado: la confirmación tardía actualizaba una ruta abandonada. | Corregido con bearer y petición vigente. |
| BUG-060 · C | P1 | `frontend/src/app/auth/account-recovery-complete.component.ts:100-125` | Confirmado: completar recuperación podía limpiar credenciales visuales después de destruir la pantalla. | Corregido; el commit remoto permanece terminal y la UI exige vista vigente. |
| BUG-061 · C | P2 | `frontend/src/app/auth/verify-email.component.ts:63-88` | Confirmado: una verificación tardía presentaba el resultado tras abandonar la ruta. | Corregido con identidad de bearer y ciclo de vida. |
| BUG-062 · C | P1 | `frontend/src/app/auth/confirm-email-change.component.ts:51-68` | Confirmado: el `accountSignedOut()` tardío podía borrar una generación de login posterior. | Corregido con generación esperada y guardia visual independiente. |
| BUG-063 · C | P2 | `frontend/src/app/auth/confirm-data-export.component.ts:49-65` | Confirmado: la confirmación de export modificaba una vista destruida. | Corregido con petición bearer vigente. |
| BUG-064 · C | P1 | `frontend/src/app/auth/confirm-account-deletion.component.ts:45-62` | Confirmado: tras el commit destructivo, la UI y el signout local no distinguían vista destruida de generación nueva. | Corregido: commit remoto se reconcilia por generación; UI sólo si sigue vigente. |
| BUG-065 · C | P1 | `frontend/src/app/auth/cancel-account-deletion.component.ts:42-58` | Confirmado: cancelación tardía podía presentar éxito sobre una ruta abandonada. | Corregido con bearer y ciclo de vida. |
| BUG-066 · P | P1 | `frontend/src/app/auth/mfa-reauthenticate.component.ts:84-130` | Candidato endurecido: no se reprodujo competencia normal porque el formulario espera a `initialize()`; sí faltaba guardia de destroy. | Añadida navegación terminal única y descarte de inicialización/submit obsoletos; conservar E2E. |
| BUG-067 · C | P1 | `frontend/src/app/auth/security-incident.component.ts:60-76` | Confirmado: revocación tardía podía ejecutar `accountSignedOut()` sobre una sesión posterior. | Corregido con generación esperada; UI ligada a bearer y vista. |
| BUG-068 · C | P2 | `frontend/src/app/legal/report.component.ts:101-155` | Confirmado: configuración hCaptcha y denuncia podían escribir tras destruir o ser sobrescritas por un reintento antiguo. | Corregido con peticiones separadas, última configuración vigente y guardia de destrucción. |
| BUG-069 · C | P2 | `frontend/src/app/panel/workspace-dialog.component.ts:74+` | Confirmado: el alta/edición de workspace podía cerrar un diálogo ya abandonado y propagar un resultado tardío. | Corregido con petición vigente, contexto capturado y resultado descartado al destruir. |
| BUG-070 · C | P2 | `settings.component.ts:318-334` | Confirmado: dos cargas de sesiones permitían que la antigua sustituyera datos y apagara el loading de la vigente. | Corregido con petición y generación de sesión vigentes; regresión directa. |
| BUG-071 · C | P2 | `settings.component.ts:337-351` | Confirmado: dos cargas de exportación podían retroceder estado `ready` a `processing/null`. | Corregido con última petición gana y generación de sesión; regresión directa. |
| BUG-072 · C | P2 | `settings.component.ts:407-421` | Confirmado: dos consultas de impacto podían mostrar workspaces o bloqueos obsoletos antes de eliminar. | Corregido con petición/generación vigentes; regresión directa. |
| BUG-073 · C | P2 | `settings.component.ts:460-483` | Confirmado: paginación RGPD rápida permitía reemplazar página, total y loading con una respuesta antigua. | Corregido correlacionando generación, página y tamaño; regresión directa. |
| BUG-074 · C | P2 | `admin.component.ts:223-251` | Confirmado: búsqueda/filtro/página de recuperaciones sin correlación permitía que una respuesta antigua ganase. | Corregido con revisión independiente y parámetros capturados. |
| BUG-075 · C | P2 | `admin.component.ts:329-357`; `admin.component.html:113-116` | Confirmado: usuarios sufría la misma carrera y mantenía acciones utilizables sobre filas en recarga. | Corregido con petición vigente y acciones deshabilitadas mientras carga. |
| BUG-076 · C | P2 | `admin.component.ts:431-459` | Confirmado: denuncias podían volver a una página o filtro anterior. | Corregido con última petición vigente y contexto capturado. |
| BUG-077 · C | P2 | `admin.component.ts:519-547` | Confirmado: dominios admin podían mostrar estado anterior tras una respuesta tardía. | Corregido con guardia por listado y destroy. |
| BUG-078 · C | P2 | `admin.component.ts:567-593` | Confirmado: auditoría paginada podía mezclar consulta, página y total obsoletos. | Corregido correlacionando consulta, página y tamaño. |
| BUG-079 · C | P2 | `admin.component.ts:622-646` | Confirmado: outbox podía retroceder visualmente por una respuesta antigua. | Corregido con filtro/página capturados y última petición gana. |
| BUG-080 · C | P2 | `admin.component.ts:702-731` | Confirmado: expedientes RGPD admin podían mostrar estado o página anterior. | Corregido con revisión propia de listado y contexto completo. |
| BUG-081 · C | P2 | `admin.component.ts:316-327,600-620` | Confirmado: overview y operaciones aceptaban snapshots antiguos. | Corregido con revisión independiente para cada snapshot. |
| BUG-082 · C | P3 | `admin.component.ts:206-221` | Confirmado: dos `reloadAll()` solapados permitían que el primero pusiera `refreshing=false` antes de tiempo. | Corregido: sólo la recarga completa vigente finaliza los indicadores. |
| BUG-083 · C | P2 | `frontend/src/app/core/services/api.service.ts`; `*-response-decoders.ts`; consumidores en `auth`, `landing`, `legal` y `panel` | Confirmado y corregido: los genéricos TypeScript no validaban JSON en runtime. Todo cuerpo JSON consumido se decodifica ahora antes de llegar a estado o navegación; actividad de workspace usa su lector manual equivalente. | Mantener el inventario y exigir decoder al añadir un nuevo cuerpo consumido. 36 pruebas específicas y suite completa 231/231. |
| BUG-084 · C | P1 | `backend-laravel/app/Jobs/GenerateDataExportJob.php:228-237,274-421` | Confirmado: presupuesto y secciones se consultaban fuera de un snapshot común, permitiendo una copia internamente incoherente bajo escrituras concurrentes. | Corregido con snapshot `REPEATABLE READ READ ONLY` limitado a las consultas; 250 pruebas backend/2078 aserciones en `uvh_test`. |

## Hallazgos 085–100: gates que pueden ocultar bugs (no son bugs confirmados)

| ID | Prio. | Evidencia | Riesgo no validado | Evidencia necesaria para cerrarlo |
|---|---:|---|---|---|
| BUG-085 · V | P2 | `frontend/src/app/core/services/auth.service.ts` | Brecha parcialmente cerrada: ya existe spec directa con ocho casos de generación/reintento; no sustituye todas las intercalaciones E2E de BUG-002–014. | Mantener los deferred unitarios y completar navegación/401 reales en BUG-099. |
| BUG-086 · V | P2 | `frontend/src/app/panel/settings/settings.component.ts` | Brecha parcialmente cerrada: ya existen cinco pruebas directas de última respuesta, mutación confirmada y rollback de navegación. | Completar destrucción y E2E de operaciones irreversibles en BUG-099. |
| BUG-087 · V | P2 | `frontend/src/app/panel/links/link-dialog.component.ts` | Brecha cerrada el 5 de septiembre: antes el diálogo no tenía spec directa para submit, fechas, reglas y cierre durante requests. | Cinco pruebas directas añadidas; E2E visual sigue pendiente en BUG-100. |
| BUG-088 · V | P2 | `docs/todos.md:56-61` | El presupuesto de invitaciones está en código pero 000032 sigue pendiente en el entorno local/de despliegue. | Migración en copia representativa + release-check + concurrencia multiproceso. |
| BUG-089 · V | P2 | `docs/progress-checkpoint-2026-09-04.md` | El último snapshot documenta 000032–000034 pendientes en `uvh_local`; no se aplicaron por seguridad. | Despliegue autorizado en copia/entorno objetivo, nunca inferido desde tests. |
| BUG-090 · V | P1 | `docs/production-readiness.md:7-18` | No se ha acreditado build/test/migración con las imágenes exactas y checkout limpio del release. | Evidencia reproducible ligada a digest/commit. |
| BUG-091 · V | P1 | `docs/production-readiness.md:9-16` | Rollback compatible con migraciones no está ensayado. | Restauración/rollback cronometrado sobre copia representativa. |
| BUG-092 · V | P1 | `docs/production-readiness.md:10-13` | Invariantes `APP_ENV`, debug y release-check no están demostradas en la imagen final. | Arranques positivos y negativos de PHP-FPM/queue/scheduler. |
| BUG-093 · V | P1 | `docs/production-readiness.md:24-29` | TLS, cookies, HSTS, CSP, Trusted Types y hCaptcha no están verificados en dominios reales. | Capturas/cabeceras/consola desde navegador contra producción candidata. |
| BUG-094 · V | P1 | `docs/production-readiness.md:25-27` | Aislamiento de backend/DB y `TRUSTED_PROXIES` no están acreditados. | Escaneo externo y prueba de spoofing de forwarding. |
| BUG-095 · V | P1 | `docs/production-readiness.md:27` | Secretos reales todavía no están demostrados en un gestor externo ni fuera de imagen/repositorio. | Inventario, permisos mínimos y ceremonia de rotación. |
| BUG-096 · V | P1 | `docs/production-readiness.md:33-37` | TLS PostgreSQL, retención y comportamiento con volumen representativo permanecen abiertos. | `verify-full`, CA comprobada y ensayo de carga/migración. |
| BUG-097 · V | P1 | `docs/production-readiness.md:34-35` | Backup cifrado y restauración real no están demostrados; un backup no restaurado no es evidencia de recuperación. | Restore aislado con RPO/RTO medidos. |
| BUG-098 · V | P1 | `docs/production-readiness.md:43-50` | Caída de worker/scheduler, cola envejecida, jobs fallidos y outbox no tienen alerta externa ensayada. | Fault injection y recepción real de alertas/runbook. |
| BUG-099 · V | P1 | `docs/production-readiness.md:58-71,101-114` | Falta la matriz E2E real de identidad, MFA, permisos/IDOR, dominios, webhooks, export y eliminación. | E2E aislado con dos usuarios/workspaces, proveedor de correo y hCaptcha reales. |
| BUG-100 · V | P2 | `docs/production-readiness.md:122-126` | No se ha cerrado revisión visual, móvil, teclado, foco, contraste, lector de pantalla ni estados de red/error. | Matriz manual/automatizada con evidencias por navegador y viewport. |

## Orden de depuración propuesto

1. **Bloque A — sesión y autenticación:** BUG-002–014. Introducir una generación
   monotónica central en `AuthService` y propagarla al interceptor. Son los únicos
   hallazgos capaces de mezclar identidades o cerrar una sesión nueva.
2. **Bloque B — mutaciones sensibles:** BUG-017–035. Separar “write confirmado” de
   “refresh fallido” antes de permitir cualquier reintento.
3. **Bloque C — peticiones de pantalla:** BUG-044–082. Aplicar un helper uniforme
   de `DestroyRef` + última petición gana, empezando por admin y Ajustes.
4. **Bloque D — formularios/contratos:** BUG-036–043 y BUG-083; añadir validación
   compartida y decodificación runtime sin relajar las validaciones servidor.
5. **Bloque E — export y producción:** BUG-084 ya conserva un snapshot común y
   pasó en `uvh_test`; cerrar BUG-088–100 sólo en entornos aislados/autorizados.

## Criterio de cierre por lote

Cada corrección debe incluir reproducción previa, prueba de regresión, typecheck,
build y suite frontend o backend correspondiente. Las pruebas backend deben usar
exclusivamente una base `*_test`; no aplicar migraciones pendientes a `uvh_local`
sin autorización. Un gate V sólo se marca cerrado con evidencia del entorno real,
no por la mera existencia de código o de un test unitario.
