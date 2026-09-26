# Pruebas E2E en navegador

La suite Playwright valida los recorridos críticos con Chromium, Angular,
Laravel y PostgreSQL reales. No simula la API: únicamente sustituye hCaptcha y
la entrega externa de correo por adaptadores locales deterministas. El backend
sigue verificando cada token antiabuso servidor a servidor.

## Aislamiento y seguridad

- Docker Compose crea `uvh_e2e_test` en un volumen efímero independiente.
- El arranque aborta antes de migrar si `DB_DATABASE` no termina en `_test`.
- `APP_ENV=testing`, claves y contraseñas son fixtures fijos sin valor fuera de
  esta pila.
- PostgreSQL y el stub de hCaptcha no publican puertos al host. Laravel sólo se
  publica en `127.0.0.1:8010` y Angular en `127.0.0.1:4201`.
- El lector de correo se niega a funcionar fuera de `testing` o sobre una base
  no terminada en `_test`; descifra como máximo 100 filas y sólo devuelve el
  enlace del destinatario y tipo solicitados.
- Tokens API, secretos TOTP y códigos de recuperación permanecen en memoria y
  nunca se escriben en logs, capturas ni comandos de shell.
- Los helpers que envejecen sesiones o papelera vuelven a comprobar
  `APP_ENV=testing` y el sufijo `_test`. El de papelera exige además workspace,
  prefijo sin comodines y cardinalidad exacta antes de modificar una sola fila.
- El teardown elimina contenedores, red y volúmenes incluso cuando falla una
  aserción. Si una ejecución se interrumpe de forma abrupta, `pree2e` limpia la
  pila exacta `uvh-e2e` antes de volver a empezar.

No apuntes esta suite a `uvh_local`, a una base compartida ni a infraestructura
real.

## Ejecución

Requisitos: Docker Desktop operativo, Node.js 22 y las dependencias bloqueadas
del frontend.

```powershell
Set-Location frontend
npm ci
npm run e2e:install
npm run e2e
```

Para aislar un recorrido durante la depuración:

```powershell
npm run e2e -- --grep "token mínimo"
```

### Una `PORT` heredada rompe el arranque

Angular CLI respeta la variable `PORT` del entorno y **antepone** su valor a
`--port`. Con `PORT` definida, `ng serve --port 4201` escucha en ese otro puerto
—uno aleatorio si vale `0`— y anuncia «Environment variable PORT detected. Using
port …»; Playwright, que espera en `4201`, agota su timeout sin ninguna pista de
la causa real. Ocurrió en una corrida real: un shell que exportaba `PORT=0`
convirtió un arranque correcto en un fallo de webServer.

Arranca con el entorno limpio:

```powershell
Remove-Item Env:PORT -ErrorAction SilentlyContinue   # PowerShell
```

```bash
env -u PORT npm run e2e                             # bash/Git Bash
```

Lo mismo vale para `npm run e2e:async`, que también pasa el entorno a la pila
contenedora.

Los fallos conservan captura, vídeo y trace bajo `frontend/test-results`; esos
artefactos están ignorados por Git. CI los adjunta durante siete días sólo si
el job falla.

## Cobertura actual: 27 recorridos

La ejecución conjunta más reciente terminó con 27/27 en 27,6 minutos el 7 de
septiembre de 2026, usando un único worker. El teardown eliminó la base, los
contenedores, la red y los volúmenes efímeros.

1. Registro, verificación por email e inicio de sesión.
2. Bloqueo de sesión para una cuenta no verificada.
3. Registro duplicado sin enumeración de cuentas.
4. Redirección de una ruta privada al login.
5. Recuperación de contraseña y revocación de la contraseña anterior.
6. Rechazo de un enlace de verificación ya consumido.
7. Logout y rechazo posterior de rutas privadas.
8. Configuración pública de hCaptcha sin secretos.
9. Recuperación de email desconocido con respuesta genérica.
10. Creación de workspace y ciclo crear/pausar/editar/eliminar/restaurar enlace.
11. Cambio de email, cierre de sesiones y traslado del acceso.
12. Alta MFA por TOTP y consumo único de un código de recuperación.
13. Exportación con step-up: solicitud, descarga con step-up, acuse que consume
    y cancelación con retirada del artefacto.
