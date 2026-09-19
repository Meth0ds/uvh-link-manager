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

## Escaneo de seguridad

Larastan y ESLint buscan errores de tipo y de estructura. Ninguno de los dos ve
las tres clases de defecto que cubre esta capa, y por eso son herramientas
distintas y no un ajuste de las anteriores:

```text
Semgrep   flujo de datos y patrones peligrosos en PHP, TypeScript, Dockerfile y Nginx
Gitleaks  credenciales, en el árbol y en el historial de commits
Trivy     árbol de dependencias y configuración de infraestructura
```

CodeQL sigue ejecutándose sobre JavaScript y TypeScript, y desde esta ronda
también sobre los propios flujos de trabajo (`actions`): son el código que
maneja tokens de despliegue. CodeQL no soporta PHP, así que esa mitad la lleva
Semgrep.

### Cómo reproducir un hallazgo antes de abrir el PR

Los tres comandos son los mismos que ejecuta CI, con las versiones fijadas del
flujo de trabajo. Se pueden copiar tal cual desde la raíz del repositorio:

```bash
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep:1.176.1 \
  semgrep scan \
    --config p/php --config p/security-audit --config p/owasp-top-ten \
    --config p/php-laravel --config p/sql-injection --config p/xss \
    --config p/jwt --config p/insecure-transport --config p/command-injection \
    --metrics=off /src

docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 \
  dir /repo --config /repo/.gitleaks.toml --redact --verbose

docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.74.0 \
  fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed /repo

docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.74.0 \
  config --severity HIGH,CRITICAL --ignorefile /repo/.trivyignore.yaml /repo
```

Los dos escaneos de Trivy son comandos distintos a propósito: `--ignore-unfixed`
sólo tiene sentido sobre dependencias, y `--ignorefile` sólo sobre
infraestructura. Juntarlos en uno dejaría la puerta de dependencias esperando un
parche que no existe. El comando de Semgrep, en cambio, se ejecuta sin
`--severity ERROR`: en local interesan también los avisos, que es donde está el
contexto para decidir; la puerta añade el filtro y `--error`.

El informe de Trivy tiene que mirarse, no sólo el código de salida: las
vulnerabilidades sin parche publicado no bloquean, pero siguen apareciendo y se
deciden (aislar, sustituir o aceptar por escrito).

### Qué bloquea y qué sólo informa

```text
Semgrep   bloquea en ERROR; los avisos quedan en el informe
Gitleaks  bloquea con cualquier hallazgo (no tiene severidades)
Trivy     bloquea en HIGH y CRITICAL con parche publicado; en infraestructura, en HIGH y CRITICAL
```

El umbral vive en `.github/workflows/security.yml` y no se hereda de ninguna
parte: `--severity ERROR` sin `--error` informa y no bloquea, y `--exit-code 1`
es lo que convierte un hallazgo de infraestructura en un fallo.

La ejecución semanal (`cron: "23 4 * * 1"`) no es decorativa: las bases de datos
de vulnerabilidades y los conjuntos de reglas cambian sin que el repositorio
cambie, y un hallazgo nuevo sobre código quieto sólo aparece si algo vuelve a
mirar. En esa ejecución Gitleaks recorre además el historial completo, que es la
única forma de ver un secreto que se borró del árbol pero sigue en un commit
publicado.

### Excepciones: dónde viven y qué se exige

Toda excepción lleva motivo y ámbito, y ninguna alcanza el código propio
(`app/`, `config/`, `database/`, `routes/`, `frontend/src/`, `.github/workflows/`):
si una credencial real se pegara ahí, tiene que seguir señalándose.

```text
.gitleaks.toml          rutas con datos de prueba, cada una con su motivo
.gitleaksignore         huellas commit:ruta:regla:línea de hallazgos históricos ya revisados
.trivyignore.yaml       id + rutas + motivo, y el archivo debe seguir existiendo
nosemgrep: <regla>       supresión en el punto, de una sola regla y con motivo encima
```

La supresión en el punto es la única que no vive en un archivo de política, así
que se le exige la forma exacta: nombra **una** regla (un `nosemgrep` sin
regla silencia el archivo entero) y lleva encima una línea `# Motivo: ...`. El
contrato busca ese marcador, no la palabra suelta, para que una frase vecina no
lo satisfaga por accidente.

`Tests\Unit\SecurityScanContractTest` sostiene las cuatro: falla si una
excepción pierde su motivo, si un `nosemgrep` no nombra su regla, si una entrada
de Trivy cubre un directorio o un archivo que ya no existe, si el flujo pierde
un conjunto de reglas, o si el umbral deja de ser ERROR y HIGH/CRITICAL.

