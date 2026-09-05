# Informe de seguridad — Registro, hCaptcha y debilidad de contraseña (UVH)

**Fecha:** 2026-08-30 · **Alcance:** análisis estático + implementación del hallazgo H-1 (ver §8)
**Superficies analizadas:** `backend-laravel/app/Http/Controllers/AuthController.php`, `backend-laravel/app/Support/HCaptcha.php`, `backend-laravel/app/Support/ProductionSecurity.php`, `backend-laravel/app/Providers/AppServiceProvider.php`, `backend-laravel/routes/api.php`, `backend-laravel/config/uvh.php`, `frontend/public/hcaptcha-frame.html`, `frontend/public/hcaptcha-frame.v1.js`, bundle compilado `frontend/dist/uvh/browser/chunk-DWH43BZn2.js` (widget captcha, medidor de contraseña, formulario de registro) y `docker/nginx/uvh.conf.template`.

---

## 1. Veredicto ejecutivo

**El sistema no está "a medias": está terminado y en general muy bien diseñado.** El flujo de registro tiene anti-enumeración con hash señuelo, honeypot, tokens de email de un solo uso con hash SHA-256 en BD, verificación obligatoria antes de sesión, bloqueo por filas en transacciones y auditoría. La verificación hCaptcha es 100 % server-side, dentro de un iframe aislado con CSP propia, y producción **arranca en modo fail-closed si las claves son las de prueba**. El medidor de contraseña es local, heurístico y **no bloquea contraseñas débiles en el backend** — esa es la carencia principal (hallazgo H-1).

| # | Hallazgo | Riesgo | Estado |
|---|----------|--------|--------|
| H-1 | La política de contraseñas solo exige longitud 10–72 en el backend; la debilidad (comunes/patrones/datos personales) se evalúa **solo** en el navegador y es eludible | **Alto** | **IMPLEMENTADO** (§8) |
| H-2 | El bridge postMessage del host no valida `event.origin` (solo identidad de `source`) | Bajo | Pendiente |
| H-3 | Sin verificación de `hostname` en la respuesta de siteverify | Bajo | Pendiente |
| H-4 | El medidor usa heurística propia, no listas de filtración (HIBP) ni zxcvbn | Bajo | Mejora |
| H-5 | Local/desarrollo corre con claves de prueba de hCaptcha (fail-open local) | Informativo | Aceptado |
| H-6 | `Math.random()` como fallback del canal del captcha | Informativo | Aceptado |

---

## 2. Flujo de registro — lo que está bien hecho

`POST /api/v1/auth/register` (AuthController::register), con CSRF propio (`uvh.csrf`) y rate-limit `uvh-register` (10 req/60 min por IP, `config('uvh.rate_limits.register')`).

1. **Validación de entrada:** nombre (2–80, sin caracteres de control), email (≤254, `FILTER_VALIDATE_EMAIL`), contraseña (10–72), aceptación de términos con versión fijada (`hash_equals` contra `2026-08-19`) y honeypot `website` que debe llegar vacío → 422 genérico.
2. **Captcha antes de tocar la BD:** `captchaError()` verifica el token contra siteverify; 503 si el proveedor no está disponible (fail-closed ante caída de hCaptcha), 422 genérico si es inválido, sin filtrar si el token estaba caducado, canjeado o malformado.
3. **Anti-enumeración sólido:** para emails ya registrados responde byte a byte igual que un alta nueva (`201` + `{"user":null}`), ejecuta un `Hash::make` con coste real (constante `DUMMY_PASSWORD_HASH`, bcrypt cost 12) para igualar el tiempo en `login`/`changeRegistrationEmail`, y registra `auth.register_duplicate` en auditoría. Además, la condición de carrera (dos registros simultáneos del mismo email) se resuelve capturando el `23505` (unique violation) de PostgreSQL y devolviendo la misma respuesta.
4. **Verificación de email obligatoria:** token de 32 bytes aleatorios (`Ids::randomToken`), guardado **solo como SHA-256** en `email_tokens`, caducidad 24 h, un solo uso consumido con `lockForUpdate` dentro de transacción; al verificar se **revocan todas las sesiones** previas del usuario. Sin email verificado no hay sesión (login devuelve 403 antes de emitir challenge MFA).
5. **Atomicidad del alta:** usuario + workspace + membresía owner + cuota en una transacción.
6. **Cambio de email pre-verificación** (`change-registration-email`): exige contraseña + captcha, bloquea fila, borra tokens previos, revoca sesiones, y mantiene el mismo contrato anti-enumeración con hash señuelo.
7. **Auditoría** de cada paso (`auth.register`, `auth.terms_accepted`, `auth.email_delivery_failed`, etc.).

