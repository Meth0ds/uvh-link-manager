# Análisis estático y formato

El análisis estático es una puerta de regresión: cada cambio debe pasar las
reglas actuales y no puede aumentar la deuda conocida. No sustituye las pruebas
ni acredita por sí solo que el sistema esté preparado para producción.

## Backend

Desde `backend-laravel`:

```bash
composer lint
composer analyse
```

`composer lint` ejecuta Pint en modo de comprobación, sin modificar archivos.
`composer analyse` ejecuta Larastan/PHPStan en nivel 6 sobre `app`.

Al introducir esta puerta se registraron 368 incidencias preexistentes,
agrupadas en 293 entradas de `phpstan-baseline.neon`. El baseline es deuda
medible, no una lista de excepciones permanentes:

- no se deben añadir entradas para hacer pasar un cambio nuevo;
- al corregir una incidencia hay que regenerar o reducir su entrada;
- `reportUnmatchedIgnoredErrors` hace fallar el análisis si queda una
  supresión que ya no corresponde a ningún error;
- elevar el nivel se hará después de reducir de forma controlada esta deuda.

Para inspeccionar toda la deuda sin aplicar el baseline, usa temporalmente una
configuración separada; no elimines ni edites el archivo compartido sólo para
una ejecución local.

## Frontend

Desde `frontend`:

```bash
npm run lint
npm run typecheck
```

ESLint analiza TypeScript, plantillas Angular y plantillas inline. Las reglas de
accesibilidad de `angular-eslint` están activas. Las excepciones globales están
comentadas en `eslint.config.js` y requieren una justificación de arquitectura
o de frontera de confianza. El build usa `@angular/build`; no se debe reintroducir
el builder Webpack obsoleto de `@angular-devkit/build-angular`.

## Integración continua

CI instala exclusivamente los lockfiles y ejecuta, además de auditorías,
pruebas y builds:

```text
PHP:     Pint --test -> Larastan/PHPStan -> migraciones uvh_test -> PHPUnit
Angular: ESLint -> typecheck -> Karma/Jasmine -> build de producción
```

Las migraciones y PHPUnit se ejecutan sólo sobre la base efímera `uvh_test`.
Nunca se debe apuntar este flujo a `uvh_local` ni a una base con datos reales.
