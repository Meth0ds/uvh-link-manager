# Presupuestos de correo de invitaciones

Implementación del 5 de septiembre de 2026. Revisión estática únicamente;
migración, ensayos de concurrencia y calibración operativa pendientes.

## Política inicial

Se cuenta una **admisión de sobre**, no cada intento del proveedor. Crear y
reenviar reservan juntos todas estas dimensiones, después de autorizar bajo
lock y comprobar conflictos/capacidad. El destinatario de reenvío procede de la
fila bloqueada; se ignora cualquier `email` alternativo del cuerpo.

| Dimensión compartida | Máximo inicial | Ventana | Configuración |
|---|---:|---|---|
| Cuenta emisora, todos sus workspaces | 100 | 24 horas | `INVITATION_MAIL_ACTOR_DAY` |
| Workspace, todos sus emisores | 200 | 24 horas | `INVITATION_MAIL_WORKSPACE_DAY` |
| Destinatario, toda la aplicación | 5 | 24 horas | `INVITATION_MAIL_RECIPIENT_DAY` |
| IP, todas las cuentas | 200 | 24 horas | `INVITATION_MAIL_IP_DAY` |
| Toda la aplicación, sólo invitaciones | 2000 | 24 horas | `INVITATION_MAIL_GLOBAL_DAY` |
| Destinatario, crear y reenviar | 1 | 60 segundos | Fijo en configuración |

Las ventanas empiezan en la primera admisión tras el vencimiento, no a medianoche
ni como ventana deslizante: cerca de un límite temporal caben admisiones a ambos
lados. Los valores diarios deben ser enteros entre 1 y 1.000.000; un valor inválido
falla cerrado, no desactiva el control. Calibrarlos antes de producción, teniendo
en cuenta NAT compartido, destinatarios invitados a varios equipos y el coste de
agotamiento deliberado del presupuesto global. No es una garantía de abuso cero.

Continúan independientes los 20 intentos/15 minutos por cuenta/workspace y las
100 invitaciones pendientes vigentes. Los intentos rechazados sí consumen el
throttle de petición, pero no el presupuesto SQL de correo. Los reintentos del
worker no reservan otra vez: son la entrega del mismo sobre. No se reembolsa una
admisión ya confirmada si luego caduca, se cancela o falla el proveedor.

## Atomicidad y privacidad

`InvitationMailBudget` usa `invitation_mail_budgets`: clave HMAC con separación
por propósito, contador y vencimiento epoch. No almacena email, IP ni bearer en
claro. Son identificadores seudónimos, no datos declarados anónimos. IP textual
equivalente/IPv4 mapeada se normaliza; IP ausente comparte un grupo conservador.
La IP efectiva depende de configurar correctamente los proxies de confianza.

La inserción inicial y los bloqueos siguen orden global por clave. Se consulta
el reloj PostgreSQL después de adquirirlos y sólo se incrementa si caben todas
las dimensiones. Un rechazo lanza excepción hasta fuera de la transacción:
revierte filas de contador recién sembradas, normalización de caducidad, bearer
y outbox. Un fallo de admisión del correo también revierte las reservas.
No se contacta al proveedor bajo estos locks. El contador global serializa las
admisiones: medir espera y latencia con carga real antes del despliegue.

`429` incluye `Retry-After` con la mayor espera de las dimensiones agotadas, sin
revelar cuál ni el destinatario. No reserva capacidad futura: otra petición puede
consumirla antes del reintento. `503` conserva la invitación anterior cuando no
se puede comprobar el presupuesto; una tabla ausente no permite enviar sin límite.

## Despliegue y rotación

1. Aplicar, sólo en un entorno autorizado, la migración
   `2026_09_05_000032_create_invitation_mail_budgets.php` antes de activar el código.
   **No se ha aplicado a `uvh_local` en esta revisión.**
   `php artisan uvh:release-check` comprueba, sin aplicar migraciones, el registro,
   las migraciones empaquetadas pendientes, las tres columnas del presupuesto y
   la validez de sus límites. El entrypoint de producción lo exige antes de
   PHP-FPM y los comandos directos de queue/scheduler usados por Compose. El job
   `migrate` queda exento para permitir inicializar una base vacía. Los healthchecks
   de contenedor repiten la comprobación después del arranque. No certifica todos
   los índices/tipos/constraints, compatibilidad de rollback ni readiness HTTP;
   wrappers personalizados deben invocar el gate explícitamente. No probado en contenedor.
2. Coordinar valores y versión en todos los emisores. Un proceso antiguo que
   no reserve presupuesto queda fuera del control; retirarlo antes de acreditar
   la garantía. La tabla vacía comienza a contar desde despliegue, sin reconstruir
   correos históricos.
3. Durante rotación se comprueban e incrementan contadores de todas las claves
   del keyring. Mantener las anteriores al menos 24 horas desde retirar el último
   escritor que sólo conocía la clave antigua, además del drenaje de ciphertext.
   Retirarlas antes puede conceder cuota nueva a identidades no vistas durante
   el solapamiento. El límite general de 31 días del keyring continúa vigente.
4. Para rollback, retirar primero el código dependiente; no truncar contadores
   ni eliminar la tabla como respuesta a un `429`. Eso reinicia las protecciones.

Housekeeping retira hasta 500 filas por ejecución, sólo si llevan más de 24 horas
vencidas. Bloquea con `SKIP LOCKED` y vuelve a comprobar vencimiento al borrar;
no resetea una reserva concurrente. Es limpieza de contadores inactivos, no purga
de invitaciones ni una política jurídica de retención del historial. No se ejecutó.

## Observación y validación pendiente

- `invitation.budget_rejected`: admisiones denegadas; contrastar tendencia con
  necesidades legítimas y presión de correo antes de cambiar valores.
- `invitation.budget_unavailable`: revisar migración, conexión, locks y valores
  configurados. Conectar una alerta externa; aún no está conectada.
- `housekeeping.stage_failed`: comprobar la fase `invitation_budget_retention`.

`InvitationMailBudgetTest` prepara trece casos: seis dimensiones, destinatario
real del reenvío/cuentas distintas, fallos SQL y outbox, emisor sin autoridad,
configuración inválida, rotación y expiración/purga. No ejecutados. El `TestCase` compartido limpia esta
tabla sin FK sólo después de validar nombre `*_test`; exige esquema completo.

`UvhReleaseCheckTest` prepara ocho casos de esquema completo, ledger pendiente,
registro/tabla/columna ausentes, configuración inválida y fallo de inspección;
incluye ahora la atribución de auditoría 000033 de PRODUCT-002.
Comprueba que heartbeats recientes no oculten el fallo y que el comando no
repare el esquema ni reserve cuota. Sin ejecutar; los cambios de fixture de
PostgreSQL usan rollback y el guard `*_test` del padre.

Faltan carreras multiproceso (última plaza, primera fila, purga y cambio de
keyring), fallo después del commit, retirada del último escritor antiguo,
proveedor real, calibración de límites y alertas. No se acredita producción.
