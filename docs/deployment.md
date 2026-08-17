# UVH — Despliegue y limitaciones del entorno

Documento de despliegue y de las capacidades reales detectadas de Freebuff Cloud (Fase 0 del plan). Cada elemento se clasifica como:

- ✅ **Ejecutado y comprobado**
- 🟡 **Disponible pero no usado**
- 💡 **Recomendado**
- ⛔ **No soportado por Freebuff Cloud**

## 1. Inspección del entorno (resultados reales)

| Capacidad | Resultado | Clasificación |
| --------- | --------- | ------------- |
| Node.js | `v22.23.1` | ✅ comprobado |
| npm | `10.9.8` | ✅ comprobado |
| PHP | `php: not found` | ⛔ no soportado |
| Composer | `composer: not found` | ⛔ no soportado |
| SQLite | Módulo nativo `node:sqlite` (Node 22) | ✅ comprobado (tests pasan) |
| Preview | Comando `freebuff-preview` gestiona la app | 🟡 disponible |
| Deploy estático/hosting | `freebuff-deploy` (imagen **Node.js-only**) | 🟡 disponible |
| Workers / procesos de larga duración | No garantizados; el scheduler corre **in-process** | ⛔ no soportado como servicio separado |
| Cron / scheduler | Sustituido por `setInterval` dentro de la API | 🟡 usado (in-process) |
| Dominios personalizados (uvh.es / app.uvh.es) | Depende de la configuración de hosting/dominios de Freebuff | 💡 a verificar al desplegar |
| HTTPS / HSTS | Disponible en el hosting gestionado; activar solo ahí | 💡 recomendado en producción |
| Variables de entorno | Inyectadas por la pestaña API Keys / `freebuff-env` | ✅ comprobado |

### Consecuencia del stack

El plan pedía **Laravel/PHP**. Como Freebuff Cloud no tiene PHP ni Composer (ni en preview ni en la imagen de deploy, que es Node.js-only), el backend se implementó con **Express + TypeScript + SQLite (`node:sqlite`)**, manteniendo la misma arquitectura de hosts, el mismo modelo de datos, autorización, seguridad y funcionalidad. No se usó ningún BaaS.

## 2. Ejecución local / preview

```bash
# Backend (API en http://0.0.0.0:3001)
cd backend && npm install && npm run dev

# Frontend (Angular dev server con proxy /api y /r)
cd frontend && npm install && npm start
```

El proxy de `ng serve` (`src/proxy.conf.js`) reenvía `/api` y `/r` a `BACKEND_URL` (por defecto `http://127.0.0.1:3001`).

### Preview de Freebuff

La preview la gestiona `freebuff-preview`. El backend debe escuchar en `0.0.0.0` (ya lo hace) y la SPA se sirve como build estático o dev server según la configuración guardada con:

```bash
freebuff-preview set-install "<comando>"
freebuff-preview set "<comando>" <puerto>
freebuff-preview set-build "<comando>"
freebuff-preview start        # o restart
```

## 3. Despliegue de producción (hosting gestionado)

El hosting de Freebuff es **Node.js-only** y ejecuta en un estado limpio:

1. comando de instalación configurado (o el por defecto del gestor);
2. comando de build configurado.

Para este proyecto:

- **Install**: `cd backend && npm install && cd ../frontend && npm install`
- **Build**: `cd frontend && npx ng build` (debe producir `dist/` y **salir**; no arrancar servidor) y `cd backend && npm run build` (emite `dist/src/index.js`).
- **Run (backend)**: `cd backend && npm start` → `node dist/src/index.js`. No se usa `tsx` en producción.

Verificar antes de desplegar:

```bash
freebuff-deploy check   # informa los comandos que ejecutará el hosting
freebuff-deploy status  # último despliegue
freebuff-deploy logs    # errores de build
freebuff-deploy start   # redesplegar (solo tras el primer deploy manual)
```

**Producción**: la SPA Angular (`dist/uvh`) se sirve como estáticos y la API Express debe ejecutarse como proceso Node. La resolución `uvh.es/{alias}` y la API `/api/v1` deben enrutarse al backend; el panel (`app.uvh.es`) sirve la SPA. En una instalación monoproceso, el backend puede servir también `dist/uvh` como estáticos (ver `docs/architecture.md`).

### Variables de entorno en producción

