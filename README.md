# UVH — Enlaces cortos. Control total.

Plataforma profesional de acortamiento, administración y analítica de enlaces.

- **uvh.es** → landing pública, resolución de enlaces (redirecciones HTTP reales en backend), páginas legales y denuncia.
- **app.uvh.es** → SPA Angular autenticada. La API vive bajo `/api/v1`.

> 🔒 Regla de seguridad crítica: la cookie de sesión del panel pertenece **solo** a `app.uvh.es`. Nunca configures `COOKIE_DOMAIN=".uvh.es"` — no debe existir una cookie compartida sobre el dominio raíz.

## Estructura

```
uvh/
├── frontend/        # SPA Angular 22 (Angular Material + CDK)
├── backend-laravel/ # API Laravel 13 + PostgreSQL 16
├── docker/          # Dockerfile PHP 8.4 para el stack local
└── docs/            # arquitectura, despliegue, seguridad, API
```

## Stack

| Capa          | Tecnología                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| Frontend      | Angular 22, TypeScript estricto, Angular Material, Angular CDK, Signals, componentes standalone, lazy loading |
| Backend       | Laravel 13 (PHP 8.4), Eloquent, cola `database`, scheduler                  |
| Base de datos | PostgreSQL 16 (local vía Docker Compose)                                    |
| Email         | Resend                                                                      |
| Tests         | PHPUnit (Laravel) + Karma/Jasmine (Angular)                                 |

## Requisitos

- Docker Desktop (PostgreSQL + PHP 8.4 en contenedores)
- Node.js 22+ y npm para el frontend

## Puesta en marcha

### 1. Infraestructura (PostgreSQL + PHP)

```bash
cp .env.docker.local.example .env.docker.local
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres
# App completa (artisan serve + queue + schedule):
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d
```

### 2. Backend Laravel

```bash
cd backend-laravel
composer install
cp .env.example .env        # y configura DB_* para apuntar a PostgreSQL local
php artisan key:generate
php artisan migrate
php artisan test            # PHPUnit
```

En local, `php artisan serve` escucha en `http://127.0.0.1:8000` (contenedor `app` del Compose).

### 3. Frontend

```bash
cd frontend
npm install
npm start      # ng serve → http://localhost:4200
```

El proxy de desarrollo (`src/proxy.conf.js`) reenvía `/api` y `/r` al backend (`BACKEND_URL`, por defecto `http://127.0.0.1:8000`).

## Scripts

**Backend Laravel** (`backend-laravel/`)

- `php artisan test` — PHPUnit
- `php artisan queue:work` — worker de cola (webhooks asíncronos)
- `php artisan schedule:work` — scheduler local (activación/caducidad de enlaces y purgas)
- `php artisan uvh:housekeeping` — pasada de mantenimiento manual

**Frontend** (`frontend/package.json`)

- `npm start` — `ng serve`
- `npm run build` — `ng build`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `ng test`

## Seguridad

- `.env*` y `.env.docker.local` están ignorados por git; nunca subas secretos reales.
- En producción activa `COOKIE_SECURE=true`.
- Mantén `COOKIE_DOMAIN` vacío para que la cookie de sesión se restrinja a `app.uvh.es`.
- En producción, `APP_SECRET` es obligatorio: el backend **no arranca** si falta o usa el valor de desarrollo.
- Ver `docs/security.md` y `docs/security-audit-2026-08-19.md`.

## Estado

Proyecto en desarrollo activo (work in progress).