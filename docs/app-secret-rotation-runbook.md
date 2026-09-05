# Runbook de rotación de `APP_SECRET`

Estado del documento: procedimiento preparado, todavía no ensayado en un
despliegue real. Una rotación no debe ejecutarse por primera vez en producción.

`APP_SECRET` protege dos familias distintas de datos:

- cifra en reposo secretos TOTP, secretos de webhook, sobres del outbox,
  mensajes de privacidad y artefactos de exportación;
- firma tokens breves de desbloqueo de enlaces y deriva pseudónimos operativos.

La aplicación escribe siempre con el `APP_SECRET` actual. Durante una rotación,
`APP_SECRET_PREVIOUS` forma un keyring de sólo lectura —máximo tres claves— para
que datos y tokens anteriores sigan siendo verificables. El gate de producción
exige `APP_SECRET_ROTATION_UNTIL` en el futuro y no permite una ventana superior
a 31 días.

## Invariantes que no se pueden romper

1. `app`, `queue`, `scheduler` y cualquier proceso `migrate` deben recibir el
   mismo par de claves durante toda la fase de solapamiento.
2. No puede quedar un proceso antiguo escribiendo con la clave anterior cuando
   se considere terminado el recifrado. En un despliegue gradual, todos los
   writers deben soportar primero el keyring nuevo/anterior.
3. Las claves se almacenan en el gestor de secretos o en archivos protegidos;
   nunca se escriben en argumentos, logs, tickets, capturas ni este repositorio.
4. No se retira la clave anterior sólo porque el comando informe cero filas:
   también deben drenarse jobs antiguos y vencer los tokens firmados previos.
5. Debe existir un backup cifrado con restauración ensayada y un responsable
   capaz de abortar la operación. El propio comando no sustituye ese gate.

## Inventario cubierto por el recifrado

`php artisan uvh:crypto:rotate` mantiene una lista explícita y recorre:

| Recurso | Campo o artefacto |
|---|---|
| Usuarios | `mfa_secret`, `mfa_pending_secret` |
| Webhooks | `secret` |
| Correo | `mail_outbox.encrypted_envelope` |
| Privacidad | `privacy_rights_messages.encrypted_body` |
| Exportaciones | archivo privado señalado por `artifact_path` |

El comando procesa lotes pequeños, bloquea y relee cada fila, omite valores que
ya usan la clave actual y puede reanudarse. Los exports se sustituyen desde un
archivo temporal en el mismo volumen mientras la solicitud está bloqueada.

Si se añade otro uso de `UvhCrypto::encryptAtRest`, hay que incorporarlo a este
inventario, al comando y a sus pruebas antes del siguiente despliegue.

## Preparación

- Abrir una ventana de cambio y detener despliegues/migraciones concurrentes.
- Confirmar que backup y restauración recientes están acreditados.
- Revisar trabajos pendientes/fallidos, outbox, exports activos y salud de
  `app`, worker y scheduler sin imprimir payloads.
- Generar una clave Base64URL independiente de al menos 32 bytes en un entorno
  seguro. Guardarla como la nueva clave actual en el gestor de secretos.
- Conservar la clave vigente como secreto anterior separado.
- Fijar `APP_SECRET_ROTATION_UNTIL` con margen suficiente para el ensayo, el
  drenaje y un rollback, pero siempre dentro de los próximos 31 días.

En Compose, `UVH_APP_SECRET_FILE` debe apuntar al archivo de la clave nueva y
`UVH_APP_SECRET_PREVIOUS_FILE` al archivo que contiene la anterior. El overlay
temporal es `docker-compose.rotation.yml`.

## Fase de solapamiento

Primero validar la configuración renderizada sin mostrar sus valores:

```powershell
docker compose -f docker-compose.production.yml -f docker-compose.rotation.yml config --quiet
```

Después recrear conjuntamente todos los procesos PHP con ambos secretos. La
forma concreta de evitar pérdida de servicio depende del balanceador; este
comando provoca sustitución de contenedores y no acredita alta disponibilidad:

```powershell
docker compose -f docker-compose.production.yml -f docker-compose.rotation.yml up -d --no-deps --force-recreate app queue scheduler
```

Comprobar health/heartbeats y un flujo controlado de MFA, firma de webhook y
lectura de privacidad/export antes de recifrar. Si un proceso no arranca, no se
continúa ni se retira ninguna clave.

## Preflight y recifrado

El dry-run descifra cada valor y cuenta los que todavía no usan la clave actual;
no modifica base de datos ni archivos:

```powershell
docker compose -f docker-compose.production.yml -f docker-compose.rotation.yml --profile tools run --rm migrate php artisan uvh:crypto:rotate --dry-run
```

Si el preflight termina correctamente, ejecutar la operación reanudable:

```powershell
docker compose -f docker-compose.production.yml -f docker-compose.rotation.yml --profile tools run --rm migrate php artisan uvh:crypto:rotate
```

Repetir el dry-run. Todos los contadores de ciphertext/artefactos pendientes
deben ser cero. Un error obliga a conservar el keyring, corregir el recurso
afectado y reanudar; no se debe “arreglar” borrando el dato.

## Drenaje antes de retirar la clave anterior

- Mantener el solapamiento al menos 24 horas desde la retirada del último
  proceso que sólo conocía la clave anterior: los presupuestos HMAC de correo
  de invitaciones conservan ventanas de 24 horas. Durante el solapamiento se
  reservan todas las generaciones. Esto también cubre los diez minutos del
  token de desbloqueo; véase `invitation-mail-budget-runbook.md`.
- Confirmar que no quedan jobs creados antes del cambio. Los jobs heredados
  `SendUvhMailJob` pueden contener un sobre cifrado en su payload y no los
  recifra el comando; deben terminar o tratarse explícitamente sin volcar el
  payload a consola.
- Comprobar que outbox, webhooks y exports no presentan filas atascadas y que
  los contadores de descifrado/MFA no muestran fallos.
- Ejecutar de nuevo el dry-run después del drenaje para detectar cualquier
  escritura tardía realizada por un writer antiguo.

## Rollback durante el solapamiento

Mientras ambas claves se conservan, el rollback seguro consiste en volver a
poner la clave anterior como `APP_SECRET` y la nueva como
`APP_SECRET_PREVIOUS`, fijar un deadline válido y recrear **todos** los procesos
PHP. Así los datos ya recifrados con la clave nueva siguen siendo legibles.

Después del rollback se ejecuta `uvh:crypto:rotate --dry-run` y, si procede, el
recifrado inverso. No se restaura una base antigua sobre almacenamiento actual
sin coordinar también los artefactos privados y las dos versiones de clave.

## Retirada y evidencia de cierre

Sólo después de preflight cero, drenaje y validación funcional:

1. retirar `APP_SECRET_PREVIOUS` y vaciar `APP_SECRET_ROTATION_UNTIL`;
2. desplegar sin `docker-compose.rotation.yml` y recrear juntos `app`, `queue`
   y `scheduler`;
3. confirmar health, heartbeats, login/MFA controlado, webhook firmado, outbox
   y acceso a un export de prueba;
4. revocar la clave anterior en el gestor de secretos según su política;
5. registrar responsable, fechas, versión desplegada, contadores del dry-run,
   validaciones y decisión de cierre, pero nunca los valores de las claves.

La rotación sólo se considera probada cuando este procedimiento haya pasado en
una copia aislada, se haya interrumpido y reanudado deliberadamente, y se haya
ensayado el rollback en ambos sentidos.
