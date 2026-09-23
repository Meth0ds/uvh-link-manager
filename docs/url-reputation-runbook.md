# Reputación de destinos y moderación de URLs

Estado: **implementado y cubierto por pruebas; sin proveedor real configurado.**
Este documento describe el contrato, la operación y —explícitamente— lo que
todavía no está acreditado. No cierra por sí solo el requisito de abrir el
servicio al público.

Las siete variables `REPUTATION_*`, con su obligatoriedad y su valor por
defecto, están en [`configuration.md` §15](configuration.md#15-reputación-de-destinos-y-moderación).

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
- El veredicto se lee **sin distinguir mayúsculas ni espacios** (`"MALICIOUS"`,
  `" Malicious "`), porque aceptarlo mal es el único fallo que apaga en silencio
  la retirada automática de abuso.
- Cualquier respuesta que no describa el contrato (no JSON, veredicto
  desconocido y en otra forma, error, timeout) se registra como `unknown`.
  **`unknown` nunca es `safe`.** Un veredicto `unknown` se reintenta en una
  ventana corta y no se cachea como si fuera una decisión. Si el veredicto vino
  ilegible se suma `reputation.verdict_unusable`: hubo respuesta, así que no es
  lo mismo que un proveedor caído.

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
REPUTATION_RELEASE_BATCH=50
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
| `REPUTATION_CACHE_TTL_HOURS` | Techo de validez de un veredicto (el proveedor puede acortarlo, nunca alargarlo, y nunca por debajo de 5 minutos). |
| `REPUTATION_RECHECK_BATCH` | Enlaces reanalizados por ciclo del scheduler (barrido de fondo acotado). |
| `REPUTATION_RELEASE_BATCH` | Enlaces autobloqueados re-evaluados por ciclo para retirar un bloqueo sin causa. Acotado por el mismo motivo, en la dirección contraria, y con el mismo cursor (`links.reputation_checked_at`): cada tanda deja atrás lo que examinó, así que un bloqueo detrás de muchos permanentes acaba alcanzándose en lugar de esperar a que los de delante cambien. |
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

### Un bloqueo automático es reversible; uno humano no

`state = blocked` no distingue quién lo decidió, así que el bloqueo automático
deja un **marcador** en el enlace (`reputation_blocked_at`,
`reputation_block_source`, `reputation_block_prior_state`) y sólo eso es lo que
la plataforma puede retirar por su cuenta:

| Situación | Resultado |
|---|---|
| Se retira la entrada que bloqueó el enlace | El enlace se **libera** (respuesta `releasedLinks`), siempre que ninguna otra entrada activa lo siga cubriendo. |
| Una entrada **caduca** (`expires_at` vencido) | El barrido de housekeeping (`destination_release`) lo detecta y libera: la caducidad no tiene ningún evento del que colgarse. |
| El veredicto del proveedor mejora, o se apaga `REPUTATION_AUTO_BLOCK` | El bloqueo originado por el proveedor se retira: su causa ya no existe. |
| El bloqueo lo puso un **moderador** | **Nunca** se libera solo. Un bloqueo manual no lleva marcador, y una decisión humana posterior en el mismo enlace borra el marcador si lo hubiera. |
| El enlace estaba **borrado** | Un bloqueo no resucita un enlace borrado, ni al liberarlo. |
| El enlace estaba `paused` o `scheduled` | Se le devuelve **ese** estado, no `active`. |

Sin esta pieza `expires_at` era, para los enlaces, un bloqueo **permanente**: la
entrada dejaba de emparejar, y nada volvía a analizar un enlace ya bloqueado.

## Denylist: semántica de emparejamiento

- Tipos de entrada: `host` (cubre ese host y sus subdominios) y `url` (una URL
  exacta, en forma canónica).
- **Nunca por subcadena.** Una entrada para `evil.example` cubre `evil.example`
  y `pay.evil.example`, jamás `notevil.example`.
- Una entrada `url` se guarda como **hash SHA-256** de la forma canónica (el
  fragmento se descarta porque nunca llega a un servidor). La denylist no
  guarda objetivos de navegación en claro.
- Una entrada puede **caducar**. Una entrada caducada deja de bloquear, **libera
  los enlaces que bloqueó** y, si se vuelve a bloquear el mismo valor, se
  **revive la fila existente** en lugar de colisionar con el índice único.
- La forma canónica es la que aplica el navegador antes de enviar: se resuelven
  los **segmentos de punto** (`/x/../blocked` → `/blocked`), se descarta el
  puerto por defecto, la query vacía y el fragmento, y se decodifican los
escapes de caracteres no reservados (`%7E` = `~`). Un escape **reservado** no se
decodifica nunca: `%2F` es un segmento y `/` son dos.
  Sin lo primero, una entrada para `/blocked` se rodeaba con `/x/../blocked`
  mientras el visitante acababa igualmente en `/blocked`.
- El recorrido de etiquetas **se detiene por encima del sufijo público**: una
  entrada para `evil.co.uk` cubre `pay.evil.co.uk`, pero `co.uk` o `github.io`
  **no se pueden añadir** como entrada de host (la consola responde `422`):
  bloquearlas apagaría todos los sitios alojados bajo ellas. La lista de sufijos
  es un subconjunto curado y versionado (`app/Support/PublicSuffixes.php`,
  `REVISED_AT`), es un guardarraíl y no un oráculo, y una página concreta de esas
  plataformas se sigue pudiendo bloquear con una entrada de tipo `url`.

- Toda entrada se guarda en su **forma canónica o no se guarda**. Un host se
  canonicaliza antes de escribirlo —minúsculas, sin el punto final, sin
  corchetes de IPv6, IDN a punycode, sin `:puerto`, y una URL pegada aporta su
  host— y una entrada `url` sólo acepta el hash de 64 hex que calcula el
  emparejador. Lo que no encaja se rechaza con `null` (la consola responde
  `422`): una fila que aparece en la lista y no puede casar con ningún destino
  es peor que un error, porque se lee como protección activa.

> **Nota de compatibilidad (2026-09-15).** La forma canónica cambió: segmentos
> de punto, escapes, puerto, query vacía. Las entradas de tipo `url` creadas
> **antes** de ese cambio guardan el hash de la forma anterior y no se pueden
> regenerar solas — la denylist no almacena la URL, sólo su hash — así que hay
> que volver a añadirlas desde la consola. Un despliegue que estrene esta
> funcionalidad no tiene ninguna; el caso afecta a un entorno que ya la tuviera
> en uso.

## Operación

### Bloquear el destino de un enlace (lo que hace que la decisión prenda)

```http
POST /api/v1/admin/links/{id}/block-destination
{ "reason": "Phishing confirmado", "scope": "url" | "host" }
```

Bloquear sólo el enlace dejaba el abuso intacto: la misma URL volvía como otro
enlace minutos después y también era alcanzable por una regla de redirección.
Esta acción bloquea el **destino** y reanaliza en segundo plano todos los
enlaces que ya apuntaban a ese host. La primera pasada está acotada por
`REPUTATION_REANALYSIS_BUDGET` para que la petición del operador no recorra una
tabla, y la respuesta trae `linksScheduled`, `linksSweepTruncated` y
`linksSweepCursor`.

Si `linksSweepTruncated` es `true`, **la propagación no queda a medias**: el
servicio encola `ContinueDestinationSweepJob` con el cursor y el job sigue desde
ahí hasta que el host no tenga enlaces, cada tanda acotada y con el mismo tope.
El cursor es la única pieza de estado entre tandas. Esto no depende de que haya
un proveedor de reputación configurado —la denylist es una decisión local— ni de
que el barrido del scheduler llegue algún día a esos enlaces.

Aun así, no des por propagado el bloqueo sin comprobarlo: si el bróker no está
accesible, `linksSweepTruncated` sigue siendo `true` y la continuación no se
encoló (se cuenta en `reputation.dispatch_failed`). Para el estado final:

```bash
docker compose -f docker-compose.production.yml exec app \
  php artisan tinker --execute="echo App\\Support\\DestinationReputationService::reanalyzeHost('host.example');"
```

Repetir esa llamada sin cursor es seguro: los enlaces ya bloqueados no se
duplican y el reanálisis converge a `scheduled: 0, truncated: false`.

### Gestionar la lista

```http
GET    /api/v1/admin/destinations              # paginado; los valores url son hashes
DELETE /api/v1/admin/destinations/{id}         # retirar una entrada
GET    /api/v1/admin/appeals?status=open       # cola de apelaciones
POST   /api/v1/admin/appeals/{id}/decision     # { "decision": "restore" | "uphold", "note": "…" }
```

Las dos tienen pantalla: el panel de administración resuelve las apelaciones en
*Moderación → Apelaciones* (filtro por estado, `restore` o `uphold` con nota) —y
el dueño ve el veredicto en el detalle de su enlace— y la lista de destinos se ve
y se retira en *Moderación → Destinos bloqueados*. Bloquear un destino se hace
desde el propio caso, en la tarjeta de la denuncia, con el alcance explícito
(`URL exacta` o `Todo el host`). Las llamadas HTTP de arriba siguen sirviendo
para automatizar.

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
| `uvh_event_reputation_reanalysis_truncated_60m_total` | El barrido llegó a `REPUTATION_REANALYSIS_BUDGET` y dejó candidatos para la continuación. Normalmente se resuelve solo (`ContinueDestinationSweepJob` sigue desde el cursor), y es donde se ve un host con muchísimos enlaces; **si no baja**, o sube `reputation.sweep_continuation_failed`, el bloqueo está aplicado a medias. |
| `uvh_event_reputation_sweep_continuation_failed_60m_total` | Una tanda de continuación de un bloqueo de destino falló. El siguiente barrido programado es la red de seguridad, pero hasta entonces quedan enlaces sirviendo. |
| `uvh_event_reputation_verdict_unusable_60m_total` | El proveedor contestó algo fuera de contrato (veredicto desconocido, otra forma). Sí hubo respuesta, así que no es `provider_unavailable`: es una integración que hay que revisar. |
| `uvh_event_reputation_released_60m_total` | Bloqueos automáticos retirados al desaparecer su causa. Un `blocked`+`released` que oscila es un proveedor con veredictos inestables, no un pico de abuso. |
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
| Liberación al retirar o caducar una entrada; moderador intacto; segunda entrada; enlace borrado nunca resucitado; estado previo devuelto; transición única | `backend-laravel/tests/Feature/DestinationReputationTest.php` |
| Retirada desde la consola con `releasedLinks`, y rechazo de un sufijo público | `backend-laravel/tests/Feature/LinkAppealTest.php` |
| Forma canónica (segmentos de punto, escapes, puerto, query vacía) y suelo de sufijo público | `backend-laravel/tests/Unit/DestinationDenylistCanonicalFormTest.php` |
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
- La lista de sufijos públicos es un subconjunto curado y **caduca**: no cubre
  todos los sufijos registrables del mundo, y su fecha de revisión
  (`PublicSuffixes::REVISED_AT`) es la única señal de que toca repasarla.
- No se ha probado ningún caso de sufijo público distinto de los del subconjunto
  que la suite fija por nombre.
- La evaluación de proveedores (coste, cobertura, retención de datos, encaje
  legal) sigue pendiente antes de abrir el servicio al público.
