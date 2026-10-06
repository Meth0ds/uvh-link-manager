# UVH Control local

UVH Control gestiona **el entorno de desarrollo de este checkout**, no producción.
Su interfaz independiente está hecha con Angular 22 y Angular Material oficial:
identidad UVH marfil/oliva/terracota, Manrope e iconos locales, temas claro/oscuro/sistema,
vistas Resumen, Registros y Mantenimiento. No necesita que Angular de desarrollo esté
encendido y no carga recursos de Internet.

## Abrir el panel

Ejecutables generados (no versionados en Git):

- macOS ARM64: `dist/uvh-control-macos-arm64`
- Windows x64: `dist/uvh-control-windows-x64.exe`
- Linux x64: `dist/uvh-control-linux-x64`

Sin argumentos abren el panel en el navegador. Desde terminal:

```bash
./dist/uvh-control-macos-arm64
./dist/uvh-control-macos-arm64 serve --port 4580 --no-browser
# Alternativa desde fuentes, Node 22+ y panel compilado:
node scripts/uvh-control.mjs serve
```

Escucha exclusivamente en `127.0.0.1`, puerto predeterminado 4580. Un puerto ocupado
produce un error, no termina al propietario. El ejecutable debe estar dentro del
checkout, o usar `UVH_CONTROL_ROOT` con una raíz que contenga `docker-compose.local.yml`.
No hay daemon: si termina el controlador, la página avisa y reconecta cuando se vuelva
a abrir. Cerrar la pestaña **no equivale** a detener Docker ni Angular. El aviso de
cierre del navegador es best-effort, no un bloqueo garantizado.

**El panel embebe su runtime Node; no necesitas instalar Node para abrirlo.** Iniciar
el frontend del producto sí necesita Node en PATH y sus dependencias previamente
instaladas con `cd frontend && npm ci`. También hacen falta Docker/Compose y las
dependencias de Laravel preparadas. No se instalan herramientas silenciosamente.

## Uso y estados

- **Resumen:** Docker, Laravel, PostgreSQL, Angular, worker y scheduler; salud HTTP y
  latencia separadas del estado de proceso. Un worker en ejecución no demuestra que
  haya procesado un trabajo. Un HTTP 2xx de 3 s o más es **Lento**, no una caída.
- **Iniciar entorno:** crea el entorno desde la plantilla si falta, arranca Compose
  reutilizando imágenes e inicia un supervisor propio de Angular en `127.0.0.1:4200`.
- **Detener/Reiniciar:** pide confirmación y detiene exclusivamente el frontend propio
  y el Compose del checkout. Un reinicio nunca continúa tras una parada fallida.
- **Abrir aplicación:** abre `http://127.0.0.1:4200/` solo cuando la salud comprobada
  permite hacerlo. Backend `/health`: `http://127.0.0.1:8000/health`.
- **Registros:** backend (120 líneas por servicio) o frontend (100 por archivo), búsqueda
  en la ventana recibida y seguimiento cada 2 s después de terminar la consulta previa.
  El historial de operaciones es independiente y conserva como máximo las últimas 50.
- **Mantenimiento:** base de destino, migraciones aplicadas/pendientes y reparación IPC
  de Docker Desktop. Migrar puede modificar datos; conserva un backup si importan.
  La reparación solo aplica a Windows, requiere una terminal de administrador, cierra
  Docker/WSL y puede afectar otros proyectos. Archiva IPC, no elimina volúmenes/imágenes.
  El panel no solicita ni ejecuta elevación automática.

Las acciones mutadoras se bloquean inmediatamente, al desconectar, con datos
obsoletos o al desconocer el resultado de una operación. Un refresco programado o en
curso **no** invalida el diagnóstico: solo un fallo de lectura (o la pérdida del
controlador) lo marca como desactualizado, y una acción bloqueada siempre explica el
motivo en pantalla en lugar de no responder. No hay reintentos automáticos
mutadores. Una respuesta perdida se reconcilia mediante el identificador persistido;
**Consultar resultado** usa el mismo requestId si es necesario.

