# Revisión de la tanda — 24 de septiembre de 2026

Alcance: los seis commits subidos hoy a `main` (`629edbd..bbc4eff`) y el trabajo
nuevo sin commitear que los completa. Agrupado por hallazgo de la reseña, con
los puntos que conviene mirar con criterio propio antes de dar la tanda por
buena. Nada de esto sustituye tu revisión: son los sitios donde un cambio puede
ser correcto por separado y crear una propiedad falsa combinado.

---

## Hallazgo 1 — El claim legible del secreto de edición (oráculo de enumeración)

**Lo que había.** `82b0514` creó `RegistrationEdit` firmado sin cifrar:
`base64url({"v":1,"uid":"0000000127","sv":"001"}).exp.mac`. El uid real era
pequeño y secuencial; el señuelo, `random_int(1, 999_999_999)`. Cualquier
cliente HTTP decodificaba el `Set-Cookie` y separaba destinos libres de ocupados.

**Cómo se arregló.**
- `bbc4eff` → `app/Support/SealedToken.php` (AES-256-GCM, nonce 96b, tag 128b,
  clave derivada por HKDF con dominio propio) y `RegistrationEdit` pasó a sellar
  su claim de **ancho fijo** (`e` 13, `pid` 10, `sv` 3). Real y señuelo producen
  ciphertexts del mismo largo, en todos los desenlaces, siempre.
- Hoy (sin commitear) → el sello lleva **key-id dentro**, cubierto por la tag de
  GCM como AAD (`SealedToken`, `UvhCrypto::keyId`/`secretByKeyId`).

**Qué revisar con lupa.**
- `RegistrationEdit::CLAIM_PATTERN` y el `sprintf` de `seal()`: los anchos fijos
  SON la definición de la indistinguibilidad (test
  `RegistrationEditTest::test_real_and_decoy_secrets_are_indistinguishable_from_the_outside`).
- El docblock de `SealedToken` admite que el key-id público revela QUÉ clave del
  keyring selló cada blob (no la afirmación, no su edad, no la rama). Si
  consideras que esa etiqueta no debería ser observable, hay que revertirla al
  ensayo por clave; es una decisión de opacidad, no de corrección.

## Hallazgo 2 — TOCTOU en `changeRegistrationEmail`

**Lo que había.** `82b0514` validaba el secreto antes del lock; dos peticiones
con el mismo secreto lo gastaban dos veces.

**Cómo se arregló.** `bbc4eff` → la validación se repite **contra la fila ya
bloqueada** (`AuthController::changeRegistrationEmail`, lock → check → use), y
`RegistrationEditConcurrencyTest` lo prueba con dos procesos reales, una barrera
de reloj compartida y un trigger que duerme la rotación 1,5 s **dentro** de la
transacción para forzar la ventana TOCTOU en vez de esperar a que salga.

**Qué revisar con lupa.**
- El harness fuerza el interleaving; si alguien retira el trigger, el test sigue
  en verde sin probar nada. El docblock del trigger está para eso.
- Hoy la fila bloqueada ya no es un `User` sino un `PendingRegistration`; la
  disciplina de locks quedó documentada en `lockEmailAddress` (advisory de la
  dirección justo antes de escribirla; quien lo sostiene no vuelve a esperar).

## Hallazgo 3 — Identidad/legal heredada del primer registrante (pre-hijack)

**Lo que había.** `register` creaba fila de usuario con nombre, contraseña,
workspace `Workspace de …` y `legal_acceptances` del primer registrante; si el
atacante se registraba primero en la dirección de la víctima, ella heredaba todo
eso al activar.

**Cómo se arregló — en dos capas.**
1. `bbc4eff` (ya subida): la activación decide nombre, contraseña y aceptación
   legal; `verifyEmail` los sustituye y re-estampa.
2. **Hoy (sin commitear): la versión «de verdad».** Nuevo `pending_registrations`
   (migración `2026_09_24_000001_create_pending_registrations.php`): hasta que el
   buzón se demuestra **no existe fila de usuario** —ni nombre, ni workspace, ni
   aceptaciones que heredar—. La activación crea la cuenta desde cero. Los
   usuarios sin verificar del modelo anterior se convierten en filas pendientes
   (con su bearer vivo reencadenado) y la migración se detiene si alguno tiene
   enlaces propios en vez de borrar trabajo ajeno.
   - **No viaja nada más** que la dirección: la propuesta de contraseña se
     retiró al cerrar la señal de ciclo de vida (ver «Qué revisar con lupa»).
     La inscripción la valida —mismo contrato que la activación— como feedback
     temprano del formulario, pero no la persiste.

