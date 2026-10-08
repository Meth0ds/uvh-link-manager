# Pausa operativa de registros

Interruptor temporal para detener altas nuevas sin despliegue. Cubre
`POST /api/v1/auth/register`; verificación, reenvío y corrección de
pendientes existentes siguen intactos.

## Estado y superficies

| Pieza | Detalle |
|---|---|
| Flag | `operational_settings(key=registration_paused, value_bool)`; sin fila = abierto |
| Lectura | `RegistrationGate::isPaused()`, caché ~30 s (`OPERATIONAL_SETTINGS_CACHE_SECONDS`, clamp 5–300) |
| Escritura | `RegistrationGate::setPaused()` con `lockForUpdate`, auditoría `admin.registration_pause` en la misma transacción, invalidación de caché en commit y `afterCommit` |
| Bloqueo | `POST /register` responde `503 { error: «Registros temporalmente pausados. Inténtalo de nuevo más tarde.», code: «registration_paused» }`, idéntico para dirección libre u ocupada, tras validar forma y CAPTCHA y antes de crear intento, pending, correo o cookie |
| Público | `GET /api/v1/config` expone `registrationPaused` (bool, sin PII); el formulario anuncia «Registros temporalmente pausados…» y deshabilita el alta |
| Admin | `GET /overview` y `GET /operations` exponen `registrationPaused`; `POST /api/v1/admin/registration-pause { paused: boolean }` → `{ ok: true, paused }` (grupo `uvh.auth:admin + uvh.mfa:fresh + throttle:uvh-admin`) |
| Consola | Administración → Estado operativo → Registro de cuentas: badge Abiertos/Pausados + botón Pausar/Reanudar con confirmación |

## Operar la pausa

1. Abrir Administración → Estado operativo → Registro de cuentas.
2. Pulsar **Pausar** (o **Reanudar**), confirmar el diálogo y esperar el snackbar.
3. La vista recarga `operations`; el badge debe reflejar el nuevo estado.
4. Comprobar el formulario público: con pausa activa muestra el aviso y el
   alta queda deshabilitada.

La propagación a lecturas con caché puede tardar hasta el TTL vigente
(30 s por defecto).

## Respuestas del endpoint admin

| Caso | Respuesta |
|---|---|
| Éxito | `200 { ok: true, paused }` |
| `paused` no booleano / ausente | `422`, sin cambiar nada |
| Rol, cuenta o MFA cambió durante la operación | `409`, reautenticarse |
| Sin rol admin o MFA no reciente | `403` (`mfa_reauthentication_required` si caducó la ventana) |

## Verificación

- `GET /api/v1/config` → `registrationPaused` refleja el estado, sin auth.
- `POST /register` en pausa → `503` con `code: registration_paused`, sin
  `Set-Cookie` de edición y sin filas nuevas (intento/pending/correo).
- `POST /resend-verification`, `POST /verify-email` y
  `POST /change-registration-email` responden igual en pausa que en abierto.
- Auditoría: cada cambio deja un evento `admin.registration_pause` con
  `{ paused }`.
- Tests: `RegistrationGateTest`, `RegistrationPauseTest`,
  `RegistrationPauseEndpointsTest` (suite `uvh_test`, nunca `uvh_local`).

## Migración y configuración

- Migración `2026_10_08_000001_create_operational_settings.php`: crea la
  tabla y siembra `registration_paused=false`. Aplicar con
  `php artisan migrate`; verificar sólo en `uvh_test`.
- `OPERATIONAL_SETTINGS_CACHE_SECONDS` es interna con defecto funcional
  (`30`); no va en la plantilla de producción. Ajustarla sólo para acelerar
  o amortiguar la propagación del cambio.
