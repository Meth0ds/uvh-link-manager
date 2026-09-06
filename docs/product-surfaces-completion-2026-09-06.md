# Cierre de superficies de producto — 2026-09-06

## Alcance implementado

- `/app/usage`: consumo, cuotas reales, redacción por rol y retención declarada.
- `/app/domains/:id`: diagnóstico DNS/TLS, siguiente reintento y acciones por rol.
- `/app/webhooks/:id`: entregas paginadas, prueba/reenvío y payload allowlisted.
- `/app/security`: postura de cuenta, sesiones y actividad sensible minimizada.
- `/app/links/trash`: descubrimiento, restauración, purga reforzada y retención.
- `/help`: guías públicas versionadas de enlaces, dominios, API y firmas.
- `/status`: lectura fail-closed de un monitor externo, sin salud autodeclarada.

## Garantías de seguridad verificadas

- Autorización y tenant se vuelven a comprobar en backend; ocultar botones no es
  un control de acceso.
- La purga usa frase exacta, contraseña y MFA cuando está activo; su transacción
  respeta el orden cuenta → sesión → workspace → enlace.
- El inspector no devuelve payload persistido, firmas, secretos, URL resuelta,
  IP ni cuerpo remoto. La preview se reconstruye con allowlist cerrada.
- El centro de seguridad no devuelve metadata de auditoría ni IP y limita el
  catálogo y el número de eventos.
- El dominio elimina host y token de challenge para viewers y comparte la
  política de reintento con housekeeping.
- El estado público limita URL, redirects, tiempos, tamaño, JSON, campos, fechas
  e incidentes. Ante cualquier duda responde `unknown`, nunca `operational`.
- Angular valida contratos antes de publicar estado y correlaciona las respuestas
  tardías con workspace, rol y página donde corresponde.

## Evidencia ejecutada

- Backend Laravel completo: **271 pruebas, 2.204 aserciones**, verdes sólo con
  `DB_DATABASE=uvh_test`.
- Frontend Angular completo: **253/253 pruebas** verdes, incluidas las
  regresiones finales de dominio, papelera, seguridad y estado público.
- TypeScript `tsc --noEmit`: verde.
- Build Angular de producción: verde.
- Housekeeping conserva un enlace con 29 días y purga uno con 31 cuando la
  política es 30.

## Límites del cierre

Esto acredita implementación y validación automatizada, no despliegue real.
Siguen abiertos los `PRODUCT-VALID-*`: navegador autenticado y revisión visual/
accesible, DNS/TLS real, receptor webhook real con fault injection, concurrencia
multiproceso de papelera y monitor público independiente. `uvh_local` no se
migró ni se usó para pruebas.