**Qué revisar con lupa.**
- **La señal de ciclo de vida está cerrada** (decisión tomada hoy, sobre tu
  indicación): `login` ya no distingue un registro pendiente de una dirección
  desconocida —mismo `401` «Credenciales incorrectas», mismo bcrypt de
  señuelo—, así que el servidor ya no responde «sigue pendiente / ya no»
  (403 vs 401). Precio asumido: quien intenta entrar antes de verificar ve
  «Credenciales incorrectas». La vuelta al buzón se rediseñó en consecuencia:
  la entrada «Reenviar verificación» es ahora una acción pública **siempre
  visible** en el panel de acceso —junto a «¿Olvidaste tu contraseña?», pide
  solo la dirección— y la pantalla «Revisa tu email» conserva la suya. El
  contrato de `auth.spec.ts` cambió con ella (401 uniforme + entrada siempre
  disponible + reenvío con respuesta genérica).
- `verifyEmail` ya no revoca sesiones espurias porque no puede haberlas (la fila
  nace en la activación). Es un cambio de defensa en profundidad a estructural.

## Hallazgo 4 — `.env.production.example` sin las dos líneas de `REGISTRATION_EDIT_*`

**Estado: pendiente de tu mano** (la plantilla está bloqueada para las
herramientas). PHPUnit sigue en 575/577; los dos fallos son exactamente este
hallazgo. Pega junto a `PENDING_INTENT_COOKIE`:

```env
REGISTRATION_EDIT_COOKIE=__Host-uvh_registration_edit
REGISTRATION_EDIT_TTL_HOURS=24
```

**Qué revisar con lupa:** nada más que pegarlas tal cual; `ProductionSecurity`
exige el prefijo `__Host-` y TTL 1–24, y `EnvTemplateContractTest` valida la
coherencia plantilla↔código en ambos sentidos.

## Hallazgo 5 — `OwnedMutations` incompleto (ABA en `add`, publicación sin dueño)

**Lo que había.** `bc51074` creó `OwnedMutations` para 7 componentes, pero
`DomainsComponent.add()` seguía con `adding.set(...)` y los efectos post-await
de `LinkTrash.purge()` se publicaban aunque el contexto hubiera cambiado.

**Cómo se arregló.** `bbc4eff` → los 7 componentes con `OwnedMutations` como
dueño de «quién puede publicar el resultado» (patrón `await mutation; if
(!target.isCurrent() || !this.mutations.isCurrent(action)) return; publish;`),
con specs (`domains.component.spec.ts` +92, `link-trash.component.spec.ts`,
`owned-mutations.spec.ts`).

**Qué revisar con lupa.**
- `frontend/src/app/panel/**` — que ningún efecto observable (snackbar, cierre de
  diálogo, `load()`) quede fuera del guard `isCurrent()`.
- La separación de `OwnedMutations.isCurrent(action)` frente a
  `target.isCurrent()`: los dos deben fallar juntos o la ABA reaparece.

## Hallazgo 6 — `Retry-After` del MFA

**Lo que había.** `MfaAttempts::tooManyResponse` anunciaba el máximo global en
vez del temporizador del nivel realmente bloqueado; docblock pegado al `use`.

**Cómo se arregló.** `79f63e5` (cálculo por niveles) + `bbc4eff` (test de tiempo
congelado con la aserción exacta —19 fallos globales + 1 de propósito nuevo →
global bloqueado, propósito no, `Retry-After` = solo el temporizador global— y
formato del docblock).

**Qué revisar con lupa.** `MfaStepUpBudgetTest::retry after announces only the
level that is actually blocked` — la aserción exacta es el contrato; si cambian
los temporizadores, cambia el número esperado.

## Hallazgo 7 — `verify-local.mjs` sobreprometía equivalencia con CI

**Cómo se arregló.** `bbc4eff` → `npm ci` + `composer install
--no-interaction --prefer-dist --no-progress` al inicio de cada mitad, de modo
que el script valida contra el lockfile y no contra `node_modules`/`vendor`
obsoletos.

**Qué revisar con lupa.** La cabecera del script: la promesa ahora («reproduce
los pasos de CI») debe coincidir con lo que ejecuta, paso a paso.

## Hallazgo 8 — `cache:clear` en el arnés E2E más ancho que su comentario

**Cómo se arregló.** `5ef03ae` + `bbc4eff` → comando de solo-tests
`uvh:e2e:reset-limits` que borra únicamente los namespaces de presupuestos
(`limiter:`, `uvh:mfa:attempts:`, …), con `E2eResetLimitsTest` que fija «borra
presupuestos y solo presupuestos» y, tras la corrección de hoy, «la cadena
failover se resetea a través de sus miembros y nunca a sí misma».

**Qué revisar con lupa.** El inventario de namespaces del comando: si se añade
un presupuesto nuevo y no se lista ahí, el E2E lo arrastra entre tests.

---

## Trabajo nuevo de hoy (sin commitear) — a la espera de tu criterio

### Rotación de claves del keyring de sellos (key-id dentro del sello)

`UvhCrypto::keyId()` deriva una etiqueta pública de 4 bytes por clave; `SealedToken`
y `SignedToken` la llevan **dentro del sello** (AAD en GCM; segmento cubierto por
la MAC), de modo que abrir nombra su clave en vez de ensayar el keyring completo.
La doble clave durante la ventana de rotación ya existía (`APP_SECRET_PREVIOUS` +
`APP_SECRET_ROTATION_UNTIL`); esto le pone identidad explícita a cada sello.
Formatos anteriores (sin etiqueta) siguen abriendo durante la transición.