### Triaje de la primera ejecución (2026-09-17)

| Herramienta | Hallazgo | Decisión |
| --- | --- | --- |
| Semgrep | 11 hallazgos: 2 ERROR, 5 avisos, 4 medios | Los 2 ERROR eran los Dockerfiles que corren como root (desarrollo y certificados de ensayo): se suprimen en el punto con motivo. Los medios de cadena de suministro se corrigen en Dependabot (`cooldown`) |
| Semgrep | Aviso: `$host` en `fastcgi_param HTTP_HOST` (tres sitios) | Revisado y aceptado: se reenvía la forma normalizada (`$host`, no `$http_host`) y Laravel vuelve a validarla contra la lista de hosts. Queda en el informe, no bloquea |
| Semgrep | Aviso: `postMessage` con destino `*` (dos sitios) | Revisado y aceptado: `targetOrigin` no admite comodines, el marco es del proveedor y el mensaje no lleva secretos. Queda en el informe, no bloquea |
| Semgrep | Medio: `.npmrc` sin edad mínima de publicación | No aplicado a propósito: CI instala con `npm ci` desde el lockfile y Node 22 trae npm 10, que no implementa la clave; añadirla sólo produciría avisos. Se revisará al subir de versión de Node |
| Trivy (dependencias) | `hono@4.13.3`, tres CVE medios, parche en 4.13.5 | Resuelto en el lockfile (4.13.8); `npm audit --audit-level=moderate` estaba en rojo por esto y vuelve a estar verde |
| Trivy (infraestructura) | 5 HIGH `DS-0002` (usuario root) | `docker/nginx/Dockerfile.production` declara `USER 101:101`; las otras cuatro imágenes son de desarrollo o de ensayo y quedan en `.trivyignore.yaml` con motivo y deuda registrada (SCAN-001 a SCAN-003) |
| Trivy (infraestructura) | 6 LOW `DS-0026` (sin `HEALTHCHECK`) | No se toca: la salud la declara el orquestador en `docker-compose.production.yml` (`uvh:healthcheck`, `wget /health`, `pg_isready`), y el trabajo de contrato de arranque ya la ejerce. Un `HEALTHCHECK` en la imagen duplicaría esa comprobación |
| Gitleaks (árbol) | 19 hallazgos | Todos en fixtures de pruebas, ensayos de frontend y el entorno del contrato de arranque: cada ruta queda declarada en `.gitleaks.toml` |
| Gitleaks (historial) | 8 hallazgos | Seis son de la suite del backend Express eliminado y dos son falsos positivos de entropía sobre una clave de almacenamiento: revisados uno a uno y fijados en `.gitleaksignore` |

Queda un residuo que conviene saber leer: el motor no consigue parsear tres
plantillas Angular (`PartialParsing`), así que esas líneas no se analizan. No
son hallazgos ni bloquean, pero significan que en esos tres archivos la
cobertura no es la misma que en el resto; ESLint y el compilador de plantillas
siguen cubriéndolos.

Lo que esta capa **no** cubre, para que no se lea como más de lo que es: no
ejecuta la aplicación (no hay DAST ni fuzzing), no analiza las imágenes
construidas —eso ocurre en el trabajo que las construye, y las bases que el
repositorio no compila se escanean sin construirlas—, y no sustituye a una
revisión humana de los cambios que tocan autenticación, permisos o dinero.

### Triaje de la puerta de bases ajenas (2026-09-18)

Primera corrida sobre las doce bases fijadas, con el mismo Trivy 0.74.0 y la
misma puerta que las imágenes del repositorio. Tres hallazgos, y sólo uno se
acepta por escrito:

| Imagen | Hallazgo | Decisión |
| --- | --- | --- |
| `postgres:16-alpine` y `postgres:16` | CRITICAL con parche `CVE-2025-68121` en la `stdlib` de Go dentro de `/usr/local/bin/gosu` | **Aceptado** con ámbito de ruta y caducidad el 2027-03-31. `gosu` sólo cambia de usuario y hace `exec`, no abre conexiones TLS, y el binario lo publica el autor de la imagen: cambiar el pin no lo cierra, porque la etiqueta de hoy trae el mismo |
| `postgres:16` (Debian) del imagen de copias | 3 CVE CRITICAL con parche en cuatro paquetes de Perl (`deb13u1`) | **Arreglado**: el imagen de copias pasó a `postgres:16-alpine`, la misma variante que ya usaba el resto del árbol. `apt-get upgrade` aquí habría dejado la puerta en rojo sobre la base fijada, que es lo que se escanea, y habría exigido una excepción para un hallazgo que sí tiene arreglo |
| `node:22-bookworm-slim` (fase de compilación del frontend) | CRITICAL con parche `CVE-2026-59873` en el `tar` 7.5.11 que npm lleva dentro | **Aceptado** con ámbito de ruta y caducidad el 2026-12-31. No es una dependencia del proyecto (`frontend/package-lock.json` no lo resuelve), no llega al artefacto y la etiqueta más reciente sigue trayéndolo; se cierra cuando Node publique una imagen con el npm parcheado |