## 3. Verificación hCaptcha — arquitectura

### 3.1 Backend (`HCaptcha.php`)
- El token se valida por forma (≤8 KB, sin caracteres de control) y se envía a `https://api.hcaptcha.com/siteverify` con `secret`, `response`, **`sitekey` (evita canje de tokens resueltos para otro sitekey)** y `remoteip` cuando la IP es válida.
- **Sin reintentos automáticos** (correcto: el token es de un solo uso y un reintento tras fallo ambiguo lo invalidaría).
- Clasificación triestatal: `VALID` / `INVALID` / `UNAVAILABLE`. Los códigos de error de configuración del proveedor (`invalid-input-secret`, `sitekey-secret-mismatch`…) degradan a `UNAVAILABLE` → **503 fail-closed**, no a 422. El frontend muestra "Verificación no disponible" con botón Reintentar.
- El secreto nunca sale del servidor; los tokens no se registran en logs.

### 3.2 Frontend — iframe aislado (diseño destacable)
- El SDK de hCaptcha **no se carga en la SPA**: vive en `/hcaptcha-frame.html`, un documento propio con CSP estricta (`default-src 'none'`, solo hcaptcha.com en script/frame/connect), `frame-ancestors 'self'`, X-Frame-Options SAMEORIGIN y `no-referrer`. El vendor script no puede leer el DOM del formulario (email/contraseña).
- **Canal anti-inyección:** el host genera un `channel` de 128 bits (`crypto.getRandomValues`) y lo exige en ambos sentidos; el frame valida `channel` con `/^[a-f0-9]{32}$/` y el sitekey con `/^[A-Za-z0-9_-]{20,200}$/`; los mensajes del frame llevan ese channel; los tokens se limitan a 8 KB.
- El host filtra por **identidad de la fuente** (`event.source === iframe.contentWindow`), con timeout de carga de 12 s y recarga del frame como recuperación. La SPA nunca ve el SDK ni recibe DOM del frame, solo el token.

### 3.3 Aprovisionamiento de claves y fail-closed de producción
- `/api/v1/config` solo entrega el sitekey **si `HCaptcha::configured()`**; si no, `provider: null` y la UI muestra "Verificación no disponible".
- **`ProductionSecurity::validHCaptchaConfiguration()` bloquea el arranque en producción** si el sitekey/secret son los de prueba (`10000000-…-000000000001` / `0x000…000`), si contienen marcadores tipo `change-me`, o si superan longitudes no plausibles. Esto elimina el clásico fallo de desplegar con claves de demo.
- ⚠️ El `.env` local usa precisamente las claves de prueba (H-5): comportamiento esperado en desarrollo (siteverify real devuelve éxito para esos pases), pero conviene saber que **en local el captcha no protege de nada** y que `ProductionSecurity` es la única barrera contra un despliegue con esas claves.

## 4. Sistema de debilidad de contraseña

