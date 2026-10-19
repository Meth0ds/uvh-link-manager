# Localización

UVH publica la interfaz en español (idioma fuente) y en inglés británico. El
francés de Francia (`fr-FR`, trato «vous») está registrado de extremo a extremo,
pero **no está publicado**: su catálogo está vacío a propósito y su bandera está
apagada. Ninguna cadena francesa de este árbol debe considerarse aprobada hasta
que exista memoria de traducción revisada.

| Idioma | Código | Prefijo | Estado |
| --- | --- | --- | --- |
| Español | `es` / `es-ES` | `/es/` | Fuente y publicación por defecto |
| Inglés británico | `en-GB` | `/en/` | Publicado |
| Francés de Francia | `fr` / `fr-FR` | `/fr/` | Registrado, sin publicar |

## 1. Ficheros

| Fichero | Papel |
| --- | --- |
| `frontend/src/locale/messages.xlf` | Catálogo extraído del español. Es la fuente. |
| `frontend/src/locale/translations.<locale>.json` | Memoria de copia aprobada: `sourceHash` + texto redactado. |
| `frontend/src/locale/messages.<locale>.xlf` | XLIFF generado desde la memoria. No se edita a mano. |
| `shared/localisation/routes.json` | Rutas públicas por idioma, compartidas por Angular, Laravel, Nginx y sitemap. |
| `frontend/src/locale/document-copy.json` | Texto del fallback sin JavaScript, por idioma. |
| `backend-laravel/lang/<locale>/` | Catálogos de correo, notificaciones, API y páginas de visitante. |

`messages.en-GB.xlf` tiene 4.099 unidades aprobadas. `messages.fr.xlf` contiene
las mismas unidades **sin `<target>`**: es el esqueleto que la redacción irá
rellenando.

## 2. Herramientas

Todas aceptan `--locale=<código>`; sin el parámetro usan `en-GB`, así que los
comandos históricos no cambian.

```bash
# Siguiente lote pendiente y aplicación del texto redactado.
node scripts/localisation-catalogue.mjs next --locale=fr --limit=250
node scripts/localisation-catalogue.mjs apply-next --locale=fr --file=.planning/french/batches/01.txt

# Generar el XLIFF y comprobar la memoria.
node scripts/localisation-catalogue.mjs generate --locale=fr
node scripts/localisation-catalogue.mjs check --locale=fr --draft
node scripts/localisation-integrity.mjs --locale=fr --draft
```

Desde `frontend/`, los atajos son `npm run i18n:next:fr`,
`npm run i18n:apply-next:fr`, `npm run i18n:generate:fr`,
`npm run i18n:status:fr` y `npm run i18n:check:fr`.

`apply` rechaza texto vacío y cambios en los marcadores `⟦n⟧`. La comprobación
de integridad rechaza placeholders alterados, marcado inesperado, ids
desconocidos y un `trgLang` que no coincida con el locale pedido.

`--draft` **solo** permite que falte el `<target>` de una unidad todavía sin
redactar. No relaja nada más: un error estructural sigue fallando. La
publicación (`npm run i18n:check`, sin `--draft`) exige el 100 % de la memoria.

## 3. Cómo se añade o publica un idioma

1. Añadir el idioma a `shared/localisation/routes.json` con sus slugs.
2. Registrarlo en `frontend/angular.json` (`i18n.locales`) y en
   `frontend/src/app/core/localisation/locale.ts`
   (`SUPPORTED_LANGUAGES`, `LANGUAGE_TAGS`).
3. Redactar el catálogo con las herramientas anteriores. Sin traducción
   automática: la memoria solo acepta texto escrito y revisado por una persona.
4. Traducir `document-copy.json`, los catálogos Laravel y, si aplica, las copias
   legales inmutables.
5. Añadir el idioma a `RELEASED_LANGUAGES` (selector y `hreflang`) y encender su
   bandera de backend.

El pipeline no tiene listas `es|en` propias: Nginx, el servidor de desarrollo,
el prerender y el sitemap derivan los idiomas del manifiesto o de
`Language::SUPPORTED`.

## 4. Interruptores de publicación

| Interruptor | Efecto | Defecto |
| --- | --- | --- |
| `RELEASED_LANGUAGES` (`locale.ts`) | Idiomas que el selector ofrece y que `hreflang` anuncia. | `es`, `en`, `fr` |
| `UVH_FRENCH_ENABLED` | Negociación, cookie, preferencia de cuenta, reserva del alias `fr`, sitemap/robots y tercer compilador de desarrollo. | `false` |
| `LOCALISATION_ENABLED` | Habilita la localización en general. | `false` |