El cambio de base del imagen de copias se verificó ejecutando la copia y la
restauración completas contra la base nueva: clave, `pg_dump` 16.15, cifrado
AES-256-CBC con verificación descifrando el criptograma, y restauración en una
base vacía con las 250 filas de prueba. La variante Alpine trae el mismo
PostgreSQL 16 y `openssl` se añade en el Dockerfile, porque el cifrado de
`backup.sh` lo necesita.

## Integración continua

CI instala exclusivamente los lockfiles y ejecuta, además de auditorías,
pruebas y builds:

```text
PHP:     Pint --test -> Larastan/PHPStan -> migraciones uvh_test -> PHPUnit
Angular: ESLint -> typecheck -> Karma/Jasmine -> build de producción
Seguridad: Semgrep (ERROR) -> Gitleaks (árbol, y el historial en el cron)
           -> Trivy (HIGH/CRITICAL con parche) -> SARIF en la pestaña Security
Supply:  digests de imagen (pins que resuelven) -> SBOM CycloneDX de las dos
         imágenes de producción -> informe HIGH/CRITICAL -> CRITICAL con parche
Bases:   cada base ajena que el árbol fija -> CRITICAL con parche, y ninguna
         supresión que ya no suprima nada
```

El análisis estático no ve el artefacto que se despliega, así que la última
línea vive donde ese artefacto existe: el trabajo `release-e2e` construye las
dos imágenes de producción y ahí mismo genera su SBOM CycloneDX, publica el
informe de vulnerabilidades y aplica la puerta. La puerta sólo bloquea una
vulnerabilidad CRITICAL **con parche publicado**: los HIGH con parche se publican
y se revisan, porque exigir su arreglo en paquetes de la distribución convertiría
la puerta en una lista de excepciones. Procedimiento, umbral y deuda abierta:
[`image-provenance-runbook.md`](image-provenance-runbook.md).

Ese trabajo juzga las dos imágenes que el repositorio compila, y sólo esas. Las
demás bases fijadas del árbol —Caddy, que es el borde de producción; PostgreSQL y
Redis, que sostienen los ensayos; las de compilación— no las miraba nadie, y ahí
cabía un CRITICAL con parche durante meses sin que ningún trabajo se enterara. El
trabajo `image-bases` cierra ese hueco con la misma puerta y con la lista tomada
de `check-image-digests.mjs --references`: no declara sus propias imágenes, porque
una lista propia se queda atrás sin fallar. Cada escaneo declara su final
—`clean`, `findings`, `unresolved` o `unavailable`—, y un límite de tasa del
registro se informa como `unavailable` en vez de bloquear, por la misma razón que
en el chequeo de digests: un 429 de una IP compartida no es un defecto del
repositorio. Hay `--fail-on-unavailable` para quien prefiera que una comprobación
incompleta detenga la ejecución.

Una excepción con ámbito de ruta dentro de una imagen no se puede comprobar desde
el repositorio, así que se le exige la forma —un fichero concreto, sin comodines—
y que el escaneo demuestre en cada corrida que sigue suprimiendo algo: la entrada
que ya no suprime nada falla la puerta en vez de quedarse ahí pareciendo
aprobada. La comprobación es **entrada por entrada** y sólo concluye cuando hubo
informe de todas las imágenes: mirar el total de la sección dejaba que una entrada
muerta se escondiera detrás de una viva, y concluir «obsoleta» desde un daemon
caído presionaría para retirar una excepción válida. Sin informe, la entrada queda
`unchecked` y bloquea sólo con `--fail-on-unavailable`.

Las migraciones y PHPUnit se ejecutan sólo sobre la base efímera `uvh_test`.
Nunca se debe apuntar este flujo a `uvh_local` ni a una base con datos reales.
El escaneo de seguridad vive en un flujo aparte
(`.github/workflows/security.yml`) para que su fallo no oculte el de las
pruebas, y para poder reejecutarlo a mano cuando aparece un aviso nuevo.
