# Reputación de destinos y moderación de URLs

Estado: **implementado y cubierto por pruebas; sin proveedor real configurado.**
Este documento describe el contrato, la operación y —explícitamente— lo que
todavía no está acreditado. No cierra por sí solo el requisito de abrir el
servicio al público.

## Por qué esto existe

Para un acortador abierto, el riesgo no es sólo un compromiso técnico. También
es que `uvh.es` acabe en listas de bloqueo:

```
phishing · malware · spam · fraude → navegadores/antivirus/buzones bloquean el dominio
```

Esa cadena es difícil de revertir y afecta a todos los inquilinos a la vez. Por
eso hay dos capas **independientes**, y la importante es la primera:

1. **Denylist local** — determinista, síncrona, sin red. Es una decisión ya
   tomada (por una persona o por un proveedor) y se aplica en el único punto por
   el que pasa toda escritura de enlaces, incluida la superficie de tokens de
   API. Un destino denegado no se acorta.
2. **Proveedor de reputación (opcional)** — asíncrono, nunca decide una
   escritura. Sólo puede mover el estado de un enlace que ya existe, y **sólo**
   bloquear cuando el despliegue ha activado expresamente el bloqueo automático.

Ninguna de las dos se ejecuta en la ruta de redirección. Un enlace bloqueado se
rechaza exactamente igual que uno que bloqueó un moderador: `RedirectService` no
consulta nada nuevo por clic.

## Contrato del proveedor

```
POST <REPUTATION_PROVIDER_URL>
{ "url": "<destino>" }                      # la URL exacta del enlace, en claro
→ 200 { "verdict": "safe" | "suspicious" | "malicious",
        "score": 0..100,                    # opcional
        "expiresAt": "<ISO-8601>" }         # opcional
```

Reglas de la respuesta:

- El cuerpo se lee con **cota dura** (`REPUTATION_MAX_BODY_BYTES`): al superarla
  la conexión se corta y el resultado se trata como fallo.
- Un `expiresAt` **nunca alarga** el TTL de configuración: un proveedor
  comprometido no puede congelar un veredicto para siempre.
- Cualquier respuesta que no describa el contrato (no JSON, veredicto
  desconocido, error, timeout) se registra como `unknown`. **`unknown` nunca es
  `safe`.** Un veredicto `unknown` se reintenta en una ventana corta y no se
  cachea como si fuera una decisión.

El transporte es el mismo endurecido que el de los webhooks: se validan todas
las direcciones resueltas, se fijan en el momento de conectar, sin redirecciones
y con timeout duro. La URL del proveedor pasa por `ExternalEndpoint::isSafeHttps`
(HTTPS, puerto 443, host público, sin credenciales, sin fragmento, sin IP ni
sufijos locales), igual que el feed de estado.

## Configuración

```dotenv
# Opcional. Sin URL, la API publica la capacidad como no verificada.
REPUTATION_PROVIDER_URL=
REPUTATION_PROVIDER_TOKEN=
REPUTATION_TIMEOUT_SECONDS=5
REPUTATION_MAX_BODY_BYTES=65536
REPUTATION_CACHE_TTL_HOURS=24
REPUTATION_RECHECK_BATCH=50
# Desactivado por defecto: un veredicto no puede bloquear sin pedirlo aquí.
REPUTATION_AUTO_BLOCK=false
REPUTATION_DOMAIN_MONITOR=true
```

| Variable | Efecto |
|---|---|
| `REPUTATION_PROVIDER_URL` | Endpoint del proveedor. Vacío = adaptador nulo. |
| `REPUTATION_PROVIDER_TOKEN` | Se envía como `Authorization: Bearer`. Se rota como cualquier credencial. |
| `REPUTATION_TIMEOUT_SECONDS` | Timeout duro, también de conexión. Un proveedor lento no bloquea a nadie indefinidamente. |
| `REPUTATION_MAX_BODY_BYTES` | Cota del cuerpo de respuesta. |
| `REPUTATION_CACHE_TTL_HOURS` | Techo de validez de un veredicto (el proveedor puede acortarlo, nunca alargarlo). |
| `REPUTATION_RECHECK_BATCH` | Enlaces reanalizados por ciclo del scheduler (barrido de fondo acotado). |
| `REPUTATION_AUTO_BLOCK` | **Interruptor principal.** Sólo con `true` un veredicto `malicious` bloquea. |
| `REPUTATION_DOMAIN_MONITOR` | Vigila la reputación de los hosts propios (`uvh.public_host`, `uvh.app_host`, dominios personalizados activos). |