### 4.1 Backend — lo que existe
- **Única regla dura:** `strlen >= 10` y `<= 72` (límite de bcrypt), en `register`, `reset-password` y `change-password`.
- Hash bcrypt cost 12; producción exige rounds 12–16 y rechaza arrancar fuera de rango.
- Comparaciones con `Hash::check` + hash señuelo para uniformidad temporal.

### 4.2 Frontend — medidor heurístico (solo informativo)
`Tt(password, name, email)` en el bundle compilado:
- Normaliza NFKD, quita acentos y pasa a minúsculas (`H()`).
- Penaliza: palabras comunes (`password`, `contrasena`, `qwerty`, `admin`, `welcome`, `bienvenido`, `letmein`, `iloveyou`, `123456`, `uvh`) −38; secuencias/repeticiones (`0123`, `abcd`, `qwer`, `asdf`, `/(.)\1{2,}/u`) −24; **datos personales** (nombre o parte local del email del propio usuario) −28.
- Puntúa 0–100: base longitud×3 (tope 42) + clases de caracteres×9 + diversidad×12, bonus +8/+8 por ≥14/≥18 caracteres; si <10 caracteres el score queda topado a 24.
- Etiquetas: ≥82 Fuerte, ≥58 Buena, ≥30 Mejorable, <30 Débil; requisitos visibles (10+, mayús/minús, número o símbolo, sin datos personales ni patrones) y feedback contextual.
- **El botón "Crear cuenta" solo exige `registerForm.valid && captchaToken`**: los requisitos de mayúsculas/número/símbolo y la puntuación son orientativos; nadie los fuerza.

### 4.3 Evaluación
La UI es honesta ("Sólo en tu navegador") y la UX es buena, pero **un atacante con curl puede registrarse con `aaaaaaaaaaaa` (10 caracteres)** y pasa: no hay bloqueo server-side de contraseñas triviales, ni comprobación contra listas de filtraciones (HIBP k-anonymity), ni prohibición de contraseña == email, ni normalización unicode en el backend. Para un objetivo declarado de "extremadamente seguro", H-1 es la brecha entre lo que promete la UI y lo que garantiza la API.

## 5. Hallazgos detallados y recomendaciones

### H-1 (Alto) — La debilidad de contraseña no se aplica en el servidor
**Evidencia:** `AuthController::validPassword()` = solo longitud. El medidor `Tt()` vive únicamente en el bundle JS.
**Riesgo:** registro/reseteo con contraseñas triviales; la UI sugiere pero no impone; el backend es la única frontera real.
**Recomendación:** portar la heurística a PHP (`app/Support/PasswordStrength.php`) y aplicar en `register`, `resetPassword` y `changePassword`: rechazar `common || patterned || personal || score < 30` (o como mínimo las contraseñas comunes y las que contienen el email/nombre). Añadir bloqueo de top-contraseñas (lista local tipo top-10k o HIBP range API con k-anonymity — el prefijo del hash sale del servidor, el sufijo lo aporta el cliente, sin exponer la contraseña). Mensaje de error genérico para no ayudar al atacante. Tests unitarios con casos límite (unicode, mayúsculas, email como contraseña).

### H-2 (Bajo) — `event.origin` sin validar en el bridge del host
**Evidencia:** `onMessage` filtra por `e.source === this.frame.nativeElement.contentWindow` y `e.data.source`, pero no comprueba `e.origin`.
**Riesgo:** bajo — `event.source` solo puede ser el propio iframe (mismo origen, sandbox por CSP), y el channel de 128 bits evita suplantación. Queda como defensa en profundidad.
**Recomendación:** añadir `if (e.origin !== location.origin) return;` en host y frame. En el frame, además, restringir el destino de `postMessage` a `location.origin` en lugar de `'*'`.