Son independientes de las del sandbox. Gestionarlas con:

```bash
freebuff-deploy env list
freebuff-deploy env set '{"APP_SECRET":"...","COOKIE_SECURE":"true","RESEND_API_KEY":"..."}'
freebuff-deploy env unset KEY
```

Claves requeridas en producción: `APP_SECRET` (obligatorio; el proceso **no arranca** si falta o usa el valor de desarrollo), `RESEND_API_KEY` (para email), `APP_URL`/`APP_HOST` (host real del panel, `app.uvh.es`), `PUBLIC_HOST=uvh.es`. Mantener `COOKIE_DOMAIN` vacío y `COOKIE_SECURE=true` bajo HTTPS.

En producción el backend aplica **separación por host** (`backend/src/middleware/host.ts`): `/api/v1`, `/auth` y `/app` solo responden en `APP_HOST`; la landing, legales, sitemap/robots y la resolución de enlaces solo en `PUBLIC_HOST` o dominios personalizados.

## 4. Base de datos (SQLite / Turso)

### Estado actual (verificado)

- SQLite local con el módulo nativo `node:sqlite` (Node 22).
- PRAGMAs en `backend/src/db.ts`:
  - `journal_mode = WAL` (escrituras concurrentes y lecturas no bloqueantes);
  - `synchronous = NORMAL`;
  - `foreign_keys = ON`;
  - `busy_timeout = 5000`.
- Transacciones atómicas con `BEGIN IMMEDIATE` (`tx()`), usadas en creación, uso único, máx. clics y cambios de estado.

### Turso / libSQL (recomendado para producción)

La base es **compatible SQLite**. Para una base gestionada y persistente en producción se recomienda **Turso (libSQL)**, que es drop-in compatible:

- Sustituir `node:sqlite` por `@libsql/client` en `backend/src/db.ts` (misma semántica SQL; se mantienen WAL y transacciones).
- Turso gestiona **backups automáticos** y réplicas.
- La URL y el token de Turso se leen de variables de entorno (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`), nunca del código.

> ⚠️ El SQLite **local** en el hosting gestionado es útil para preview, pero su persistencia entre deploys depende del sistema de archivos del proveedor. Para datos que deben sobrevivir a deploys y escalar, usar Turso.

### Backups y purga

- **Purga programada**: el scheduler elimina `click_events` y `metric_rollups` más antiguos que `ANALYTICS_RETENTION_DAYS` (por defecto 180).
- **Backups**:
  - Local: `sqlite3 uvh.sqlite ".backup uvh-$(date +%F).sqlite"` o `VACUUM INTO`.
  - Producción (Turso): backups gestionados por el proveedor.

## 5. Limitaciones detectadas (sin cambiar la arquitectura)

1. **Sin PHP/Laravel**: sustituido por Express + TypeScript (equivalente soportado).
2. **Sin workers/cron persistentes garantizados**: el scheduler (activación/caducidad/purga/reintentos de webhooks) corre **dentro** del proceso de la API (`setInterval`). Si la API se reinicia, los jobs se reanudan al arrancar. Para cargas altas, mover el scheduler a un worker externo o a un cron del proveedor cuando esté disponible.
3. **Persistencia del SQLite local**: depende del filesystem del hosting. Usar Turso para producción.
4. **Dominios personalizados (`uvh.es` / `app.uvh.es`) y HTTPS**: requieren la configuración de dominios del hosting de Freebuff; la app ya implementa toda la lógica (host validation, DNS TXT para dominios personalizados, cookie restringida a `app.uvh.es`, separación por host en producción).
5. **Email**: requiere `RESEND_API_KEY`; sin ella, los correos se registran en log y no se envían (los flujos de verificación siguen funcionando en dev).

## 6. "Preparado para producción" — checklist

- [ ] Base de datos persistente (Turso) configurada.
- [ ] `APP_SECRET`, `RESEND_API_KEY` definidos en producción.
- [ ] HTTPS activo → `COOKIE_SECURE=true` + HSTS.
- [ ] SPA Angular servida en `app.uvh.es`, API y redirección en `uvh.es`.
- [ ] Dominios personalizados verificados por TXT.
- [ ] Scheduler/worker para purga y reintentos de webhooks desplegado (o confirmado in-process).
- [ ] Límites de cuota por plan definidos en `quotas`.