- Ficheros: `UvhCrypto.php`, `SealedToken.php`, `SignedToken.php`,
  `tests/Feature/SealKeyringTest.php` (4 contratos nuevos).
- **Qué revisar con lupa:** el fallback al formato sin key-id es camino de
  transición — hay que retirarlo cuando no quede ningún sello viejo en vuelo
  (el más longevo es un aparcadero de 7 días).

### `PendingRegistration` separado de `User` (hallazgo 3 «de verdad»)

- Migración `2026_09_24_000001` + modelo `PendingRegistration`; `email_tokens`
  con `pending_registration_id` + `CHECK` exactamente-un-dueño; conversión de los
  usuarios sin verificar existentes.
- `AuthController`: `register` crea fila pendiente (sin identidad legal ni
  workspace), `verifyEmail` crea la cuenta desde cero con lo que decide el buzón,
  `changeRegistrationEmail` y `resendVerification` operan sobre la fila pendiente,
  y `confirmEmailChange` ya no puede reclamar una dirección que un registro
  pendiente posee (dejaría dos titulares).
- `RegistrationEdit` v2 (`pid`), `MailDeliveryEligibility` (verify vive contra
  `pending_registrations`), `UvhHousekeeping` purga registros de 30 días.
- **Qué revisar con lupa:** (1) la disciplina de locks documentada en
  `lockEmailAddress`; (2) la migración de datos — se detiene ante un registro sin
  verificar con enlaces propios en vez de decidir por ti; (3) que la fila
  pendiente ya no guarda propuesta de contraseña —retirada al cerrar la señal
  de ciclo de vida; ver Hallazgo 3—.

### Señal de ciclo de vida cerrada y «Reenviar verificación» rediseñado

Sobre tu indicación de hoy (2ª pasada): se retiró la propuesta de contraseña de
`pending_registrations` —`register` la sigue validando como feedback temprano
con el mismo contrato que la activación, pero no la persiste— y `login` ya no
puede distinguir a un registrante de una dirección desconocida: mismo `401`
«Credenciales incorrectas», mismo bcrypt de señuelo, sin señal «sigue pendiente
/ ya no». La entrada al reenvío se rediseñó en consecuencia: acción pública
**siempre visible** en el panel de acceso —junto a «¿Olvidaste tu contraseña?»,
pide solo la dirección— más la que ya existía en «Revisa tu email».

- Ficheros: migración `2026_09_24_000001` (sin la columna),
  `PendingRegistration.php`, `AuthController` (`register`/`login`),
  `auth.component.{html,ts,scss}`, contratos `auth.spec.ts` +
  `auth.component.spec.ts`, `docs/api.md`.
- **Qué revisar con lupa:** (1) el precio asumido —quien intenta entrar antes de
  verificar ve «Credenciales incorrectas» en vez de una guía explícita— y si la
  entrada siempre visible te lo compensa; (2) que `register` valide la
  contraseña completa sin guardarla (mismo criterio que el nombre: propuesta
  con contrato, cero persistencia).

---

## Estado de verificación (post-cambios)

| Puerta | Estado |
|---|---|
| Pint + Larastan (nivel 6) | ✅ verde |
| PHPUnit (`uvh_test`, `migrate:fresh`) | **575/577** — solo las 2 aserciones de plantilla (hallazgo 4) |
| Karma + lint + typecheck frontend | ✅ **435/435** (2 pruebas nuevas del contrato de reenvío) |
| E2E (`npm run e2e`) | ✅ **30/30** en 4,1 min (contrato `auth.spec.ts` actualizado) |
| Arnés async (`npm run e2e:async`, pila completa) | ✅ **125/125** (2026-09-24) — incluye los tres ensayos de caída: export con el worker muerto, planificador detenido/recuperado y outbox con el proveedor caído (reintento del correo con portador usable, HTTP 200) |
| `SealKeyringTest`, `RegistrationEdit*`, `ApiParityTest`, `AuthEmailTokenTest`, `PasswordPolicyTest`, `DatabaseSchemaTest` | ✅ en verde tras su reescritura |

Pendientes conocidos: tus dos líneas de plantilla (hallazgo 4) y la retirada
del fallback legacy de sellos —ya con plan y verificación: `uvh:crypto:seals`
certifica con evidencia observada (aperturas legacy reales + marcador de
primera emisión v2) cuándo puede borrarse el ramal; fases y criterio en
`docs/app-secret-rotation-runbook.md`—. La
pasada completa del arnés `e2e:async` ya está hecha: **125/125** el 2026-09-24
(el run parcial anterior daba 92 PASS / 0 FAIL con los tres puntos editados
cubiertos: portador del buzón HTTP 200, ensayo de caída del outbox y
reintento del correo con el mensaje reutilizable).
