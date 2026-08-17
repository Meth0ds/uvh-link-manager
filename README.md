# UVH — Enlaces cortos. Control total.

Plataforma profesional de acortamiento, administración y analítica de enlaces.

- **uvh.es** → landing pública, resolución de enlaces (redirecciones HTTP reales en backend), páginas legales y denuncia.
- **app.uvh.es** → SPA Angular autenticada. La API vive bajo `/api/v1`.

> 🔒 Regla de seguridad crítica: la cookie de sesión del panel pertenece **solo** a `app.uvh.es`. Nunca configures `COOKIE_DOMAIN=".uvh.es"` — no debe existir una cookie compartida sobre el dominio raíz.

## Estructura

```
uvh/
├── frontend/   # SPA Angular 19 (Angular Material + CDK)
└── backend/    # API Express + TypeScript + SQLite (node:sqlite)
```

## Stack

| Capa          | Tecnología                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| Frontend      | Angular 19, TypeScript estricto, Angular Material, Angular CDK, Signals, componentes standalone, lazy loading |
| Backend       | Express 4, TypeScript, Zod, bcryptjs, otplib, express-rate-limit            |
| Base de datos | SQLite (módulo nativo `node:sqlite`)                                        |
| Email         | Resend                                                                      |
| Tests         | Vitest + Supertest (backend)                                                |

## Requisitos

- Node.js **22+** (usa el módulo nativo `node:sqlite`)
- npm — ver `package.json` de cada paquete

## Puesta en marcha

### 1. Variables de entorno

Crea un `.env.local` en la raíz (gitignored) y rellena los valores:

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `NODE_ENV` | no | `development` / `production` |
| `PORT` / `BACKEND_PORT` | no | Puerto del backend (por defecto `3001`) |
| `DATABASE_PATH` | no | Ruta del SQLite (por defecto `backend/data/uvh.sqlite`) |
| `APP_SECRET` | **sí** | Secreto de firma de sesión (cadena larga y aleatoria) |
| `SESSION_COOKIE` | no | Nombre de la cookie (por defecto `uvh_session`) |
| `SESSION_TTL_DAYS` | no | Duración de la sesión en días (por defecto `30`) |
| `COOKIE_SECURE` | prod | `true` en producción (HTTPS) |
| `COOKIE_DOMAIN` | no | Mantener **vacío** (nunca `.uvh.es`) |
| `APP_URL` | no | URL de la SPA (por defecto `http://localhost:4200`) |
| `PUBLIC_HOST` | no | Host público de resolución (por defecto `uvh.es`) |
| `RESEND_API_KEY` | no | Clave de Resend para email transaccional |
| `MAIL_FROM` | no | Remitente de correo |
| `VERIFIED_REQUIRED_TO_CREATE` | no | Exigir email verificado para crear enlaces (`true`/`false`) |
| `BACKEND_URL` | no | Solo frontend dev: destino del proxy (`http://127.0.0.1:3001`) |

### 2. Backend

```bash
cd backend
npm install
npm run dev    # tsx watch src/index.ts → http://127.0.0.1:3001
npm test       # vitest run
```

### 3. Frontend

```bash
cd frontend
npm install
npm start      # ng serve → http://localhost:4200
```

El proxy de desarrollo (`src/proxy.conf.js`) reenvía `/api` y `/r` al backend (`BACKEND_URL`, por defecto `http://127.0.0.1:3001`).

## Scripts

**Backend** (`backend/package.json`)

- `npm run dev` — desarrollo con recarga
- `npm run start` — ejecutar el servidor
- `npm run build` — `tsc -p tsconfig.json`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest

**Frontend** (`frontend/package.json`)

- `npm start` — `ng serve`
- `npm run build` — `ng build`
- `npm test` — `ng test`

## Seguridad

- `.env.local` y `.env.*.local` están ignorados por git; nunca subas secretos reales.
- En producción activa `COOKIE_SECURE=true`.
- Mantén `COOKIE_DOMAIN` vacío para que la cookie de sesión se restrinja a `app.uvh.es`.

## Estado

Proyecto en desarrollo activo (work in progress).