Con `UVH_FRENCH_ENABLED=false`, `/fr` no se sirve desde el servidor de
desarrollo, el backend no negocia francés y `php artisan uvh:localisation-audit`
no reserva el alias. Al encenderlo, el comando exige que exista
`backend-laravel/lang/fr/`; si falta, falla en vez de publicar una interfaz
francesa con mensajes en español. Para el entorno local completo se encienden
ambas banderas:

```bash
UVH_FRENCH_ENABLED=true LOCALISATION_ENABLED=true \
  docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d
UVH_FRENCH_ENABLED=true npm start
```

El francés quedó publicado el 2026-10-19 por decisión del titular. La revisión
nativa y jurídica del texto sigue pendiente; la publicación técnica no la
sustituye.

## 5. Build

`npm run build` compila `es`, `en-GB` y `fr` (`production.localize`) y finaliza
21 documentos. Las configuraciones explícitas son:

- `fr`: build estricto del francés; falla mientras quede una unidad sin traducir.
- `fr-draft`: mismo build con `i18nMissingTranslation: "warning"`, para validar
  rutas, prerender, Nginx y el finalizador antes de tener el texto.
- `development-fr`: compilador CSR para `/fr/`, usado solo con la bandera activa.

Ejemplo de comprobación de fontanería sin texto francés:

```bash
cd frontend
node scripts/build.mjs --configuration fr-draft --output-path=dist/uvh-fr-draft
```

Genera seis rutas prerenderizadas (`/fr/aide`, `/fr/statut`, las tres legales y
la portada) y siete documentos finalizados. No es un release: el texto visible
cae al español mientras no exista `<target>`.

## 6. Rutas y legal

| Página | Español | Inglés | Francés |
| --- | --- | --- | --- |
| Inicio | `/` | `/` | `/` |
| Ayuda | `/ayuda` | `/help` | `/aide` |
| Estado | `/estado` | `/status` | `/statut` |
| Términos | `/legal/terminos` | `/legal/terms` | `/legal/conditions` |
| Privacidad | `/legal/privacidad` | `/legal/privacy` | `/legal/confidentialite` |
| Denuncias | `/legal/denuncias` | `/legal/report-abuse` | `/legal/signaler-contenu` |

Las copias inmutables viven en
`frontend/public/legal/versions/<versión>/<idioma>/<documento>.html`. **La
versión no cambia al añadir un idioma**: se publica la traducción bajo la misma
versión (`2026-10-09`), se añade su `path` y `sha256` a
`shared/localisation/legal-documents.json` y no se fuerza una nueva aceptación
a quien ya aceptó el texto español.

## 7. Estado actual del francés (2026-10-19)

- `messages.fr.xlf`: **4.099 de 4.099** unidades con `<target>`, redactadas a
  mano. `check --locale fr` (estricto) pasa.
- `translations.fr.json`: memoria completa redactada a mano, **pendiente de
  revisión nativa** antes de declararla aprobada.
- `backend-laravel/lang/fr/`: seis catálogos (973 claves) redactados a mano, con
  paridad de claves y marcadores verificada. Pendiente de revisión nativa.
- Documentos legales: copias francesas en
  `frontend/public/legal/versions/2026-10-09/fr/` (`terms.html`,
  `privacy.html` y `manifest.json`), generadas desde el build `fr` y registradas
  en `shared/localisation/legal-documents.json`.
- `shared/localisation/legal-documents.json`: entradas `fr` para `terms` y
  `privacy_notice`, con sus hashes.
- `document-copy.json`: cadenas francesas del fallback sin JavaScript; el build
  de producción las finaliza junto a las de español e inglés.
- El selector ofrece «Français» porque `RELEASED_LANGUAGES` incluye `fr`.

**Decisión del titular:** el idioma se publicó el 2026-10-19. La revisión nativa
y jurídica del texto francés sigue pendiente y no se declara aprobada; antes de
un despliegue público hay que registrarla.

## 8. Verificación

```bash
cd frontend
npm run i18n:extract
npm run i18n:check        # en-GB completo
npm run i18n:check:fr     # fr en borrador
npm run i18n:test
npm run start:test
npm run lint && npm run typecheck
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

En backend, `php artisan test` contra `uvh_test`, Pint y PHPStan. La
publicación técnica del francés ya está hecha; la revisión nativa y jurídica
sigue pendiente y debe registrarse antes de un despliegue público.
