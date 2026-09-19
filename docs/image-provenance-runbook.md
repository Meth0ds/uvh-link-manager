# Cadena de suministro de las imágenes — digest, SBOM y promoción

Este documento responde a una pregunta concreta: **¿el contenedor que atiende
producción es el artefacto que se revisó y se escaneó?** Todo lo que hay aquí
existe para que la respuesta sea comprobable y no una promesa.

La regla que lo sostiene es una:

> La etiqueta dice qué release es; el digest dice qué bytes son. Se promociona el
> digest, nunca la etiqueta, y el servidor de producción no construye.

## 1. La cadena

```
commit
  ↓
CI (pruebas, análisis estático, contrato de arranque)
  ↓
construir UNA vez (docker-compose.production.yml, o el ensayo release-e2e)
  ↓
escaneo + SBOM sobre esas dos imágenes concretas
  ↓
escaneo de cada base fijada que no se construye aquí
  ↓
[ firma y procedencia ]            ← descrito aquí, NO ejecutado todavía
  ↓
registro de imágenes
  ↓
digest inmutable
  ↓
staging con ese digest
  ↓
producción con ese mismo digest
```

Lo que no se hace nunca: `git pull` y `docker build` en el servidor de
producción. Un `git pull` construye desde una rama que puede haber cambiado, con
una caché de dependencias que nadie revisó, y el artefacto resultante no es el
que pasó por el escaneo. En su lugar, producción arranca con la referencia
`nombre@sha256:…` que se le entrega.

## 2. Lo que está implementado y medido

| Pieza | Dónde | Estado |
| --- | --- | --- |
| 11 imágenes base fijadas por digest, con la etiqueta conservada | los 6 `Dockerfile` y los 8 ficheros de compose | implementado y verificado |
| Mantenimiento de los pines | `.github/dependabot.yml`, cinco entradas `docker` (raíz + los cuatro directorios con Dockerfile) | implementado |
| Verificación de que cada digest sigue resolviendo | `scripts/check-image-digests.mjs`, trabajo `digest-integrity` de `ci.yml` | implementado y verificado |
| SBOM CycloneDX de las dos imágenes de producción | trabajo `release-e2e` de `ci.yml` | implementado |
| Informe de vulnerabilidades + expediente con hashes | `scripts/image-evidence.mjs`, artefacto `image-evidence` | implementado |
| Puerta sobre CRITICAL con parche publicado | trabajo `release-e2e` de `ci.yml` | implementado |
| Escaneo de cada base ajena fijada (Caddy, PostgreSQL, Redis, bases de compilación) | `scripts/scan-pinned-images.mjs`, trabajo `image-bases` de `ci.yml` | implementado y verificado |
| Firma y procedencia | este documento, sección 4 | **no ejecutado** |
| Promoción desde registro | este documento, sección 4 | **no ejecutado** |

### Fijación por digest

31 referencias en 14 sitios de compose y 9 `FROM` en 6 Dockerfiles. El digest es
el del índice multi-arquitectura, así que la misma referencia sirve en `amd64` y
en `arm64`: fijar por digest no rompe a quien construye en otro procesador.

`node scripts/check-image-digests.mjs` responde a tres preguntas distintas y las
reporta por separado, porque no son el mismo problema:

- `ok` — el digest fijado existe y la etiqueta sigue apuntando a él.
- `drift` — el digest existe pero la etiqueta ya apunta a otro sitio. **Aviso, no
  fallo**: no falta nada, falta aprobar una actualización. Con `--strict-drift`
  se convierte en fallo, para quien quiera revisión obligatoria en cada deriva.
- `unresolved` — el digest fijado ya no resuelve. **Falla**: la compilación se
  rompería, y sin esta puerta quien se entera es el despliegue.

El registro de Docker Hub limita por IP de salida (100 peticiones por hora en
anónimo) y un runner de CI la comparte. Por eso el script pregunta primero al API
de Hub y recurre al CLI de Docker como segunda vía: **limitan por separado**, así
que un 429 en uno no dice nada del otro. Lo que no consigue comprobar lo declara
como `unavailable` en vez de callarlo, y `--fail-on-unavailable` convierte ese
caso en fallo para quien prefiera que una comprobación incompleta detenga la
ejecución.

### Números medidos

Con Trivy 0.74.0, sobre las bases fijadas:

| Imagen | CRITICAL con parche | CRITICAL sin parche | HIGH con parche | HIGH sin parche |
| --- | --- | --- | --- | --- |
| `uvh-api` (sobre `php:8.4-fpm-bookworm`, Debian 12.15) | 0 | 8 | 69 | 264 |
| `uvh-web` (sobre `nginxinc/nginx-unprivileged:1.31-alpine`, Alpine 3.24.1) | 0 | 0 | 0 | 0 |

Dos lecturas que cambian decisiones:

- **Los HIGH con parche no bloquean.** Son 69, todos del sistema de la imagen del
  API: una puerta que los exigiera sería una lista de excepciones que nadie
  mantiene, y una puerta que se ignora es peor que no tenerla. Se publican en el
  SARIF y se revisan, pero no detienen el trabajo.
- **Un CRITICAL con parche sí bloquea**, porque no es una vulnerabilidad sin
  arreglo: es un arreglo que alguien no aplicó.

La fila del web se midió el **2026-09-18** sobre la imagen real que construye
`docker compose -f docker-compose.release-e2e.yml build nginx`, no sobre un
proxy: el expediente de esa corrida está más abajo. La fila del API sigue siendo
del **2026-09-17** y sale de `uvh-api:release-boot`, la salida local de la misma
`docker/php/Dockerfile.production`, porque la cuota anónima de Docker Hub estaba
agotada cuando se midió y el API no ha cambiado desde entonces. El expediente
que publica CI se genera sobre las dos imágenes reales del trabajo, que es donde
el número definitivo aparece.

## 3. La puerta, y sus excepciones

La puerta de imagen es `--scanners vuln --severity CRITICAL --ignore-unfixed
--exit-code 1`. Comportamiento comprobado, no supuesto:

| Caso | Resultado |
| --- | --- |
| Imagen con un CRITICAL que tiene parche, sin excepción | falla |
| El mismo hallazgo aceptado en `.trivyignore.yaml` y vigente | pasa |
| La misma entrada con `expired_at` en el pasado | vuelve a fallar |
| Imagen sin CRITICAL con parche | pasa |

Que la caducidad se respete la implementa el propio Trivy: al vencer, el hallazgo
se reporta otra vez. No depende de que alguien se acuerde de revisar una fecha.

La primera excepción que hubo se cerró como estaba previsto. `CVE-2026-31789`
(openssl `3.3.3-r0` de `nginxinc/nginx-unprivileged:1.27-alpine`, con el arreglo
`3.3.7-r0` publicado en la rama 3.21 de Alpine) estaba aceptado hasta el
**2026-11-16**; el arreglo acordado era sustituir la base, no parchear en la
aplicación, y se hizo el **2026-09-18**: la base fijada del web pasó a
`nginxinc/nginx-unprivileged:1.31-alpine` (Alpine 3.24.1, openssl `3.5.8-r0`) y la
entrada desapareció de `.trivyignore.yaml`.

Ese día la puerta se amplió: hasta entonces sólo se escaneaban las dos imágenes
que el repositorio construye, y Caddy —el borde de producción— más PostgreSQL y
Redis, que sostienen los ensayos, no las miraba nadie. El trabajo `image-bases`
recorre las bases fijadas con la misma puerta y encontró tres hallazgos; dos se
arreglaron y dos quedan aceptados con motivo, ámbito y caducidad:

| Imagen | Hallazgo | Decisión |
| --- | --- | --- |
| `postgres:16-alpine` | `CVE-2025-68121` en la `stdlib` de Go dentro de `/usr/local/bin/gosu` | aceptado hasta el **2027-03-31**, con ámbito de ruta: `gosu` sólo cambia de usuario y hace `exec`, y el binario lo publica el autor de la imagen, así que ningún pin lo cierra |
| `node:22-bookworm-slim` (fase de compilación del frontend) | `CVE-2026-59873` en el `tar` 7.5.11 que npm lleva dentro | aceptado hasta el **2026-12-31**, con ámbito de ruta: no es una dependencia del proyecto ni llega al artefacto, y la etiqueta más reciente sigue trayéndolo |
| `postgres:16` de Debian (imagen de copias) | tres CRITICAL con parche en cuatro paquetes de Perl (`deb13u1`) | **arreglado**: el imagen de copias pasó a `postgres:16-alpine`, con el mismo `pg_dump` 16 y `openssl` añadido en el Dockerfile |