14. Creación, uso y revocación efectiva de un token Bearer de alcance mínimo.
15. Invitación y aceptación por el destinatario verificado con rol `viewer`.
16. Uso y límites con roles reales `owner`, `admin`, `editor` y `viewer`.
17. Centro de seguridad minimizado y revocación de la sesión actual.
18. Purga irreversible con contraseña, TOTP y doble confirmación.
19. Uso con teclado, reflow móvil y Axe WCAG A/AA.
20. Revocación independiente de una sesión remota desde otro navegador.
21. Reautenticación administrativa de una sesión MFA envejecida.
22. Carrera multiproceso de clic/restore con contador exacto.
23. Carrera multiproceso de restore/purge con un único ganador.
24. Carrera entre restore y housekeeping sobre papelera envejecida.
25. Primeros pasos aislado por cuenta/workspace, omisión/reanudación y cambio real
    de `viewer` a `editor`, con teclado, móvil y Axe.
26. Actividad con `owner`/`admin` autorizados, ausencia de petición para
    `editor`/`viewer` y respuesta minimizada, con teclado, móvil y Axe.
27. Estado público sin feed: HTTP 503 y estado desconocido tras carga/actualización,
    con navegación por teclado, reflow móvil y Axe.

## Pila asíncrona y continuidad

Por encima de la suite de navegador hay dos puertas que no miran pantallas:

- `npm run e2e:async` levanta la topología real de colas —un worker por clase
  (`mail`, `webhooks`, `domains`, `exports`, `analytics`, `default`) más el
  scheduler— contra proveedores deterministas (SMTP, receptor de webhooks y
  resolutor DNS propios) y sigue cada cadena hasta su estado final: registro →
  outbox → worker → aceptación SMTP → enlace utilizable; evento → entrega → 500
  → reintento programado por el scheduler → 200 → cuerpo firmado y entregado;
  302 → evento de clic → rollup; exportación → artefacto cifrado → descarga →
  consumo y retirada; dominio → TXT y CNAME controlados → transición de estado.
  El fallo del proveedor y su reintento se comprueban de verdad: el primer
  intento se rechaza a propósito y el segundo debe conservar el mismo
  `event_id` y superar la verificación HMAC de la firma.

  La pila corre sobre **Redis** (`CACHE_STORE=redis`, `QUEUE_CONNECTION=redis`),
  el mismo broker que producción, así que las cadenas no se acreditan en un store
  que el despliegue ya no usa. Además de las cinco cadenas, cubre dos propiedades
  que sólo existen con un broker separado: pausar el worker y comprobar que la
  profundidad **ve** el trabajo pendiente (con la lectura de la tabla `jobs`
  habría publicado un cero), y perder el contenido del broker
  (`broker-flush`) comprobando que la fila de `mail_outbox` sigue siendo la
  verdad y que el reconciliador de housekeeping la republica hasta la entrega.
  El ensayo de rollups analíticos (`analyticsContentionDrill`) es la parte de esa
  suite que mide en vez de comprobar. Cada pase fija un volumen y varía una sola
  cosa —una fila o varias, un worker o cuatro, `fillfactor` 100 o 70—, compara la
  mediana de drenaje entre pases intercalados y asevera en todos ellos que cada
  clic aparece exactamente una vez en `click_events`, en el rollup diario y en el
  contador visible. Tiene dos orígenes de carga: **arrival** (clics admitidos por
  el redirect público) y **flood** (jobs encolados directamente sobre un enlace),
  porque en una pila local el propio redirect es más lento que el worker y el
  backlog nunca llega a formarse. Knobs:
  `UVH_ASYNC_ANALYTICS_{ROUNDS,REQUESTS,CONCURRENCY,FLOOD,LINKS,LOW_WORKERS,HIGH_WORKERS,FILLFACTOR,SAMPLE_MS}`.
  `UVH_ASYNC_DRILL_ONLY=1` levanta la pila y corre sólo el ensayo, para iterar
  sobre el volumen sin pagar el resto de la suite (CI nunca lo fija). Los números
  de la corrida de referencia y lo que el ensayo **no** acredita están en
  [`analytics-rollup-capacity.md`](analytics-rollup-capacity.md).
  Dentro de la misma suite corren tres **ensayos de caída y recuperación**, que
  son los que ejercitan procedimientos y no caminos felices: se mata al worker de
  exportaciones a mitad de un export de tamaño máximo y se comprueba que la
  reejecución publica un único artefacto —y que una solicitud abandonada termina
  terminal sin huérfanos—; se para el planificador y se comprueba que el reintento
  retenido no se mueve hasta que vuelve y que entonces llega exactamente una vez;
  y se pone al proveedor de correo en rechazo para recorrer el agotamiento del
  outbox, el reintento administrativo (`202`, y `409` cuando ya no procede), la
  compensación que cancela la invitación atada y la retención que purga lo
  terminal sin tocar el trabajo abierto. `UVH_ASYNC_ONLY=export,scheduler,outbox`
  ejecuta sólo esos ensayos (o `=1` para los tres), para iterar sobre ellos sin
  pagar el resto de la suite; CI nunca lo fija y corre todo.
  El arnés está partido por concern, no por tamaño, y la entrada es fina:
  `frontend/e2e/async-stack.mjs` sólo decide qué escenarios corren, los conduce
  en orden y publica el veredicto. `e2e/async/topology.mjs` es el dueño de la
  pila (compose, puertos, endpoints de los proveedores y el único `docker()`);
  `expect.mjs` es el dueño del veredicto (`check`, `until` y la lista de
  resultados, una sola para todo el run); `session.mjs` convierte el arnés en
  usuario; `fixtures.mjs` lee lo que el proveedor recibió, que es lo que permite
  afirmar recepción y no sólo aceptación del transporte; `chains.mjs` son los
  caminos felices; `analytics-contention.mjs` es la parte que mide; y `drills/`
  tiene un fichero por escenario de caída —`export-crash.mjs`,
  `scheduler-recovery.mjs` y `outbox-outage.mjs`— más `support.mjs` con las
  palancas y diagnósticos que comparten. Del otro lado,
  `backend-laravel/tests/E2E/async-inspect.php` es el registro: bootstrap, guarda
  de entorno y contrato de salida (un JSON por subcomando, código 64 si el
  nombre no existe o la propia validación lo rechaza), con los subcomandos
  repartidos por entidad en `tests/E2E/inspect/` (`infrastructure`, `mail`,
  `webhooks`, `analytics`, `exports`, `domains`, `accounts`), cada fichero
  devolviendo su mapa de nombre a manejador. Añadir un ensayo son dos sitios:
  un módulo en `drills/` y, sólo si necesita una palanca nueva, el subcomando en
  el módulo de su entidad. Los símbolos que cada módulo ofrece son exactamente
  los que otros importan: el resto no se exporta, de modo que la superficie de
  cada fichero dice qué promete y qué guarda para sí.

  Una política se declara una vez y se lee donde se aplica. El techo operativo
  del export automático vive en `AccountExportDocument::maxPlaintextBytes()`
  (`EXPORT_MAX_PLAINTEXT_BYTES`, sobre el texto plano ya codificado), y ni el
  semillero del ensayo ni sus aserciones lo repiten: el inspector lo lee de la
  capa que lo aplica y lo publica como `cap_bytes`, así que el volumen sembrado
  y la banda «cerca del tope» se calculan contra el techo real. Lo
  mismo con la forma de una fila: cada módulo del inspector tiene un único
  descriptor (`$describe`) que usan todos sus lectores, de modo que añadir un
  campo no puede dejar a un lector publicando menos que otro —el ensayo lee eso
  como una diferencia del producto—. Cuando
  el semillero lo llevaba escrito a mano, el ensayo se saboteaba —sembraba más
  bytes de los que el job acepta y medía su negativa—.
- `npm run e2e:backup` destruye una base a propósito, restaura la copia cifrada
  en una instancia aislada, compara la huella del contenido, rechaza una copia
  manipulada y mide el RPO/RTO logrados. Detalles en `backup-and-restore.md`.

La suite de navegador **no consume la cola**: cualquier trabajo que encola una
petición se queda sin procesar allí, de modo que seguiría en verde con todos los
workers parados. Esa laguna es la que cubren estas dos puertas.

## Qué no acredita

La suite no convierte el proyecto en listo para producción. Siguen requiriendo
evidencia separada el navegador y dispositivo reales adicionales, accesibilidad
manual, DNS/TLS, proxy y cookies de producción, correo y webhooks externos,
concurrencia multiproceso fuera de las carreras y cadenas ya cubiertas, el
cableado de backups, alertas y observabilidad al entorno real (gestor de
secretos, almacenamiento independiente, servicio de guardia) y la revisión
legal. Consulta
`production-readiness.md` para el inventario completo.