## Qué bloquea y qué no

| Situación | Resultado |
|---|---|
| Destino en la denylist | Se **rechaza el alta** (y el destino *fallback*, y cualquier regla de redirección que apunte a él). |
| Enlace existente cuyo destino entra en la denylist | Se **bloquea** en segundo plano al crear la entrada; no espera a la siguiente pasada. |
| `malicious` con `REPUTATION_AUTO_BLOCK=true` | Se **bloquea** el enlace, con auditoría `system.link_block`. |
| `malicious` con `REPUTATION_AUTO_BLOCK=false` | **No** se bloquea. El veredicto queda registrado y visible. |
| `suspicious` | Se abre **un** caso de moderación (`abuse_reports.source='reputation'`), sin bajar el enlace. |
| `unknown` / proveedor caído / timeout | **No** pasa nada. Una consulta fallida no es evidencia sobre el destino. |
| Sin proveedor configurado | No hay veredicto posible; la API lo publica como `not_configured`. |

Un enlace bloqueado automáticamente es auditable (`system.link_block`,
`system.link_reputation_signal`) y **apelable**.

## Denylist: semántica de emparejamiento

- Tipos de entrada: `host` (cubre ese host y sus subdominios) y `url` (una URL
  exacta, en forma canónica).
- **Nunca por subcadena.** Una entrada para `evil.example` cubre `evil.example`
  y `pay.evil.example`, jamás `notevil.example`.
- Una entrada `url` se guarda como **hash SHA-256** de la forma canónica (el
  fragmento se descarta porque nunca llega a un servidor). La denylist no
  guarda objetivos de navegación en claro.
- Una entrada puede **caducar**. Una entrada caducada deja de bloquear y, si se
  vuelve a bloquear el mismo valor, se **revive la fila existente** en lugar de
  colisionar con el índice único.

## Operación

### Bloquear el destino de un enlace (lo que hace que la decisión prenda)

```http
POST /api/v1/admin/links/{id}/block-destination
{ "reason": "Phishing confirmado", "scope": "url" | "host" }
```

Bloquear sólo el enlace dejaba el abuso intacto: la misma URL volvía como otro
enlace minutos después y también era alcanzable por una regla de redirección.
Esta acción bloquea el **destino** y reanaliza en segundo plano todos los
enlaces que ya apuntaban a ese host.

### Gestionar la lista

```http
GET    /api/v1/admin/destinations              # paginado; los valores url son hashes
DELETE /api/v1/admin/destinations/{id}         # retirar una entrada
GET    /api/v1/admin/appeals?status=open       # cola de apelaciones
POST   /api/v1/admin/appeals/{id}/decision     # { "decision": "restore" | "uphold", "note": "…" }
```

### Apelación del propietario

```http
POST /api/v1/links/{id}/appeal                  # { "message": "…" } (opcional)
```

- Sólo un enlace **bloqueado** puede apelarse, y **una sola apelación abierta
  por enlace** (índice único parcial; la cola no es un buzón).
- Limitar por sesión e IP (`throttle:uvh-appeal`): es una acción humana sobre una
  decisión ya tomada.
- **Restaurar** devuelve el enlace a su estado natural **y retira las entradas
  de la denylist que aplicaban a sus destinos.** Sin eso, el siguiente
  reanálisis lo volvería a bloquear y la apelación sería teatro; una persona
  puede por tanto anular una entrada originada por un proveedor.

### Vigilancia del propio dominio

`REPUTATION_DOMAIN_MONITOR=true` consulta periódicamente los hosts propios. Si
el propio dominio aparece como `suspicious` o `malicious` en un proveedor, se
emite `reputation.domain_listed`. Es la señal con la que uno se enteraría de que
ya está en una lista **antes** de que llame un cliente.

### Métricas