El ámbito de ruta no se puede comprobar desde el repositorio —el fichero vive
dentro de la imagen—, así que se le exige la forma, sin comodines, y el escaneo
demuestra en cada corrida que la entrada sigue suprimiendo algo: una excepción que
ya no tapa nada bloquea la puerta en vez de quedarse pareciendo aprobada. Ese
recuento se lee del JSON del escaneo (`Results[].ExperimentalModifiedFindings` con
`Status: ignored`), no de la tabla. En el SARIF, en cambio, sigue sin aparecer lo
suprimido, ni con `--show-suppressed` (comprobado con 0.74.0), y por eso el informe
publicado se genera sin el fichero de excepciones.

La comprobación es **entrada por entrada**, y sólo concluye cuando hubo informe de
todas las imágenes. Las dos condiciones se midieron:

| Caso | Veredicto | Puerta |
| --- | --- | --- |
| Una tercera entrada señuelo con dos excepciones vivas | `stale` | **falla** nombrando la entrada, no la sección |
| Daemon inalcanzable: 11 escaneos sin informe | `unchecked` | no falla (avisa); falla con `--fail-on-unavailable` |
| Las dos entradas reales, usadas por `gosu` y por el `tar` de npm | `in-use` | pasa |

Mirar el total de la sección en vez de cada entrada dejaba que una entrada muerta
se escondiera detrás de una viva —medido: con las dos excepciones vigentes y una
tercera cuyo ámbito no existe en ninguna imagen, el veredicto era `in-use` y la
puerta callaba—, y cada excepción añadida habría hecho la comprobación más ciega.
En la otra dirección, concluir «obsoleta» desde un daemon caído presionaría para
retirar una excepción válida por un 429 ajeno: por eso un escaneo sin informe deja
la entrada **sin comprobar** en lugar de declararla muerta.

El antes y el después, medidos con el mismo Trivy 0.74.0 y el mismo ignorefile
vacío —misma puerta, misma excepción retirada, sólo cambia la base—:

| Imagen | Resultado de la puerta | Hallazgos |
| --- | --- | --- |
| `nginxinc/nginx-unprivileged:1.27-alpine` (Alpine 3.21.3) | **falla** | 2 CRITICAL con parche: `CVE-2026-31789` en `libcrypto3` y `libssl3` |
| `uvh-web:release-e2e` sobre `1.31-alpine` (Alpine 3.24.1) | **pasa** | 0 CRITICAL, 0 HIGH con parche |

Ese contraste es el control de que la puerta no se ha vuelto vacía: el hallazgo
que la excepción tapaba sigue siendo detectable por el mismo comando, sobre la
misma herramienta y el mismo fichero de supresiones. Retirar la excepción sin
cambiar la base habría puesto el trabajo en rojo, que es lo que una excepción
existe para evitar mientras se arregla la causa.

Arrancar el artefacto, y no sólo escanearlo, es lo que encontró un defecto peor que
el que se estaba cerrando: la imagen del web declaraba `ENTRYPOINT` sin `CMD`, y
eso vacía el `CMD` heredado de la base, así que el contenedor no tenía comando y
salía con código 0 en 143 ms. **Compose no lo llama error** —un contenedor que
termina «bien» es un contenedor terminado— y la puerta de imagen tampoco: mira
paquetes, no procesos. Queda arreglado y con guarda en
`ImageSupplyChainContractTest` (todo Dockerfile con `ENTRYPOINT` declara su `CMD`);
el detalle está en `docs/todos.md` como IMAGE-002. La lección para la promoción es
que un digest verificado dice *qué* artefacto se despliega, no que ese artefacto
arranque: las dos comprobaciones son distintas y hacen falta las dos.

El informe publicado se genera **sin** el fichero de excepciones, a propósito:
Trivy no incluye en el SARIF lo suprimido, ni siquiera con `--show-suppressed`
(comprobado con 0.74.0). Un informe que oculta una excepción no permite revisarla,
así que la excepción vive solo donde se decide, y el informe muestra el problema
completo.

## 4. Lo que no se ha ejecutado

Estas piezas están escritas para que puedan ejecutarse, pero **no se han
ejecutado** en este repositorio todavía. Se marcan así en lugar de darlas por
hechas:

1. **Promoción desde registro.** No hay registro de imágenes del proyecto
   configurado ni credenciales para él. El patrón es: CI publica
   `registro/uvh-api@sha256:…`, y el servidor ejecuta `docker pull
   registro/uvh-api@sha256:…` seguido de `docker compose up -d` con esa
   referencia en `UVH_*_IMAGE` (o en el `image:` del compose de producción).
   Hace falta: un registro, un usuario de solo-lectura para el servidor y una
   decisión sobre retención.
2. **Firma y procedencia.** El paso natural es `docker buildx build
   --provenance=true --sbom=true --push` con firma `cosign sign` sobre el digest,
   y verificación `cosign verify` en el servidor. Requiere una identidad de firma
   (clave o OIDC de GitHub Actions) y que el servidor pueda verificar contra ella.
3. **Despliegue por digest en el servidor.** El compose de producción acepta
   `build:` y `image:` para las mismas dos piezas. En un despliegue real el
   `build:` se sustituye por la referencia con digest, y esa sustitución es lo que
   convierte el digest en la identidad del artefacto desplegado. No ejecutado.

Nada de esto es un requisito para que el sistema funcione: son las piezas que
hacen verificable de punta a punta lo que hoy ya es verificable en CI.

## 5. Cómo reproducirlo en local

```bash
# ¿Cada digest sigue resolviendo? (forma de los pines, sin red)
node scripts/check-image-digests.mjs --offline

# Lo mismo contra el registro, con aviso de deriva y fallo por pin colgado
node scripts/check-image-digests.mjs --json=image-digests.json

# La puerta de imagen, sobre la imagen que se acaba de construir
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:/repo:ro" \
  aquasec/trivy:0.74.0 image --scanners vuln --severity CRITICAL \
  --ignore-unfixed --ignorefile /repo/.trivyignore.yaml --exit-code 1 \
  uvh-api:release-e2e

# SBOM e informe de las dos imágenes, como los produce el trabajo release-e2e
mkdir -p image-evidence
for image in uvh-api:release-e2e uvh-web:release-e2e; do
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/image-evidence:/out" \
    aquasec/trivy:0.74.0 image --format cyclonedx \
    --output "/out/sbom-${image%%:*}.cdx.json" --no-progress "$image"
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/image-evidence:/out" \
    aquasec/trivy:0.74.0 image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
    --format sarif --output "/out/vuln-${image%%:*}.sarif" --no-progress "$image"
done

# El expediente: id de cada imagen, bases fijadas y sha256 de cada informe
node scripts/image-evidence.mjs --dir=image-evidence --out=image-evidence/image-evidence.json \
  --image=uvh-api:release-e2e --dockerfile=docker/php/Dockerfile.production \
  --image=uvh-web:release-e2e --dockerfile=docker/nginx/Dockerfile.production
```

Trivy es un analizador, no un artefacto desplegable: se fija por versión
(`0.74.0`) y no por digest, porque los ficheros de `.github/workflows/` quedan
fuera del alcance de Dependabot y un digest allí envejecería sin que nadie lo
proponga. Sus bases de datos sí se actualizan en cada ejecución, que es lo que da
valor al escaneo. Misma decisión que en `security.yml`.

## 6. Cómo se actualiza un pin

1. Dependabot abre el PR: mueve la etiqueta y el digest, en los ficheros que
   correspondan.
2. El trabajo `digest-integrity` confirma que el digest nuevo resuelve.
3. `release-e2e` reconstruye las dos imágenes y publica el informe y el SBOM del
   artefacto nuevo. Si el informe introduce un CRITICAL con parche, la puerta lo
   detiene.
4. Si la actualización cierra una excepción de `.trivyignore.yaml`, la entrada se
   borra en el mismo PR. El test de contrato falla si una caducidad ya pasó, así
   que el olvido se convierte en un fallo de la suite, no en una deuda silenciosa.

## Referencias

- [`security.md`](security.md) — modelo de amenazas y capas de defensa.
- [`static-analysis.md`](static-analysis.md) — analizadores de código y de
  dependencias, y las puertas que aplican.
- [`deployment.md`](deployment.md) — despliegue y contrato de arranque.
- [`release-evidence-template.md`](release-evidence-template.md) — expediente de
  un candidato a release, con los campos que este runbook produce.