### H-3 (Bajo) — No se valida `hostname` en la respuesta de siteverify
**Evidencia:** `HCaptcha::verify()` comprueba `success` pero ignora `hostname` del payload de hCaptcha.
**Riesgo:** bajo (ya se fija `sitekey` en la petición, que es el control principal), pero hCaptcha recomienda verificar que el token se resolvió para tu dominio.
**Recomendación:** en producción, comprobar `hostname` ∈ {`config('uvh.app_host')`, `config('uvh.public_host')`} (o lista configurada) cuando esté presente; degradar a `UNAVAILABLE` si no coincide.

### H-4 (Bajo/Mejora) — Heurística propia en vez de estándares
zxcvbn (o `bjeavons/zxcvbn-php`) estima crack-time real; el medidor actual es una puntuación ad-hoc razonable pero sin base empírica. Si se porta al backend (H-1), valorar `zxcvbn-php` + HIBP para que la misma lógica sirva en UI y API.

### H-5 (Informativo) — Claves de prueba en local
`HCAPTCHA_SITE_KEY=10000000-…` y `HCAPTCHA_SECRET=0x000…` en `.env`: siteverify acepta cualquier token con estas claves. Correcto para desarrollo (los tests además falsifican siteverify con `Http::fake`), pero conviene documentar que local ≠ protección real, y confiar en el bloqueo de arranque de `ProductionSecurity` para producción.

### H-6 (Informativo) — `Math.random()` como fallback del canal
`createChannel()` usa `crypto.getRandomValues` y solo si no existe recurre a `Math.random()`. El channel no es un secreto de seguridad (es un nonce de correlación), así que el impacto es nulo; podría simplemente fallar si no hay crypto moderno.

## 6. Cobertura de tests

- `tests/TestCase.php` fuerza claves de prueba y **falsifica siteverify** (`Http::fake`) — los tests de registro no ejercitan la integración real con hCaptcha (razonable en CI, pero no hay test unitario de `HCaptcha::verify()` con respuestas `success:false`, códigos de configuración, timeouts ni respuestas malformadas).
- `ApiParityTest` cubre el contrato de registro (201 + `{"user":null}`, duplicados, login, captcha payload).
- **Faltan:** tests de `validPassword` (límites 9/10/72/73), de rechazo de contraseñas débiles (cuando exista H-1), y unitarios de `HCaptcha` (tri-estado y fail-closed).

## 8. Implementación de H-1 (2026-08-30)

**Nueva clase `app/Support/PasswordStrength.php`** — puerto fiel de la heurística del medidor frontend (`Tt()` del bundle: mismas listas comunes/patrón, mismo plegado NFKD, misma puntuación 0–100, mismos bandas UI), más una regla de aceptación server-side **más estricta que la UI**:

- `isAcceptable(password, name, email)`: longitud 10–72; **rechazo duro** de `common` (substrings comunes), de toda variante plegada de palabras de diccionario (`Password123!`, `SuperMan-99` — regex `COMMON_WORD_REJECT`), y de todo `patterned` (walks de teclado, secuencias, repeticiones — lo primero que enumeran las wordlists); resto exige score ≥ 30. `personal` rechaza vía score (una frase larga que contiene el nombre puede ser legítima).
- Aplicada en **`register`** (con nombre+email del solicitante), **`reset-password`** y **`change-password`** (con nombre+email del usuario). Error genérico `422 "La contraseña es demasiado débil"` — sin detalle que ayude a ajustar ataques. NO aplicada en `change-registration-email` (la contraseña ahí solo autentica, no se guarda).
- **Tests:** `tests/Unit/PasswordStrengthTest.php` (19 tests: límites 9/10/72/73, hard-rejects comunes con variantes mayúsculas/símbolos, datos personales nombre/email, acentos NFKD, bandas de score) y `tests/Feature/PasswordPolicyTest.php` (5 tests: rechazo en los tres endpoints, token de reset NO consumido por intento rechazado, contraseña vieja intacta tras rechazo). Suite completa: **69 tests, 553 aserciones, OK**. Pint limpio.
- `ApiParityTest` actualizado: `PASSWORD = 'tiovivo-cobrizo-astilla-42'` (la anterior contenía "password" → ahora sería rechazada). `SsrfTest` siembra hashes directamente en BD — sin cambio.
- Nota de despliegue: el contenedor corre con `DB_DATABASE=uvh_local`; la suite exige `uvh_test` (guard de seguridad en `TestCase`). Ejecución: `docker compose exec -e DB_DATABASE=uvh_test app vendor/bin/phpunit`.