Plazos por operación: estado/logs 60 s, detener/reparar 180 s, iniciar/reiniciar
600 s, migrar 900 s. `serve` y logs `--follow` no tienen plazo global; cada consulta y
subproceso sí está acotado. No hay porcentajes de progreso ficticios.

## CLI

```bash
node scripts/uvh-control.mjs status
node scripts/uvh-control.mjs start
node scripts/uvh-control.mjs stop
node scripts/uvh-control.mjs restart
node scripts/uvh-control.mjs migrate             # confirmación interactiva
node scripts/uvh-control.mjs migrate --yes       # consentimiento explícito para automatización
node scripts/uvh-control.mjs repair-docker --yes # solo Windows elevado
node scripts/uvh-control.mjs logs backend --follow
node scripts/uvh-control.mjs logs frontend
node scripts/uvh-control.mjs --help
```

La herramienta no ofrece ejecución de tests, shell arbitrario ni acceso a producción.
Estado y lectura de logs no crean el archivo de entorno ni borran identidades ajenas.

## API local, schema 1

La API no es una API pública del producto ni admite CORS abierto. Todas las rutas
validan `Host` (`127.0.0.1:puerto`) y `Origin` cuando está presente, rechazando contextos
cruzados. Primero `GET /api/session` entrega `{ok:true,schema:1,token}`; el resto exige
`X-UVH-Session`. El token cambia al reiniciar el controlador y solo vive en memoria del
cliente, nunca en URLs, web storage ni informes.

- `GET /api/status`: `{ok:true,schema:1,checkedAt,text,docker,services,endpoints,migrations,capabilities,configured}`.
  Endpoints incluyen `status` (`ok|slow|error|unavailable`), `httpStatus` y `latencyMs`.
- `GET /api/state`: `{ok:true,schema:1,operation,recentOperations}`.
  Operaciones: `id`, `requestId`, `mode`, `status` (`running|succeeded|failed|timedOut|unknown`),
  `phase`, `startedAt`, `finishedAt`, `output`, `error`.
- `GET /api/logs?target=backend|frontend`: `{ok:true,text,checkedAt,truncated}`.
- `POST /api/confirm` con `{mode,destination}`: autorización de un uso y 60 s para
  `migrate|repair-docker`, vinculada a la sesión y a la base local concreta.
- `POST /api/op` con `{mode,requestId,confirmationId?}`: HTTP 202 y `{ok:true,operation}`.
  `requestId` evita ejecución duplicada mientras su registro permanezca en las últimas
  50 operaciones. Reutilizarlo con otro modo es 409. No usar IDs viejos como nueva orden.

POST exige `application/json`, objetos validados y hasta 4096 bytes. Errores con
`{ok:false,error}` y HTTP 400/401/403/409/413/415/500 según el caso. Respuestas privadas
`no-store`, protección de framing, `nosniff`, política de referrer y CSP con nonce para
los estilos Angular; scripts exclusivamente locales sin inline/eval. Material requiere
estilos de atributos dinámicos, permitidos por `style-src-attr`; no scripts inline.
Angular valida respuestas en runtime, incluso un `ok:false` con HTTP 200.

## Autoridad sobre procesos y archivos

- Operaciones asíncronas: Docker no bloquea el event loop HTTP. Salida capturada limitada
  a 1 MiB; resultados del historial a 16 KiB. Tails leen una ventana, no el log entero.
- `.uvh-runtime/control.lock` tiene identidad OS real y nonce de propietario, no la hora
  de escritura. Una puerta exclusiva `control.gate` protege admisión/liberación y evita
  reemplazos simultáneos. No expira un lock por antigüedad de un proceso vivo.
- PID reutilizado o muerto no otorga autoridad. Cuando un propietario vivo no es
  inspeccionable, se falla cerrado. Lock legado/dañado requiere revisión, no se borra.
- El supervisor frontend publica schema v1 con PID, identidad OS, raíz canónica y nonce,
  mediante tmp único + rename. Guarda su identidad antes de admitir control posterior.
  Parada amable y fuerza acotada pertenecen al hijo/grupo propio del supervisor; no se
  mata por coincidencia aproximada de nombre. Un cierre sin confirmación impide reiniciar.
