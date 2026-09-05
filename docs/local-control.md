# UVH Control local

`UVH Control.cmd` abre una interfaz de Windows para el entorno de desarrollo de
UVH. Gestiona el Compose local y un único servidor Angular perteneciente a este
checkout; no es una consola de producción.

## Uso

1. Ejecuta `UVH Control.cmd` desde la raíz del proyecto.
2. **Iniciar todo** prepara `.env.docker.local` desde la plantilla si falta,
   arranca PostgreSQL, Laravel, worker y scheduler, e inicia Angular en
   `127.0.0.1:4200`. La operación se ejecuta fuera del hilo visual: el panel
   sigue respondiendo y muestra un aviso cada diez segundos mientras trabaja.
3. **Actualizar estado** consulta Docker Compose, `http://127.0.0.1:8000/health`
   y la web local también en segundo plano. Una respuesta válida de tres
   segundos o más se presenta como `LENTO`, no como una caída falsa.
4. **Logs backend** y **Logs frontend** abren consolas de seguimiento separadas.
5. **Detener** para los servicios Compose y únicamente el proceso Angular cuya
   identidad fue registrada por esta herramienta.
6. **Reparar Docker** se usa sólo cuando Docker Desktop informa que no puede
   reemplazar `sailor-ingest.sock` o `engine.sock`. Solicita UAC, cierra los
   componentes de Docker y archiva sus directorios IPC antes de restaurar WSL.

También existe un modo de diagnóstico que no abre la interfaz ni cambia estado:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\uvh-control.ps1 -Mode Status
```

## Controles de seguridad

- Docker y PostgreSQL sólo se publican en loopback en el Compose local.
- El proceso Angular se identifica mediante PID, instante de creación, raíz del
  checkout y línea de comando exacta. Un PID reutilizado se descarta y nunca se
  termina por coincidencia aproximada.
- El arranque se detiene si otro proceso ocupa el puerto 4200.
- Un inicio ordinario reutiliza las imágenes disponibles. Compose construye lo
  que falte, pero no fuerza una reconstrucción completa en cada pulsación.
- La parada intenta primero un cierre normal del árbol y sólo fuerza después de
  una espera acotada.
- `.uvh-runtime/` y `.env.docker.local` están ignorados por Git. Los logs y la
  identidad del proceso no se publican.
- La herramienta no muestra ni copia secretos. Tampoco ejecuta pruebas.
- La sonda de migraciones pasa usuario y base como argumentos validados y usa el
  socket interno de PostgreSQL; nunca extrae ni muestra la contraseña.
- El lanzador usa `ExecutionPolicy Bypass` únicamente para su proceso porque el
  equipo bloquea scripts locales. No cambia la política del usuario, el registro
  ni la configuración permanente de PowerShell.

## Migraciones

El botón **Aplicar migraciones** ejecuta las migraciones pendientes contra la
base declarada en `.env.docker.local`. Aunque Laravel no revierte datos por sí
solo, una migración puede modificar esquema o contenido: revisa el nombre de la
base y conserva un backup cuando los datos locales importen.

Esta acción no acredita que una migración sea segura en producción. Las
migraciones `000016`–`000031` siguen necesitando ensayo sobre una copia
representativa, medición de locks y rollback documentado.

## Recuperación

Si Windows o el terminal se cierran inesperadamente, la siguiente lectura de
estado compara el instante de creación antes de confiar en el PID guardado. Si
Angular terminó, el archivo de identidad obsoleto se elimina. Los contenedores
se consultan directamente mediante Compose, por lo que no dependen de un PID
local persistido por la interfaz.

En este checkout, el primer arranque de Angular y la recreación inicial de
Compose pueden tardar alrededor de medio minuto. El backend PHP de desarrollo
puede aparecer como `LENTO` sobre un bind mount de Windows aunque `/health`
termine con HTTP `200`; ese indicador mide disponibilidad real y latencia por
separado.

### Socket IPC de Docker bloqueado

Docker Desktop 4.88.1 puede quedar sin arrancar después de un cierre anómalo si
Windows retiene alguno de sus endpoints AF_UNIX. El panel detecta los errores de
`sailor-ingest.sock` y `docker-secrets-engine\engine.sock` y recomienda
**Reparar Docker**. La reparación no borra los directorios: los renombra con el
sufijo `.stale-<fecha>`, de modo que el cambio es reversible y Docker crea un
runtime limpio en el siguiente arranque. No toca datos de PostgreSQL, imágenes,
contenedores, volúmenes ni configuración.