## 9. Unificación del medidor UI/API (2026-08-30, seguimiento a H-1)

**Fuente única de verdad:** la política vive solo en `PasswordStrength` (PHP). Constantes ahora públicas y exportables: `COMMON_SUBSTRINGS`, `PATTERN_SEQUENCES`, `REJECT_WORDS` (el regex de rechazo pasó a lista plana compartible; `contrase` cubre `contrasena`/`contraseña` tras el plegado), `FEEDBACK` (mapa de textos), `MIN_LENGTH`/`MAX_LENGTH`, `ACCEPT_MIN_SCORE`, `BANDS`.

- **Nuevo comando `php artisan uvh:emit-password-policy`** (`app/Console/Commands/EmitPasswordPolicy.php`): serializa todas las constantes públicas a JSON determinista (con checksum sha256 en el encabezado) y genera `uvh-password-policy.v1.js` — un script sin dependencias que expone `window.uvhPasswordPolicy.{assess,isAcceptable,strengthLabel,policy}`, espejo exacto de `assess()`/`isAcceptable()` PHP. Salida en `backend-laravel/storage/app/password-policy/` (el contenedor no ve `frontend/`); se copia a `frontend/public/` y `frontend/dist/uvh/browser/`.
- **Frontend conectado** (este checkout no puede recompilar, así que se parcheó el build): `<script src="/uvh-password-policy.v1.js">` añadido a `dist/uvh/browser/index.html` (antes del bundle Angular) y el punto de entrada del medidor del chunk (`function Tt(o,c,e){`) ahora delega primero en `globalThis.uvhPasswordPolicy.assess(...)` con la heurística original como fallback. Mismo parche aplicable a `frontend/public/index.html` cuando exista el checkout con fuentes.
- **Paridad demostrada:** fixture de 18 casos generado desde PHP y ejecutado contra el JS emitido en sandbox Node — score, flags (common/personal/patterned), texto de feedback y decisión `isAcceptable` idénticos en 18/18 casos (incluye acentos NFKD, unicode, límites de longitud, variantes mayúsculas/símbolos).
- **Guardia de deriva:** `tests/Feature/EmitPasswordPolicyTest.php` falla si el bundle comprometido no coincide byte a byte con la política PHP vigente (recordatorio de regenerar y copiar). Verificado en preview: la SPA carga `/uvh-password-policy.v1.js` (200), `window.uvhPasswordPolicy` responde idéntico al backend y el medidor en vivo consume la copia compartida.
- Regeneración tras cualquier cambio de política: `php artisan uvh:emit-password-policy` → copiar `storage/app/password-policy/uvh-password-policy.v1.js` a `frontend/public/` y `frontend/dist/uvh/browser/` (el test de deriva fallará si se olvida).

## 10. Conclusión

- **Registro:** implementación madura y consistente; anti-enumeración y gestión de tokens por encima del estándar habitual. No está "sin terminar".
- **hCaptcha:** verificación server-side correcta, iframe aislado con CSP y canal anti-inyección, fail-closed ante indisponibilidad y bloqueo de arranque con claves de prueba en producción. Arquitectura poco común y de alta calidad.
- **Debilidad de contraseña:** ~~único punto donde la promesa de seguridad no se cumple en el servidor~~ **cerrado (H-1 implementado y verificado)**; UI y API ahora comparten la misma heurística generada desde PHP (§9). Quedan H-2/H-3 como endurecimiento barato opcional.