| Serie | Significado |
|---|---|
| `uvh_event_reputation_blocked_60m_total` | Enlaces bloqueados por destino. |
| `uvh_event_reputation_moderated_60m_total` | Casos abiertos por una señal. |
| `uvh_event_reputation_appeal_opened_60m_total` | Apelaciones presentadas. |
| `uvh_event_reputation_check_failed_60m_total` | Comprobación agotada (reintentos). |
| `uvh_event_reputation_provider_unavailable_60m_total` | Proveedor irresoluble o con error. |
| `uvh_event_reputation_reanalysis_scheduled_60m_total` | Enlaces reencolados tras cambiar la denylist. |
| `uvh_event_reputation_domain_listed_60m_total` | Un host propio aparece mal valorado. |
| `uvh_denylist_entries` | Tamaño de la lista. |
| `uvh_appeals_open` | Apelaciones sin resolver. |
| `uvh_reputation_cases_open` | Casos de moderación abiertos por reputación. |

`uvh_appeals_open` y `uvh_reputation_cases_open` son las que convierten «lo
bloqueamos» en «y nadie lo está mirando». Deben alertar por crecimiento.

## Despliegue

- El proveedor se configura por secreto; la URL y el token **nunca** llegan al
  navegador.
- Los trabajos corren en el pool **`security`** (servicio `queue-security`),
  separado a propósito: una consulta a un tercero con timeout propio no debe
  retrasar correo, webhooks, analítica ni exportaciones. Al desplegar, arranca
  el nuevo pool junto con los demás.
- `GET /api/v1/status` publica `externalAnalysis` con tres hechos
  independientes —`configured` (¿hay URL?), `enabled` (¿hay adaptador?) y
  `operational` (¿ha respondido un veredicto utilizable recientemente?)— más
  `denylistEntries`. Un proveedor configurado y silencioso se publica como
  `not_verified`, nunca como cobertura.

## Activación y marcha atrás

1. Despliega con `REPUTATION_PROVIDER_URL` vacío. La denylist ya funciona; el
   bloqueo automático está apagado.
2. Configura URL y token. Comprueba `externalAnalysis.status` hasta
   `operational` y que `reputation_provider_unavailable` no crece.
3. Deja `REPUTATION_AUTO_BLOCK=false` y observa unos días: cuántos
   `suspicious`, cuántos casos abiertos, cuántos falsos positivos en la cola.
4. Activa `REPUTATION_AUTO_BLOCK=true` sólo cuando los umbrales estén
   acordados. **Marcha atrás inmediata:** vuelve a `false`; ninguna entrada
   creada por el proveedor se aplica ya por sí sola, y las que existan se
   retiran desde la consola (o aceptando una apelación).
5. `REPUTATION_PROVIDER_URL` vacío desactiva la capa entera sin tocar código.

## Evidencia

| Qué | Dónde |
|---|---|
| Emparejamiento por etiqueta (subdominios sí, parecidos no) y URL canónica hasheada | `backend-laravel/tests/Feature/DestinationReputationTest.php` |
| Caducidad y reactivación de una entrada | ídem |
| Fallback y reglas de redirección sujetos a la misma regla | ídem |
| `suspicious` abre un único caso; `malicious` sólo bloquea con auto-bloqueo | ídem |
| Estado honesto de la capacidad (`not_configured` / `not_verified` / `operational`) | ídem |
| Ciclo de apelación: una sola abierta, restaurar retira las entradas, no se decide dos veces | `backend-laravel/tests/Feature/LinkAppealTest.php` |
| Cuerpo acotado y timeout duro del transporte | `backend-laravel/tests/Feature/SsrfTest.php` |

## Lo que **no** está acreditado

- No se ha ejecutado ningún proveedor real: ni contrato, ni latencias, ni
  calidad de sus veredictos.
- No hay umbrales acordados ni datos de falsos positivos en producción.
- La monitorización del propio dominio no ha visto un dominio realmente
  listado.
- El despliegue de `queue-security` no se ha ejercido en un entorno autorizado.
- La evaluación de proveedores (coste, cobertura, retención de datos, encaje
  legal) sigue pendiente antes de abrir el servicio al público.