- En Linux se usa creación `/proc` y comando; macOS usa `ps lstart` en UTC (precisión de
  segundo), mitigado para el frontend por nonce y raíz exactos. Windows usa CIM. No
  presentamos estas interfaces como inmunes a procesos maliciosos con el mismo usuario.
- Archivos estáticos se resuelven por ruta real; no se sirven symlinks que escapen del
  panel ni rutas desconocidas como SPA. El panel Angular es obligatorio. El antiguo
  HTML artesanal no se usa como fallback.
- SEA extrae cada instancia a un directorio temporal privado con manifiesto validado;
  no comparte ni sobrescribe un directorio global. Fallos de extracción son visibles.
- Credenciales conocidas del entorno y patrones sensibles se redactan, se eliminan
  controles peligrosos y los logs se muestran como texto. **No es garantía de detectar
  todo secreto arbitrario en un log de aplicación.** No registres credenciales en la app.

Esto protege frente a páginas web ajenas y errores de autoridad locales, no frente a
software malicioso ejecutándose con los permisos del usuario o un checkout comprometido.

## Recuperación tras interrupción

Si queda `control.gate`, un lock incierto o una operación `unknown`, no se fuerza una
segunda mutación. Revisa que el propietario/controlador y sus subprocesos realmente
terminaron, comprueba Docker y el puerto frontend y revisa el historial antes de tocar
metadata. No borres archivos de runtime por el mero hecho de que el navegador no responda.

Tras verificar manualmente el estado, puede archivarse el runtime interrumpido para
recuperar control; conserva la evidencia y no uses borrado indiscriminado. Identidades
anteriores al supervisor nuevo se consideran legadas y no conceden permiso para detener
un frontend antiguo. Detén ese servidor desde su propia terminal antes de iniciar otro.

## Compilación

Desde macOS/Linux ARM64 o x64:

```bash
cd panel && npm ci && npm run typecheck && npm run lint && npm run build
cd ..
node scripts/build-uvh-control.mjs                 # tres destinos
node scripts/build-uvh-control.mjs --only=macos
node scripts/build-uvh-control.mjs --only=windows
node scripts/build-uvh-control.mjs --node=v24.21.0
```

Node v24.21.0 y postject 1.0.0-alpha.6 fijados; postject se instala con el lockfile del
panel, no con npx flotante. Runtime host según SO/arquitectura reales. Descargas HTTPS
con timeout, SHA-256 contra `SHASUMS256.txt` oficial, comprobación también de caché y
publicación atómica. Esto no verifica una firma independiente del manifiesto upstream.
Angular, fuentes/iconos y licencias se embeben. Salidas con checksums en
`dist/uvh-control-checksums.json`; recompila después de modificar panel/control/build.
No se afirma reproducibilidad bit a bit.

macOS tiene firma ad-hoc, **sin notarización**; Windows no tiene firma comercial y
SmartScreen puede avisar. Linux x64 usa glibc/runtime dinámico. Solo se afirma ejecución
macOS ARM64 en el entorno actual; generar PE/ELF no verifica su ejecución nativa.

## Verificación reproducible

```bash
node --test scripts/uvh-control.test.mjs
cd panel && npm run typecheck && npm run lint && npm run build && npm run test:e2e
cd .. && node scripts/uvh-control-smoke.mjs  # macOS ARM64, binario ya compilado
```

Regresión y Playwright usan raíces temporales, adaptadores fail-closed y procesos falsos.
No arrancan Docker real ni manipulan el runtime del usuario. Playwright usa su propio
puerto 4597 (error si lo ocupa otro servidor), sin el stack E2E del producto.
Capturas claro/oscuro, escritorio/móvil en `panel/test-results/visual/`.
El smoke SEA ejecuta el binario en un checkout privado sin `panel/dist` ni Node en PATH
y verifica Angular renderizado, sesión y ausencia de errores de navegador.
