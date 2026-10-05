# Registro de revisión de funciones S01 — 2026-10-02

Este registro acredita las lecturas y controles descritos por función, no el cierre del sistema. La [matriz de rutas](2026-10-01-system-review-coverage.md) conserva evidencia histórica; el [inventario](2026-10-02-source-function-inventory.md) conserva todas las demás entradas. Hashes del inventario comprobados contra el árbol actual. Callbacks dentro de una función se leen con ella; dependencias/imports y callbacks de otros módulos mantienen su propio gate.

La columna «Estado» distingue código leído, controles locales y fronteras pendientes. No usar una prueba verde de un caller como validación de todos sus roles, rutas vecinas, proveedores o configuración de producción.

## frontend/src/app/auth/otp-code-input.component.ts

Edición conserva posiciones; parcial inválido; erase/reset restablecen completado; focus antes de emit; máximo6 dígitos. Control del padre fijo durante vida del componente, conforme al único caller actual.

Evidencia: otp-code-input8;auth.component44;browser4/32POST;B116/B118.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 78 | Código y regresión local verificados |
| `ngOnInit` | 82 | Código y regresión local verificados |
| `onInput` | 91 | Código y regresión local verificados |
| `onKeydown` | 103 | Código y regresión local verificados |
| `onPaste` | 124 | Código y regresión local verificados |
| `writeDigits` | 132 | Código y regresión local verificados |
| `projectControl` | 160 | Código y regresión local verificados |
| `focusBox` | 166 | Código y regresión local verificados |

## frontend/src/app/auth/auth.component.ts

MFA/recovery serializados; no cambiar método ocupado; salida forzada/destroy conserva guard de revisión. Dialog foco mientras disabled; error limpia OTP; focus deferred vigente y sin robar elección posterior.

Evidencia: Auth59+OTP8 (67 dedicadas), frontend864; browser anterior4/32POST y actual12/20POST;B117/B118/B119/O07. Constructor: navegación local revisada, efectos de registro conservan sus gates. returnTo: validación interna leída; Autorretorno /auth comprobado sin bloqueo por renovación de componente; otras variantes conservan su gate. O08 comparte safeReturnTo, siete casos de caller y frontend885.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `onOtpCompleted` | 454 | Código y regresión local verificados |
| `onOtpModalKeydown` | 460 | Código y regresión local verificados |
| `onMfa` | 493 | Edición/flujo/foco y fallo de navegación verificados |
| `onRecovery` | 528 | Edición/flujo/foco y fallo de navegación verificados |
| `goRecovery` | 733 | Código y regresión local verificados |
| `backToMfa` | 743 | Código y regresión local verificados |
| `restartMfaLogin` | 757 | Código y regresión local verificados |
| `focusAuthStep` | 771 | Código y regresión local verificados |
| `constructor` | 240 | Navegación inicial local verificada; otros efectos con sus gates |
| `onLogin` | 351 | Credenciales/navegación local comprobadas; destino compartido O08 |
| `navigationFailure` | 412 | Código y estado ligados a sesión comprobados |
| `retryNavigation` | 418 | Sin credenciales repetidas; deduplicación/invalidez comprobadas |
| `navigateAuthenticated` | 425 | Cancelación/rejection/vida/generaciones y foco comprobados |
| `returnTo` | 879 | Regla compartida y destinos locales probados; autorretorno /auth no bloquea |
| `onRegister` | 559 | Lectura completa; guards/revisión/ack y copy neutral. B131 elimina promesa de renovación24h;68 Auth/887 frontend. No acredita layout manual ni lifecycle S04 completo. |
| `changeRegistrationEmail` | 695 | Inicio de edición conserva contexto elegido; copy condicionado a disponibilidad; contrato frontend existente y nuevo texto leídos. |

O53: archivo completo, plantilla completa y988líneas originales de pruebas leídos; extracción del estado MFA y cinco contratos de consumidor comprobados antes/después. Métodos adicionales abajo acreditan lectura y conservación literal del cuerpo, salvo la sustitución de step por flow en las transiciones declaradas. No acreditan por sí solos proveedor real, cookies nativas ni toda variante de autoridad de registro/verificación.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `applyCredentialRules` | 290 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `onTabChange` | 304 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `onAuthTabKeydown` | 312 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `nextRegisterStep` | 329 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `previousRegisterStep` | 343 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `resendVerification` | 636 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `openVerificationRecovery` | 684 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `closeRegistration` | 708 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `goForgot` | 728 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `onLoginCaptchaToken` | 787 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `onRegisterCaptchaToken` | 792 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `onResendCaptchaToken` | 797 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `retryCaptchaConfiguration` | 802 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `executeCaptcha` | 806 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `loadCaptchaConfiguration` | 829 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `invalidateFlow` | 860 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `isFlowCurrent` | 866 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |
| `isVerificationCurrent` | 870 | O53: código completo leído; cuerpo preservado en comparación del archivo; consumidor local en412pruebas de auth. Contratos de registro/verificación y CAPTCHA mantienen su evidencia y límites propios. |

O54/B186: comparador grupal conservado como regla compartida; se suspende en corrección y se restaura al salir. Reproducción real de consumidor1fallo/73positivos y75verde antes de extraer estados.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `PASSWORD_MATCH_RULE` | 74 | Código completo conservado respecto al comparador anterior; ahora sujeto al mismo modo que las reglas de credenciales. La corrección no pide contraseña; el registro vuelve a exigir igualdad y consentimiento. |

## backend-laravel/app/Support/MfaAttempts.php

Presupuesto propósito10/global20/900s; store de seguridad; fallos de infraestructura no autorizan; clear best-effort tras factor correcto; Retry-After sólo buckets agotados. Store/provider reales pendientes S13.

Evidencia: MfaStepUpBudget/MfaChallenge/Configuration/Admission dentro de77/541.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `tooMany` | 53 | Código leído; contrato local comprobado en callers |
| `recordFailure` | 66 | Código leído; contrato local comprobado en callers |
| `clear` | 83 | Código leído; contrato local comprobado en callers |
| `tooManyResponse` | 96 | Código leído; contrato local comprobado en callers |
| `limiter` | 130 | Código leído; contrato local comprobado en callers |
| `key` | 137 | Código leído; contrato local comprobado en callers |
| `globalKey` | 143 | Código leído; contrato local comprobado en callers |

## backend-laravel/app/Support/MfaStepUp.php

Precondición: user/session locks del caller. Password y factor, frescura, presupuesto global; TOTP replay add; recovery devuelto para commit por caller. Rollback SQL no borra replay. Revisar otros callers en sus sistemas.

Evidencia histórica: MfaStepUpBudget/MfaLogin/Configuration77/541 y SecurityContextQuery. O11 añade replay cruzado login/step-up en ambos sentidos;91/640 contratos actuales. Delegación a MfaFactorVerification conserva política de fallo/ventana/presupuesto; no confundir verificación del helper con todos los callers de otros sistemas.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `verify` | 32 | Código leído; contrato local comprobado en callers |
| `factorFailure` | 93 | Código leído; contrato local comprobado en callers |
| `success` | 104 | Código leído; contrato local comprobado en callers |

## backend-laravel/app/Support/MfaFreshness.php

Window clamp1..60 leído; null/stale rechazan; respuesta403/reason estable. B120 excluye igualdad con expiresAt: probado antes/en/después, precisión de microsegundo, mutable/immutable y zona equivalente. Configuración de producción/reloj distribuido queda en S13.

Evidencia: MfaFreshnessTest4 y casos nuevos MfaStepUpBudget4; filtro final85/572. Suite completa1251/8941 aserciones,209,09s en uvh_test (s01-navigation-freshness-full-backend.log).

| Función | Línea actual | Estado |
| --- | --- | --- |
| `windowMinutes` | 24 | Código leído; configuración S13 pendiente |
| `isFresh` | 30 | Frontera exacta/microsegundos/zona verificada (B120) |
| `reauthenticationRequired` | 36 | Código y contrato403/reason comprobados en callers |

## backend-laravel/app/Support/Totp.php

Random20 bytes/base32; HMAC-SHA1/truncación6/period30; formato y window0..5; label URI encoded. Reloj microtime real; replay fuera de este helper. Vectores RFC4226/RFC6238/base32 verificados mediante reflexión, sin cambiar el reloj. pack alto=0 mantiene frontera64bits pendiente; no cerrada por vectores publicados.

Evidencia: TotpTest19/23, fuentes RFC4226 AppendixD y RFC6238 AppendixB; full1274. Reloj/window/replay/64bits mantienen gates específicos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `generateSecret` | 17 | O34: cuerpo completo releído; generador20bytes→32Base32,100/100 formatos comprobados sin bootstrap/DB. Sin nueva afirmación de entropía o seguridad del RNG. |
| `verify` | 39 | Código leído; verificación independiente pendiente |
| `matchingCounter` | 45 | Código leído; verificación independiente pendiente |
| `currentCode` | 71 | Código leído; verificación independiente pendiente |
| `secondsRemaining` | 81 | Código leído; verificación independiente pendiente |
| `isUsableSecret` | 87 | Código leído; verificación independiente pendiente |
| `counter` | 92 | Código leído; verificación independiente pendiente |
| `provisioningUri` | 97 | O34: cuerpo completo releído; tres payloads reales comparados exactamente con positivos frontend, incluyendo plus/slash/hash/UTF8 codificados. No prueba del validador email ni proveedores. |
| `hotp` | 113 | Vectores publicados verificados; parte alta64bits pendiente |
| `base32Decode` | 126 | Key RFC exacta, upper/lower, verificadas |

## backend-laravel/app/Support/SessionManager.php

Token32 bytes sólo hash en DB; UA UTF8/controles/255bytes; expiry/version/verificado/deleted; update last-used optimizado por snapshot1min. La garantía de write una vez bajo concurrencia requiere revisión adicional S13; políticas de config/cookies dependen S13.

Evidencia: SessionManager/UserAgent/Hydration; filtro actual s01-mfa-session-helpers.log.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `create` | 17 | Código leído; contratos locales existentes |
| `persistableUserAgent` | 54 | Código leído; contratos locales existentes |
| `cookie` | 65 | Código leído; contratos locales existentes |
| `clearCookie` | 70 | Código leído; contratos locales existentes |
| `hydrate` | 80 | Código leído; contratos locales existentes |
| `revoke` | 140 | Código leído; contratos locales existentes |
| `makeCookie` | 145 | Código leído; contratos locales existentes |

## backend-laravel/app/Http/Middleware/UvhSession.php

Sólo atributos del contexto hidratado; anónimo continúa para rutas públicas. Hidratación no congela actor para toda la petición; mutaciones revalidan bajo lock.

Evidencia: SessionHydrationBoundary/MFA/SessionManager;callers restantes S03–S13.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 13 | Código leído; integración local existente |

## backend-laravel/app/Http/Middleware/UvhAuth.php

Gate auth/verified/admin sobre snapshot de hydrate. Parámetro de middleware viene del router, no del usuario; auditoría de composición de rutas y mutaciones de rol restante S13/S11.

Evidencia: Session/MFA casos locales;matriz185rutas.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 20 | O28/B151: expectativa sobre actor hidratado antes del controller/rol/tenant; optional sólo logout anónimo; verified/admin conservados, nunca auth por header. |
| `expectedAccountError` | 41 | O28/B151: header ausente permite legacy; decimal canónico400 inválido o409 mismatch sin IDs/cookies/revocación;11fronteras GET/command/tenant/admin/artifact y7formatos rechazados. |

## backend-laravel/app/Http/Middleware/RequireMfa.php

Requiere usuario/MFA-enabled/flag sesión; fresh usa MfaFreshness (B120: igualdad ya caducada). No reemplaza actor lock para una mutación; composición de callers S11/S13 pendiente.

Evidencia: MFA/step-up77;controllers distintos S11/S13 pendientes.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 13 | Código leído; integración local existente |

## backend-laravel/app/Http/Controllers/AuthController.php

O50: propietario de login/logout; registro/recuperación/perfil/credenciales/sesiones/MFA ya tienen propietarios HTTP independientes. Clase restante521→86comparada completa tras12métodos trasladados,20imports yconcern no usados retirados yprólogo obsoleto dehelpers eliminado explícitamente. No cambia política/servicios. 378/3444antes-después,Pint503/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;686hashes conservados. No cierre S01 ni objetivo global.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `login` | 24 | Extracción conservadora LoginAdmission; contratos de credenciales, audit/cache y payload existentes; CAPTCHA/proveedores/tiempo remoto siguen pendientes |
| `logout` | 76 | Lectura completa; cuerpo preservado literalmente por comparadorO50. Revocación/cookie/audit originales. SessionHydrationBoundary exige logout protector aun si admisiónaudit falla yrecuperación cuando sólo falla historial; archivos/funciones leídos, no nueva brecha ni promesa de admisión obligatoria. Full2205/18889incluye contratos de logout sin cambio; no acredita otras fronteras ni proveedores. |


## frontend/src/app/auth/mfa-reauthenticate.component.ts

Sonda previa a credenciales; permiso admin si destino admin, factor enabled y fresh; POST una vez, form reset/retirada tras éxito, navegación recuperable ligada a LatestRequest/contexto. Cambio de generación exige nueva comprobación; destroy ignora respuesta. UI/foco/18px/48px comprobados. Composición de rutas y privilegios backend mantiene S11/S13.

Evidencia:20 casos reauth dentro885; baseline4 fallos/6 correctos;browser8/4 POST;B121.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 114 | Código y sonda local comprobados |
| `submit` | 118 | Verificación/navegación local y no POST repetido comprobados |
| `retryInitialization` | 147 | Relectura tras cambio de contexto y fallo de sonda comprobada |
| `retryNavigation` | 152 | Sólo ruta, deduplicación/foco/vida/contexto comprobados |
| `resetNavigationContext` | 165 | Estado desbloqueado y nueva comprobación exigida |
| `context` | 177 | Código leído; retorno/generación en predicados comprobados |
| `initialize` | 181 | Login/non-admin/no-factor/fresh/stale y errores locales comprobados |
| `navigateOnce` | 229 | Cancelación/rejection/éxito y ciclo local comprobados |

## frontend/src/app/core/guards/auth.guard.ts

safeReturnTo leído; reglas comunes de destino, fallbacks y caller login. authGuard/adminGuard conservan su revisión anterior y gates de sus callers, no se agregan como funciones nuevas aquí por compartir archivo.

Evidencia:guard4 y Auth66 dentro885;O08.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `safeReturnTo` | 45 | Regla/destinos/rechazos y caller comprobados |

## frontend/src/app/core/auth-route-reuse.ts

renewAuthContext evita reutilizar snapshot y credenciales del componente anterior. Autorretorno /auth recrea componente y llega al panel con un POST; comportamiento general por snapshot continúa en tests de rutas.

Evidencia:auth-route-reuse specs anteriores, full885 y s01-self-return-browser.log.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `shouldReuseRoute` | 5 | Código y renovación de contexto comprobados |

## backend-laravel/app/Console/Commands/DevTotp.php

Sólo local/testing; no HTTP; lee activos/staged bajo snapshot de operador, descifra/normaliza, secreto explícito opcional, exposición sólo con --show-secret. Watch guarda snapshot de secretos y termina por señal; no se arrancó stream ilimitado. Stage null/deadline pendiente: backendEnable rechaza null/lte, este helper sólo isPast cuando fecha existe. Preserva formatos locales normalizados y secreto del keyring; no afirma validez de cuenta para login.

Evidencia:9 DevTotpCommandTest dentro filtro53/184 y full1274;lectura completa. Gate producción/distribución/clave y watch restanteS13.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 41 | Gate local y caminos principales comprobados; watch pendiente |
| `describeAccount` | 96 | Código leído; no acredita autorización de cuenta |
| `factors` | 126 | Formato/decrypt/staged comprobados; null/deadline pendientes |
| `exposeSecrets` | 183 | Exposición explícita y URI comprobadas con fixtures |
| `printCodes` | 195 | Código local verificable y no exposición por defecto comprobados |
| `watch` | 222 | Código leído; stream/señales/tiempo vivo pendiente |
| `normalizeSecret` | 247 | Código y formatos locales comprobados |

## backend-laravel/app/Console/Commands/PromoteAdmin.php

Email normalizado, usuario bajo lock y actor consola; activo/verificado/MFA usable; descifrado/keyring/legacy reutilizados. Rol y evento en TX, idempotencia. No se opera cuenta real ni se confunde acceso consola con API remota; auditoría/config/ACL de consola transversales mantienenS13.

Evidencia:11 casos promoción, baseline5 fallos/6 correctos; filtro53/184 y full1274;B122.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `handle` | 18 | Elegibilidad/idempotencia/evento local comprobados |

## Pendientes para cerrar S01

- Conciliar métodos restantes de AuthController/AuthService, DTOs/modelos y helpers de registro/recuperación con evidencia directa, sin recopiarlos como cerrados por tener endpoint.
- Autorretorno /auth no bloquea en el recorrido observado (renewAuthContext). B119/B121 navegación false/rejection corregida. Variantes adicionales de destino se concilian cuando corresponda, sin declarar un bucle inexistente.
- RegistrationEdit: frontera exacta reproducida y corregida como B127; mantienen gates de despliegue/rotación/configuración. Frontera MfaFreshness corregida (B120).
- TOTP publicado y promoción utilizable verificados sin cuentas reales; quedan contador64bits/reloj público/window y DevTotp stage null/deadline/watch. No convertir lectura de código en prueba temporal ejecutada.
- Completar UI de enrolment/regeneración/desactivación MFA, cambios autenticados, centro de seguridad y finalización de recuperación; muestras de correo actuales pertenecen al gate S10.
- Revisar parámetros/cookies/store/cache/crypto/mail/outbox compartidos como dependencias S13/S10/S02; conservar separación entre admisión local y entrega/proveedor real.

77 funciones con lectura registrada en16archivos; hay estados parciales explícitos. No cuentan como 77 funciones globalmente cerradas.


## backend-laravel/app/Support/SecurityContext.php

Contexto compartido de cuenta/sesión bajo lock. Constructor privado, guard de transacción, orden de usuarios por ID, exact session/owner/generación/no-revoked/expiry y policy verified explícita. Readonly no hace inmutables los modelos ni garantiza uso correcto fuera de la transacción original. Cada caller conserva los permisos del recurso y los requisitos de MFA. S03 revalida las doce mutaciones explícitas; otros consumidores S02/S04–S13 conservan su gate.

Evidencia: LockedSecurityContextTest16 casos, incluidos dos PDO independientes que verifican bloqueo de revocación de cuenta/sesión con SQLSTATE55P03 y rechazo después del commit. Contratos inválidos, límite de expiry y orden/query; no certifica todas las carreras entre operaciones ni deadlocks de otros controladores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `__construct` | 17 | Privado; modelos/IDs retenidos sólo para esta TX |
| `lock` | 23 | Cuenta antes de sesión; rechazo del contexto obsoleto comprobado |
| `lockWithUsers` | 37 | IDs positivos, unique/sort, cuenta relacionada retenida; orden comprobado |
| `relatedUser` | 54 | Lectura del batch previamente bloqueado; no concede permisos |
| `fromLockedUsers` | 60 | Invariantes de actor/session comprobadas; verified explícito preserva caller histórico |
| `requireTransaction` | 76 | Fuera de TX lanza LogicException; no valida automáticamente la vida futura del objeto |

## backend-laravel/app/Support/Auth/LoginAdmission.php

Primera extracción solicitada de Auth. El caller debe haber comprobado la contraseña contra el snapshot; el servicio revalida generación/hash/email/verified/deleted/MFA bajo lock y admite sesión o reto con su evento en una sola TX. Cleanup del reto no publicado preserva la excepción original, con TTL que acota el huérfano si cache falla. No comprueba CAPTCHA ni serializa cookies/respuesta; el único caller actual es AuthController::login. La API interna no acredita uso seguro por futuros callers sin preflight.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 22 | Cuerpo trasladado sin cambios funcionales; contratos anteriores conservados y tipos de resultado explícitos |

## backend-laravel/app/Support/Auth/MfaChallengeStore.php

Seis helpers trasladados literalmente con cambio de propietario/nombre. Cache conserva clave hash, TTL300s, marker consumed y lock15s de los callers; no hay retry automático ni se libera marker al fallar SQL. Respuestas y excepciones de infraestructura permanecen iguales. get conserva el decoder interno previo; schema/tipos de valores de cache corruptos requieren revisión propia, sin endurecerlos durante esta extracción.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `key` | 18 | Hash SHA256, namespace previo conservado |
| `store` | 23 | put=false/excepción no publican reto; TTL exacto y cleanup fallido comprobados |
| `get` | 40 | Empty/>128/missing y contrato previo conservados; corrupción de cache no certificada |
| `forget` | 56 | Infra outage explícita; cleanup de huérfano no sustituye error de admisión |
| `consume` | 65 | Marker antes de cleanup; TOTP/recovery no pueden reutilizar reto cuando cleanup falla |
| `lockKey` | 92 | Namespace compartido entre ambos métodos; lock distribuido sigue en caller |

Caracterización anterior a la extracción:38/237 aserciones,11,77s (36 Auth +2 cookie workspace). Tras extraer:251/1636,61,68s, incluye esos mismos contratos y workspace/contexto. Comparación mecánica de cuerpos con original confirma sólo traslados/renombres del bloque transaccional y los seis helpers. Pint428/PHPStan0 con baseline activo; suite completa final1431/10041 verificada; detalle y fecha de cierre al final del registro. Login final TOTP/recovery, registro/recuperación y resto de S01 permanecen en controlador para siguientes extracciones graduales.


Revisión final de migración: ID de miembro0/000 aceptado por la ruta no es un relatedUserId válido de la factory. Baseline de la regresión introducida2fallos/1control; caller evita ese lock imposible y conserva target_inactive409.3/15 aserciones correctas (s03-context-zero-target-green.log). Full anterior1428/10026,260,56s correcto; después del último cambio PHP1431/10041,249,51s también correcto. No atribuir este hallazgo de QA a un bug histórico ni cerrar el árbol final con evidencia anterior.


Verificación definitiva del árbol final B125/O09–O10:1431/1431 backend,10041 aserciones,249,51s en uvh_test (s01-auth-extraction-full-backend-final.log), exit0. Pint428/PHPStan0 con baseline existente y sin ampliación (s01-auth-extraction-quality-final.log), exit0. Último cambio PHP ID0/000 incluido en esta suite. Inventario444/2158 con nombre/1130 callbacks/3 firmas;444 hashes y anchors de ambos ledgers actuales, Node --check y git diff --check correctos. Backend97 regresiones nuevas frente al full1334 anterior; frontend no modificado en este lote y no se acredita nueva ejecución de su suite. S01–S13 y objetivo global abiertos; siguiente extracción admisión final TOTP/recovery según plan. CI billing permanece externo pendiente. No DB local, migración, proveedor, worker/scheduler, commit/push ni despliegue.


## backend-laravel/app/Support/Auth/MfaLoginAdmission.php

Segundo paso Auth/O11: ambas callbacks SQL completas trasladadas con IDs/generación capturados explícitos, sin separar revalidación de factor/reto/sesión/auditoría. Caller actual Auth conserva presupuesto, distributed lock15s, lectura de claims/owner y serialización/cookies. Precondición interna: caller releyó los claims del mismo owner/version bajo ese lock. Este servicio no valida por sí solo posesión del lock ni prueba de contraseña; no afirmar que un futuro caller arbitrario pueda usarlo sin orquestación.

Traslado congelado antes de corregir B126:89/606 aserciones antes y después,26,02s/29,10s. Comparación mecánica de ambas callbacks y tres helpers: sólo capture/owner/nombre. Después B126 (P2) reproduce cuatro account races en recovery: security_version, bloqueo, retirada de verified, MFA disabled. Legacy devuelve invalid, gasta un intento de propósito/global y publica auth.mfa_failed por un código que no llegó a comprobar. Ahora devuelve challenge401/caducada, no consume reto/recovery ni atribuye fallo de factor. Dos controles incorrect-factor siguen gastando exactamente un intento por nivel y publican su evento, sin conceder sesión. recovery_codes con tipo no-array mantiene contrato legacy invalid; corrupción de datos/cache necesita revisión propia.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `totp` | 24 | SQL/generación/factor/challenge/session/audit juntos; cuenta fresca y rollback/cache marker comprobados |
| `recovery` | 52 | Recovery index/SQL/avisos low-exhausted y login admitidos juntos; B126 y códigos incorrectos distinguidos |

## backend-laravel/app/Support/Auth/MfaFactorVerification.php

Tres algoritmos trasladados literalmente desde Auth; StepUp comparte decryption, TOTP reservation e index recovery. Política de errors/budget/freshness continúa en cada caller. TTL de replay180s y namespace key anterior preservados, distintos del challenge300s. decrypt devuelve null al fallar ciphertext, no valida base32 ni concede autoridad por devolver string. Index recorre conjunto completo con hash_equals y tipos de hash previos. No hay I/O de DB ni recuperación codes persistida en estos helpers.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `decryptSecret` | 14 | Body copiado, legacy/keyring/errores conservados; mapping en caller |
| `consumeTotp` | 28 | Counter/key/add/TTL/infra exception conservados; replay entre login/step-up probado en ambos sentidos y mfaEnable caller adaptado |
| `recoveryIndex` | 53 | Algoritmo común a login y StepUp, no escribe códigos; valor array/mixed documentado y baseline viejo retirado |

O11 elimina duplicación de factor en StepUp y extrae100 líneas de AuthController (2980→2880). No afirma ahorro de consultas/latencia ni tamaño final500–800 alcanzado. PHPStan baseline191→188: retiradas sólo las dos return types de endpoints ahora JsonResponse y el parámetro hashes tipado; no nuevo ignore. Pint430/PHPStan0 con baseline vigente. Diez casos nuevos en MfaLoginAdmissionTest (23 actuales), final91/640 aserciones,24,08s. B126 red cuenta incorrecta4fallos/2controles (46 aserciones); full final1441/10137 correcto,269,95s, no inferido de estos filtros. Sin cambios de frontend/proveedores.


Verificación final B126/O11:1441/1441 backend,10137 aserciones,269,95s en uvh_test (s01-mfa-admission-full-backend.log), exit0; incluye10 casos nuevos frente a1431 anterior. Pint430/PHPStan0, baseline191→188 con sólo3 entradas resueltas retiradas (s01-mfa-admission-quality-final.log), exit0.91/640 contratos dedicados y traslado89/606 antes/después. Inventario446 archivos/2160 con nombre/1130 callbacks/3 firmas;446 hashes y101/16 anchors S01/S03 comprobadas. Ledger S01 101 funciones/21 archivos, todavía parcial. Node --check y git diff --check correctos, sin cambio de PHP después de la suite. Frontend no modificado ni nueva ejecución/browser atribuidos a este lote. Auth y objetivo global S01–S13 siguen abiertos; siguiente RegistrationEdit/registro/verificación antes de extraer su admisión. CI billing conocido y gates de producción permanecen externos. Sin migración, DB local, proveedor, worker/scheduler, commit/push ni despliegue.


## backend-laravel/app/Support/Auth/RegistrationAdmission.php

O12 conserva registro/admisión huérfana y activación pending/legacy en sus transacciones originales. Caller valida inputs y consentimiento explícito; servicio revalida estado y fuerza de contraseña contra identidad viva. Mail, auditoría, token, workspace y evidencia legal mantienen commit/rollback. Los códigos null/-1/id conservan el contrato interno existente; no representan una sesión. Cuerpos comparados con snapshot anterior al traslado.142/1199 antes,146/1257 después con cuatro controles nuevos. Concurrencia y políticas restantes siguen parciales.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `start` | 39 | O14 admite intento para todos los desenlaces; pending/mail/audit en TX, respuestas y posteriores secuencias comprobadas |
| `activate` | 114 | O14 mutex/contexto antes de pending/bearer; SET NULL conserva contexto; activación/edición concurrentes y rollback pending/legacy comprobados |
| `admitOrphanVerification` | 240 | Mismo coste de admisión, sin bearer persistido; entrega suprimida comprobada en caller/job |
| `acceptRegistrationLegal` | 259 | Versiones únicas + tres eventos en TX; fallos de admisión/historial comprobados |
| `defaultWorkspaceName` | 277 | Truncado Unicode y límite80 conservados; prueba de nombre máximo en ApiParity |


## backend-laravel/app/Support/Auth/EmailAddressLock.php

O12 comparte el mismo namespace/CRC32/advisory transaccional entre registro, activación y cambios de email. Debe llamarse dentro de la TX, después de locks propios; traslado del cuerpo exacto. Otros callers sólo cambian propietario del helper, sin acreditar cierre de sus funciones. ColisiónCRC sólo serializa de más. O20 corrige el comentario: un mutex por destino no excluye ciclos de índices entre direcciones distintas; B139 se verifica con dos procesos PostgreSQL para reservas cruzadas. Resto de concurrencia intersistemas/provider real conserva gate.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `acquire` | 20 | Cuerpo y precondición transaccional leídos; contratos de callers actuales locales conservados |


## backend-laravel/app/Support/RegistrationEdit.php

Lectura completa de formatos v2/v3, ID/generación/fixed-length/decoy y expiry. B127 (P3): igualdad antes aceptada en modern/legacy; red2fallos/4controles con reloj aislado en subprocess PHPUnit. Corregido <= conservando reloj real. Sin extensión de autoridad al futuro ni omisión de revalidación bajo lock. Autoría/TOCTOU/rotación/formato legacy/clave anterior en RegistrationEditTest/Concurrency/SealFormatStatus/Keyring. B128 amplía emisión a v3 con19dígitos ID y10generación, valida int64/int32 sin saturación y conserva lectura v2; generación1000 y antiguo cookie999→1001 comprobados. Configuración/crypto/provider real mantienen gates S13.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `cookieName` | 39 | Helper leído; atributos delegados a HostOnlyCookie, gate propio |
| `ttlSeconds` | 44 | Floor60 y confighoras leídos; configuración real pendiente |
| `secret` | 50 | Emisor v3 sólo para fixtures de compatibilidad; no caller HTTP emite esta versión |
| `decoy` | 56 | Emisor legacy0/0 sólo fixtures; autoriza contexto virtual propio después de upgrade, nunca pending ajeno |
| `clearCookie` | 62 | Host-only/expiry anterior leídos; callers conservados |
| `authorizes` | 79 | PID/generación/expiry comprobados; revalidar fila bloqueada es deber del caller |
| `seal` | 123 | Forma opaca/fixed-length/keyring v3, rango bigint/integer íntegro y lectura v2 comprobados |
| `forAttempt` | 90 | v4 ID/generación/deadline almacenado; fixed-length host-only, mismo shape en todos los desenlaces |
| `deadline` | 98 | Reloj real con milisegundos/floor60; round-trip de storage y parser probado |
| `authorizesAttempt` | 103 | v4 namespace/expiry exacto; legacy lineage/digest/unspent; prueba de buzón nunca deducida |
| `claim` | 148 | B127/B128 más v4: deadline exclusiva18 casos; overflow y namespaces; semántica de fila bajo lock en caller |


B127/O12 verificados (02/10):1451/1451 backend,10213 aserciones,257,75s exclusivamente uvh_test (s01-registration-full-backend.log), exit0.146/1257 contratos dedicados (s01-registration-contracts-final.log) y142/1199 antes del traslado con fuente estable. Pint434/PHPStan0 (s01-registration-quality-final.log), exit0; baseline188→186 hallazgos ignorados,175 entradas, sólo2 return types resueltos eliminados. Inventario448 archivos/2162 funciones con nombre/1130 callbacks/3firmas;448 hashes y117anchors S01 en24archivos/16anchors S03 comprobados. AuthController2880→2637líneas. Diez controles nuevos (6deadline +4activación), sin frontend cambiado ni nueva suite/browser atribuida. S01–S13 siguen abiertos; siguiente revisión de corrección de email pendiente y reenvío de verificación antes de extraer esos flujos. CI billing conocido/gates de producción conservan su estado externo. Sin cambio de uvh_local, migración, proveedor real, worker/scheduler, commit/push o despliegue.


## backend-laravel/app/Support/Auth/RegistrationEmailCorrection.php

O14 reemplaza autoridad por contexto propio, revalidado bajo raíz estable y lock, antes de pending/advisory de dirección. Todos los ACK rotan contexto y pending propio; conflicto conserva mailbox/bearer propios pero actualiza dirección elegida. Un contexto virtual crea sólo un pending nuevo si destino libre. Auditoría/mail/rotación/efectos after-commit comparten TX; jamás modifica User/pending ajeno. Dos procesos prueban single-use nativo/virtual y la carrera de activación. Los controles anteriores O13 se conservan; desplegar esquema/código coordinados sigue pendiente.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 23 | Intento/generación/dirección/claim bajo lock; siete ocupaciones, free/conflict/rollback/retry y cookies gastadas comprobados |


## backend-laravel/app/Support/Auth/VerificationResend.php

O13 primero mueve cuerpo y legacy helper iguales al original; después unifica emisión/reemplazo común (101→64líneas). User mantiene filtro deleted/verified, Pending sólo existencia; cada uno usa su FK exacta. Owner antes de bearer, cooldown estricto60s, inserción/admisión/retiro en una TX. Snapshot no autoriza: fila y cooldown vivo se leen después de lock.168/1396 antes/después/tras-unificar; soporte legacy, entrega/obsoleto y failure/retry cubiertos. Floor HTTP/CAPTCHA/proveedor reales siguen en caller/S13.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 22 | Query de owner específico y secuencia común;59/60/61,cooldown/terminales entre preflight-lock y rollback/reintento comprobados |


O13/B128 verificados (02/10):1480/1480 backend habitual,10386aserciones,258,44s sólo uvh_test (s01-registration-lifecycle-full-backend.log), exit0.29 controles nuevos frente a1451;168/1396 dedicados antes/después/unificados. Pint437/PHPStan0 definitivo (s01-registration-lifecycle-quality-definitive.log), exit0; baseline186→184 findings,173entradas, sin nuevo ignore.450 hashes,121anchors S01/26archivos y16S03 actuales comprobados. AuthController2488líneas; VerificationResend64. Node --check/diff correctos, frontend sin cambio ni nueva ejecución/browser atribuida.

Estado histórico02/10 (sustituido por O14 al final): B129 seguía sin corregir; probe de privacidad compuesto fuera de suite habitual falla1/10aserciones (s01-registration-enumeration-probe.log). Full verde NO incluye ni cierra este nuevo requisito; hay evidencia contraria a privacidad de signup/login/corrección. Próximo bloque corregir el protocolo, luego reset/forgot y restantes S01–S13. Gates de producción/CI billing externos siguen pendientes. Sin migración ni cambio de uvh_local/proveedor/worker/scheduler/commit/push/deploy.


## backend-laravel/app/Models/RegistrationAttempt.php

Modelo independiente de cuentas, sin password/name/User/consent. Fecha millisegundo con round-trip explícito; pending optional SET NULL; lineage privada sin FK y generación. Schema11 casos, sin DB local. No presume que casts o readonly sostengan autoridad fuera de TX.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `casts` | 30 | Versiones/IDs/fechas y default inmediato1 leídos; precisión123ms y constraints positivos comprobados |
| `pendingRegistration` | 44 | Relación nullable; consumo del padre preserva contexto/lineage; no concede autoridad por relación |

## backend-laravel/app/Support/Auth/RegistrationAttemptContext.php

Resolver privado del navegador y orden común de locks. Legacy real requiere lineage o prueba PID/generación contra pending; decoy válido sólo adquiere contexto propio una vez por digest. Raíz inmutable evita invertir locks al activar y crear otro pending. Ocho métodos leídos íntegros; los callers HTTP exigen CAPTCHA/CSRF/throttling por separado. Retención revalida deadline después del lock (B130), con prueba de dos procesos realmente bloqueados.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `owns` | 15 | Revalida hint de login en TX/contexto bloqueado; nunca concede cuenta/sesión |
| `purgeExpired` | 29 | Predicate externo e interno de expiry; renovación durante espera sobrevive. Batches1–1000, máximo10 pasadas; capacidad productiva pendiente |
| `snapshot` | 43 | v4 por ID; legacy namespace/digest/expiry y bootstrap serializado; early check sin autoridad mutable |
| `authorizes` | 90 | Dirección elegida + claim vivo; comparación repetida bajo lock en mutación |
| `lock` | 96 | Raíz antes de row lock; snapshot no sustituye revalidación |
| `lockForPending` | 104 | Contexto antes de padre; legado pendiente sin frame tiene raíz propia; activación/retención callers leídos |
| `root` | 116 | Legacy PID/digest o attempt ID estables; virtual nunca cambia raíz al crear pending |
| `mutex` | 131 | Advisory transaccional en namespace PostgreSQL de dos enteros; colisión sólo serializa; no esperar raíz desde advisory de dirección |

Dependencia S13: leído el tramo de identidad de UvhHousekeeping::runPurges y el cuerpo de purgeInBatches. La purga de pending usa contexto antes del padre y revalida antigüedad; conserva pendientes nuevos/recentemente corregidos. No se acredita lectura/cierre de todo runPurges ni del resto de housekeeping. El patrón genérico DELETE por IDs requiere conciliación individual de filas renovables en S13; B130 sólo se reproduce/corrige para registration_attempts.


O14/B129/B130 (03/10): intento de registro durable independiente de ocupación, cookie v4 y compatibilidad v2/v3, corrección coherente y single-use para todos los ACK. El aviso de login describe la solicitud; contraseña correcta conserva prioridad. Activación y retención comparten raíz estable/contexto antes de pending; purga conserva una renovación confirmada durante su espera. Probe original B129 ahora es regresión permanente; B130 reproducido rojo y corregido. Suite completa1527/1527 backend,11020aserciones,348,85s sólo uvh_test (s01-registration-attempt-full-backend.log), exit0;47 casos nuevos frente a1480.198/2255 contratos dedicados (98,94s, s01-registration-attempt-contracts-definitive.log). Pint442/PHPStan0 (s01-registration-attempt-quality-final.log), exit0, baseline sin ampliar. Frontend885/885 y lint/tipos/build correctos, sin nueva revisión visual manual/browser de API local. Inventario452/2176con nombre/1134callbacks/3firmas,452hashes y136anchors S01/28archivos más16S03/2archivos verificados; captura actual03/10, nombre histórico02/10. AuthController2488→2438líneas; no se atribuye ahorro de latencia global. Migración aplicada/verificada sólo uvh_test con guard explícito; NO aplicada uvh_local. Esquema y recambio coordinado de código/procesos pendientes antes de usarlo en otro entorno. S01–S13 y objetivo global siguen abiertos; próximo bloque admisión forgot/reset y helpers compartidos, más gates externos/CI billing sin cambio. Sin entrega real, worker/scheduler productivo, commit/push ni despliegue.


## backend-laravel/app/Support/Auth/PasswordRecovery.php

O15 traslada completas las transacciones de forgot/reset. La solicitud bloquea User antes de revalidar email/verified/deleted y cooldown de60s, incluso bearer ya usado. El reset bloquea User→bearer y revalida dueño/kind/used/expiry exclusivo/estado/fuerza contra identidad viva antes de consumo, contraseña/generación, sesiones/API, cancelación recovery, notice y exact audit. No cambia la política de un bearer sin sesión.

Evidencia:17 nuevas caracterizaciones y contratos existentes;151/1246 antes/después. Seis cuerpos trasladados comparados mecánicamente. Full1544/11155,336,31s y calidad446/PHPStan0; no inventar bug ni ahorro de latencia: son garantías previamente válidas, ahora conservadas en extracción.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `request` | 20 | Cuerpo completo leído/trasladado;59/60/61 usado/sin usar y email/verified/deleted entre consulta y lock comprobados; floor y fallo mail/retry existentes. |
| `reset` | 58 | Cuerpo completo leído/trasladado; siete cambios en preflight-lock, generación9→10 y replay; deadline/current/rollback aviso/audit y recovery existentes. |

## backend-laravel/app/Support/Auth/SecurityIncidentNotice.php

Propietario común de avisos password/individual/bulk; guard exige TX abierta y caller debe tener locks de cuenta/mutación. No abre una segunda TX ni captura admisión. Inbox, exact security_notice audit, bearer24h y mail encrypted outbox comparten commit de caller; retención conserva bearer nuevo más cuatro anteriores con borrado acotado100. No acredita entrega/proveedor ni autoriza uso fuera de locks.

Evidencia: cuerpos de los tres helpers y callback individual trasladados sin cambio; PasswordNoticeAtomicity/SecurityNoticeAtomicity/SessionsRevocationNotice/SecurityIncidentBoundary dentro151/1246. Gates de producción siguen propios.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `passwordChanged` | 19 | Wrapper leído/trasladado; reset, cambio autenticado y recovery conservan avisos/rollback. |
| `sessionsRevoked` | 34 | Wrapper leído/trasladado; callers sólo admiten al cerrar filas; bulk idempotente/no email duplicado comprobado. |
| `admit` | 54 | Algoritmo completo y guard TX leídos; token24h/inbox/audit/mail/retención sin nueva TX ni catch; atomicidad/pruning existentes. |
| `sessionRevoked` | 92 | Callback individual sin cambio, helper público específico; caller conserva cuenta→sesión y exact audit en TX. |

## backend-laravel/app/Support/Auth/CredentialChangeResponse.php

Adaptador HTTP común, sin acceso SQL: compara usuario del request estrictamente con ID afectado. Sólo elimina cookie propia, y conserva extras/message antes de ok/current. No autentica ni revalida autoridad por sí mismo; mutation debe haber terminado antes. Reset, confirm-email y bearer protector conservan policy; no aplicarlo a changePassword que conserva sesión.

Evidencia: cuerpo idéntico al helper previo; EmailActionBoundary18/SecurityIncidentBoundary y contratos restantes dentro151/1246.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `forUser` | 17 | Cuerpo y callers leídos; owner/foreign/anonymous y cookie existente; sin consultar ni emitir sesión. |


O15/B131 (03/10): PasswordRecovery extrae completas las transacciones de solicitud/reset, SecurityIncidentNotice reúne los avisos de contraseña y sesiones, y CredentialChangeResponse conserva la limpieza de cookie sólo para la cuenta afectada. Seis cuerpos comparados sin cambios de orden/política. AuthController2438→2289líneas; mejora de organización, sin ahorro de latencia/consultas medido.17 nuevas caracterizaciones;151/1246 antes y después. Full1544/1544 backend,11155aserciones,336,31s sólo uvh_test (s01-password-recovery-full-backend.log), exit0. Pint446/PHPStan0 (s01-password-recovery-quality.log), exit0; baseline184→182 findings/171entradas, sólo dos return types resueltos retirados. B131(P3): registro prometía otras24h y disponibilidad de URL sin renovar su deadline ni confirmar existencia. Rojo2fallos/66controles; texto condicionado a caducidad/disponibilidad, sin cambiar TTL/bearer/API; Auth68/68 y frontend887/887, lint/tipos/build correctos. Inventario455/2179con nombre/1134callbacks/3firmas,455hashes y150anchors S01/31archivos más16S03/2archivos comprobados. No nueva revisión visual/browser/E2E atribuida. S01–S13 y objetivo global siguen abiertos; siguientes fronteras: revocación protectora con evidencia recuperable y recuperación de cuenta, luego módulos restantes. CI billing y gates reales externos siguen pendientes. Sin migración, modificación de uvh_local, correo real, worker/scheduler productivo, commit/push ni despliegue.


## backend-laravel/app/Support/Auth/CompromisedAccessRevocation.php

O16 traslada íntegra la TX protectora después de corregir B132. Cuenta→bearer→solicitud de borrado; revalidación de kind/dueño/used/expiry y estado bajo lock. Cuenta bloqueada consume bearer sin levantar bloqueo; cuenta activa/restaurable rota generación y revoca sesiones/API/operaciones. Receipt comparte commit protector. No cambia credenciales/MFA ni concede sesión. Cleanup externo conserva su frontera anterior; no afirmar atomicidad de disco bajo una TX exterior con artefactos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 23 | Cuerpo completo leído y comparado con snapshot posterior al fix; sólo wrapper return y cast string tras filtro. 99/1105 contratos dedicados pasan; sin ganancia de latencia medida. |

## backend-laravel/app/Support/Auth/SecurityIncidentAudit.php

B132: evidencia mínima de evento, sin bearer/hash/password/email/URL. Guard TX abierta; caller sostiene cuenta. Savepoint contiene admisión general y DELETE del receipt. Si cualquiera falla, conserva constancia sin deshacer protección, incluso con logger roto. Reconciliador cuenta→receipt, máximo100 por pasada; FK SET NULL conserva identidad original tras borrar cuenta. incident_at/incident_correlation_id describen origen, distintos de fecha/trace de entrega posterior. No backfill de eventos históricos perdidos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `record` | 16 | Leído íntegro; evidencia comparte commit, rollback de INSERT protector y outer TX comprobados; guard fuera de TX rechaza. |
| `reconcile` | 33 | Leído íntegro; recuperación repetida/borrado usuario/batch101 y dos procesos reales con espera de lock comprobados. Capacidad y scheduler productivos pendientes S13. |
| `admit` | 51 | Leído íntegro; SQL/PHP/historial/DELETE/log fallidos comprobados; receipt y audit admitido se sustituyen atómicamente, sin duplicado en controles locales. |

## backend-laravel/app/Support/AccountDeletionAudit.php

Dependencia S02/S13 leída completa. B133 confirma que warning de fallback podía escapar y revertir cancelación protectora al fallar auditoría general. Catch interno del transporte conserva pending marker. No acredita lectura completa del caller AccountController.cancelDeletion ni retención/roles de S02.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 15 | Lectura completa; dos repros SQL/PHP+logger roto fallaban200→500; pasan tras contener fallback y recuperan un evento. |
| `reconcile` | 46 | Lectura completa cuenta→solicitud, máximo100, relectura pending/cancelled y heartbeat fallido; capacidades/retención mantienen gate propio. |

## backend-laravel/app/Support/ReleaseReadiness.php

Dependencia S13 leída completa: enumera migraciones sin ejecutarlas, verifica ledger y columnas/índices críticos con error seguro. O16 incluye seis columnas del receipt; tests de tabla o incident_at ausente rechazan readiness incluso con ledger/heartbeats. No acredita el resto del esquema, migración de uvh_local, despliegue ni release real.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `errors` | 12 | Lectura completa y contratos locales incluidos en99/1105; esquema nuevo sólo uvh_test. O47: tres nuevos contratos de table/lifecycle_at/ledger del receipt2026_10_04, errores seguros yhealth sinwrites;171/2919dedicado,full2205/18889, ledger/table verificadas sólo uvh_test. |


O16/B132/B133 verificados (03/10): full1568/1568 backend,11349aserciones,337,83s exclusivamente uvh_test (s01-incident-full-backend.log), exit0;24 controles nuevos frente a1544.99/1105 dedicados,22,28s (s01-incident-contracts-definitive.log), exit0. Pint452/PHPStan0 (s01-incident-quality-final-fixed.log), exit0; baseline182→180 findings/169entradas, dos supresiones resueltas retiradas y ninguna añadida. B132 conserva evidencia recuperable sin revertir revocación por audit general; B133 impide rollback de cancelación por logger de fallback. TX incidente completa comparada tras extracción, AuthController2289→2220líneas; sin latencia/consultas ahorradas medidas. Inventario457archivos/2183con nombre/1137callbacks/3firmas,457hashes y158anchorsS01/35archivos más16S03/2archivos comprobados tras full. YAML7reglas completas únicas validado, Node--check/diff correctos; no promtool/monitorización real atribuida. Migración2026_10_03_000002 aplicada sólo uvh_test con guard; uvh_local intacta, sin backfill histórico. Frontend sin cambio/nueva ejecución/browser atribuidos. S01–S13/objetivo global activos: siguiente separación request/confirm/complete recovery con caracterización previa y resto de funciones/roles/gates externos pendientes. CI billing conocido permanece externo. Sin proveedor real, worker/scheduler productivo, commit/push/deploy.


## backend-laravel/app/Support/Auth/AccountRecoveryAdmission.php

O17 mueve tres transacciones completas, con comparación mecánica y103/765 contratos antes/después. Solicitud cuenta→case revalida dirección/verified/MFA/deleted y cooldown, renovación/expiry/bearer/mail/exact audit. Confirmación cuenta→case revalida hash/status/owner/deadlines/generación sin sesión. Finalización todos los User conocidos ordenados por ID→case; approval set cambiado rechaza sin adquirir lock tardío. Revalida independencia/rol/MFA/verified/deleted de aprobadores y estado/generación/identidad viva de target. Credenciales, democión admin, retiro MFA, revocación/bearers/operaciones, notice y exact audit comparten commit; cleanup externo queda en controller.

No se atribuye nueva prueba de dos procesos PostgreSQL en este lote: interleavings son cambios deterministas entre preflight y lock en API real. Outer rollback nuevo no tiene artefacto físico. Verificación real de identidad externa, aprobadores de producción y mail/volumen/retención conservan sus gates. Sin ganancia de latencia/SQL medida; resultado union documenta desenlaces. B134 cambia respuesta después de verificar extracción, no estos cuerpos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `request` | 24 | Lectura completa/traslado; exact60s, elegibilidad viva y contratos mail/audit/expiry existentes. |
| `confirm` | 89 | Lectura completa/traslado;7 cambios hash/owner/status/generación/bloqueo/verificación/MFA y deadlines/replay existentes. |
| `complete` | 131 | Lectura completa/traslado;14 cambios de aprobadores/set/target/case/deadlines; rollback exterior9→10/retry/replay y contratos notice/audit existentes. |

## backend-laravel/app/Models/AccountRecoveryRequest.php

Modelo leído íntegro: fillable de estado/bearers/deadlines, tokens ocultos, casts datetime y seguridad integer. Relación User y cast no conceden autoridad por sí solos; servicios revalidan bajo lock. No nuevo cierre de constraints/retención de esquema por esta lectura.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `casts` | 40 | Lectura completa; fechas/estado del modelo consumidos por contratos locales, no nuevo test específico de precisión. |
| `user` | 57 | Relación leída; snapshot no reemplaza cuenta bloqueada de finalización. |

## backend-laravel/app/Support/AccountRecoveryLifecycle.php

Cancelación común exige por contrato usuario bloqueado y TX de cambio de credencial; enumera active cases, borra approvals e invalida bearers/deadlines junto a status. El helper no verifica físicamente ese lock/TX por sí mismo. Fuente y callers de Auth leídos; no se certifican todos los consumidores de otros sistemas por esta entrada.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `cancelActiveForUser` | 19 | Cuerpo completo leído; contratos existentes de revocación/reset/security notices conservados. Callers intersistemas y retención tienen gate. |

## backend-laravel/app/Http/Controllers/AdminController.php

Dependencia S11 parcial de recovery: listado, decisión y helper de sesión leídos íntegros. Listado no expone bearers y cuenta aprobadores actuales/independientes. Decisión target/actor en ordenID→case→sesión actor; eventos exactos dentroTX, mail obligatorio con rollback. Recuento de otros admins al aprobar no sustituye locks/revalidación de todos en finalización. No se cambia AdminController; ruta/middleware/otros helpers/roles/identidad externa y restoS11 pendientes.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `accountRecoveries` | 551 | Lectura completa; filtro/escape/paginación/proyección y aprobación independiente leídos, contratos previos incluidos; gran volumen real pendiente. |
| `decideAccountRecovery` | 614 | Lectura completa; approvals/mail/audit/rechazos/target independiente; pruebas existentes dentro139/991. No nueva extracción ni actor-race adicional atribuida. |
| `eligibleLockedAdminSession` | 1287 | Lectura completa; usuario esperado ya bloqueado, sesión concreta/versión/expiry exclusivo/MFA fresh; otros callersS11 conservan gate. |

## frontend/src/app/auth/account-recovery-complete.component.ts

B134: confirma mensaje y boolean current mediante decoder; sólo reconcilia identidad afectada y captura generación antes del envío. Ack tardío tras destroy actualiza Auth si sigue siendo la misma generación, sin modificar formulario retirado. AuthService real conserva identidad posterior. Formularios/token/busy/replay y errores400/409 terminales permanecen. No cambio visual ni nueva revisión manual/browser/E2E atribuida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 97 | Lectura completa; falta/malformed bearer conserva resultado inválido y URL limpia; controles previos incluidos en50frontend. |
| `complete` | 105 | Lectura completa; B134 ocho controles decoder/current/destruction/nueva generación con AuthService real, más42 async existentes. |

## frontend/src/app/core/services/public-action-response-decoders.ts

Archivo leído completo; entrada nueva de recovery compone validadores de texto/ok y credencial/current sin conservar campos ajenos. Boolean estricto; falta/string/número de current no acredita éxito ni sign-out. Otros helpers/callers mantienen sus gates; lectura del archivo no equivale a revisión de todas sus pantallas.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `decodeAccountRecoveryCompletion` | 53 | Lectura completa; ok false/current faltante-string-número/ack válido y estados de UI comprobados en8 nuevos. |

## backend-laravel/app/Support/PrivateArtifactCleanup.php

O18: helper leído completo y corregido B135/B136. Callers HTTP de Auth/Account/Admin esperan commit exterior; callback terminal revalida status/ruta bajo lock. attempt conserva booleano inmediato para workers. retryTerminal revalida también después de selección; rechazo obsoleto no cuenta cleaned. El puntero durable permite retry si proceso termina antes del callback o DELETE confirma pero la limpieza SQL revierte. Diagnóstico PII-free contenido ante logger fallido. 25 casos nuevos del helper/API/job y6 métricas en123/869 dedicado final; suite completa posteriormente verificada1631/11741; ver nota final O18.

Fronteras: volumen/retención, filesystem real/permisos/symlinks, APP_SECRET rotation, workers concurrentes, uso de attempt dentro de otras TX y stages ajenos continúan pendientes. No nuevo test multiproceso de artefactos. Calls HTTP vecinas modificadas mecánicamente no certifican sus funciones completas; nueva prueba física API sólo incidente/recovery/cancel.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `afterCommit` | 13 | Nuevo; commit/rollback exterior y savepoint, revalidación de4 estados/ruta y recuperación por housekeeping comprobados. |
| `attempt` | 34 | Lectura completa; worker processing recibe false real ante DELETE rechazado, mantiene path y puede reintentar. |
| `clean` | 40 | Lectura completa; status/ruta bajo lock, storage failure y SQL de puntero fallido; no borra callback obsoleto. |
| `retryTerminal` | 91 | Lectura completa; cambio después de selección, retry idempotente y dos ciclos heavy reales de housekeeping en uvh_test. |
| `reportFailure` | 119 | Nuevo; four combinaciones incidente/recovery con métricas ausentes/presentes y log fallido; puntero durable. |
| `isManagedPath` | 134 | Regex completa;4 vectores traversal/sufijo/newline rechazan sin borrar archivo válido incluso con logger fallido. |


O17/B134 verificados (03/10): full1600/1600 backend,11589aserciones,338,08s exclusivamente uvh_test (s01-account-recovery-full-backend.log), exit0;32 casos nuevos frente a1568.103/765 antes/después del traslado,139/991 dedicado final,36,63s; Pint454/PHPStan0 (s01-account-recovery-quality-final.log), exit0. Baseline180→177 findings/166entradas, sólo3 retornos resueltos eliminados. AccountRecoveryAdmission conserva tres TX completas comparadas; AuthController2220→1985líneas. B134 cookie sólo propia/current booleano y SPA con generación/validación/destruction/nueva identidad: redAPI2fallos/1control, redfrontend5fallos/3controles;50dedicados pasan. Fullfrontend895/895 definitivo (s01-account-recovery-full-frontend-definitive.log), lint/tipos/build definitivos exit0. Lint inicial señaló ternario de assert; sustituido por if/else sin relajar regla ni tocar PHP. Inventario458archivos/2187con nombre/1137callbacks/3firmas;458hashes y176anchorsS01/42archivos más16S03/2archivos verificados tras full. Node--check/gitdiff--check correctos. Sin ganancia de latencia/SQL medida ni nueva concurrencia multiproceso/QA visual/E2E/proveedor atribuida. No nueva migración/uvh_local/worker/scheduler/commit/push/deploy. Objetivo yS01–S13 abiertos; siguiente frontera cleanup físico/fallback en callers Auth y resto de mutaciones/lecturas/frontends/roles por función. CI billing conocido y gates reales externos mantienen estado.


## backend-laravel/app/Support/OperationalMetrics.php

Dependencia S13 leída completa. B137: transporte de diagnóstico contenido y guarda siempre restablecida; incrementBatch captura error al registrar callback como increment. Six variantes single/batch inmediato/commit/rollback con SQL+Log fallidos comprueban estado de negocio y recuperación. Todos los consumidores S01–S13, configuración/capacidad/Prometheus mantienen sus gates; no nuevo test específico de falla en registrar callbacks ni de cada serie.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `increment` | 125 | Lectura completa; filtro/monto/upsert/defer/fallback;2 llamadas fallidas no bloquean siguiente contador válido. |
| `incrementBatch` | 161 | Lectura completa; filtros/bindings/upsert/defer y fallback contenido; no prueba nueva del registro de callback fallido. |
| `logFailure` | 191 | Lectura completa; catch de transporte y finally de guarda, incluidos callbacks al commit exterior. |
| `totals` | 207 | Lectura completa; rango1..1440, SUM, series allowlist con cero; volumen/exportador real no acreditados por estos casos. |


## backend-laravel/app/Jobs/GenerateDataExportJob.php

Dependencia S02 leída completa incluyendo callbacks y conexión lateral. B138 confirmado en publicación ready: Audit fueraTX absorbía error y dejaba ready/archivo/aviso sin evento. Admisión exacta dentro de TX junto a archivo publicado/estado/mail/notification; dos fallos PHP/SQL revierten y permiten retry con un evento. Snapshot/build/codec/consumidores mail se revisan por separado: leer este caller no cierra esas dependencias.

failed/failTooLarge conservan eventos fuera de TX; requieren reproducción y política explícita antes de corregir. La sospecha de failTooLarge perdiendo pointer de archivo escrito no se confirma en flujo normal: límites ocurren antes de codec.write. Workers paralelos, rotación/snapshot/capacidad/cola y ejecución real mantienen gate.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `__construct` | 52 | Lectura completa; cola exports explícita y presupuesto declarado, worker real no ejecutado. |
| `handle` | 57 | Lectura completa; B138 ready audit+mail+notice/TX/retry comprobados; tests previos de stages/chunking/rotation incluidos. |
| `failed` | 247 | Lectura completa; sólo processing y owner/request lock; audit externo pendiente de repro/política. |
| `failTooLarge` | 288 | Lectura completa; marca terminal antes de codec.write; audit externo y otros modos de tamaño/memoria pendientes. |
| `writeStage` | 324 | Lectura completa; conexión lateral y progreso no autoritativo; secuencia existente incluida en dedicado. |
| `stageConnection` | 345 | Lectura completa; reutiliza connection y connectUsing force; fallos/reconexión real mantienen gate. |
| `hasMemoryHeadroom` | 364 | Lectura completa; unlimited/sufijos/margen; no nueva matriz de límites CLI/arquitecturas atribuida. |


## backend-laravel/app/Http/Controllers/AccountController.php

Dependencia S02 parcial: cancelExport leído completo, cambia sólo cleanup posterior a afterCommit. Revalida actor con helper previo, bloquea active export, cancela/mail_generation null y admite audit en misma TX. Request/download/ack/deletion sólo leídos parcialmente en este bloque: sus llamadas de cleanup se cambian mecánicamente, sin añadirlos al ledger completo.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `cancelExport` | 207 | Lectura completa; dos nuevos casos de outer commit/rollback con archivo físico; gates de ruta/helpers/UI/mutaciones vecinas conservados. |


O18/B135–B138 verificación final (03/10): full1631/1631 backend,11741 aserciones,357,71s exclusivamente uvh_test (`s01-artifact-full-backend.log`), exit0;31 controles nuevos.123/869 dedicado final y Pint456/PHPStan0 definitivos, exit0. Baseline177 findings/166 entradas conservado sin nuevos ignores. Inventario458 archivos/2190 funciones con nombre/1138 callbacks/3 firmas;458 hashes y192 anchors S01/45 archivos más16 S03/2 archivos comprobados tras full. Node--check y gitdiff--check correctos. No edición de PHP/tests durante suite ni cambio frontend/migración/uvh_local/proveedor real/worker o scheduler productivo/commit/push/deploy. La revisión global y gates reales siguen abiertos; siguiente caracterización/separación de contraseña autenticada, email y MFA con TX completas, más fronteras export pendientes.


## backend-laravel/app/Support/Auth/AuthenticatedPasswordChange.php

O19: TX completa leída y comparada tras traslado. SecurityContext cuenta→sesión; identidad viva antes del factor; MfaStepUp freshness/budget/replay/recovery; password/version y propia sesión/otras revocadas/reset/cases/notice/exact audit comparten commit.14 mutaciones entre hydrate y lock,2 outer commit/rollback/retry y2 éxitos/hash/locks complementan contratos existentes,93/873 antes/después. No cambio funcional, API token policy distinta de reset preservada. No nueva prueba multiproceso, proveedores/clock distribuido/volumen/TTL/config/UI ni resto Auth acreditados por estas pruebas.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 18 | Traslado completo, comparación de cuerpo normalizado y contratos locales. Resultados/excepciones originales; ningún ahorro de SQL/latencia medido. Full posteriormente verificado1649/11925; no cierre universal por helper. |


O19 verificación final (03/10): full1649/1649 backend,11925 aserciones,310,68s sólo uvh_test (`s01-password-change-full-backend.log`), exit0;18 controles nuevos.93/873 antes (19,32s) y después (22,95s), exit0. Comparación del cuerpo trasladado repetida tras format conserva orden/policy; AuthController1985→1937líneas. Pint458/PHPStan0 (`s01-password-change-quality.log`), exit0; baseline176 findings/165 entradas, sólo1 ignore resuelto retirado. Inventario459 archivos/2191 funciones con nombre/1138 callbacks/3 firmas;459 hashes y196 anchors S01/46 archivos más16 S03/2 archivos verificados después de full. Node--check/gitdiff--check correctos. No PHP/tests editados durante suites, ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Fuente de los tres flows email releída para siguiente fase; posible deadlock al intercambiar reservas sigue candidato sin B/prueba, se reproducirá con dos procesos antes de corregir. Auth/S01–S13 y gates globales continúan abiertos.


## backend-laravel/app/Support/Auth/EmailChangeAdmission.php

O20: lectura completa de las tres transacciones y comparación mecánica tras format antes de B139; sólo adaptación del contexto SecurityContext. Solicitud conserva cuenta/sesión→step-up→advisory destino, reserva/recovery/mail doble/notificación/exact audit. Cancel conserva su consumo incluso sin reserva. Confirmación conserva cuenta→caso, expiry/owner/verified/SV, ocupación User/Pending e identidad/generación/sesiones/API/bearers/recovery/mail doble/exact audit.

B139 (P2 disponibilidad): comprobar una reserva ajena vigente después del factor y antes de borrar la propia evita el ciclo de índices únicos. Excepción controlada revierte también freshness, con el409 existente y SQL unique como guard final. No cambia TOTP replay fuera de SQL. 22 caracterizaciones nuevas;105/810 antes y después del traslado,106/823 final incluyendo el control nativo. No acredita concurrencia universal, volumen, configuración/provider real ni UI nueva.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `request` | 24 | TX completa leída; B139 nativo rojo40P01/verde409+409. Reserva/recovery/freshness conservados, expiry exclusivo y privacidad de factor comprobados. |
| `cancel` | 107 | TX completa leída; con/sin reserva, consumption y outer rollback/retry/exact audit comprobados. |
| `confirm` | 133 | TX completa leída; revalidación tras lookup, conflictos User/Pending, replay, mail doble/audit y outer rollback/retry comprobados. |

EmailChangeReservationConflict.php leído completo: excepción sin métodos propios; su propagación provoca rollback antes del mapeo HTTP. No se inventa una función revisada para contabilizarla.


O20 verificación final (03/10): full1672/1672 backend,12108 aserciones,307,24s sólo uvh_test (`s01-email-change-full-backend.log`), exit0;23 controles nuevos (22 caracterizaciones y1 native concurrency).105/810 antes (21,55s) y después del traslado (21,40s);106/823 final (27,44s), exit0. B139 deadlock cruzado40P01 reproducido con dos procesos y corregido; ambos409, sin ciclo, reservas/recovery conservados; freshness rollback comprobado. Tres TX completas comparadas antes del fix; import ausente detectado por8 fallos durante traslado, corregido antes del definitivo. AuthController1937→1782líneas. Pint463/PHPStan0 (`s01-email-change-quality.log`), exit0; baseline173/162, sólo3 ignores resueltos retirados. Inventario461 archivos/2194 funciones con nombre/1138 callbacks/3 firmas;461 hashes y199 anchorsS01/47archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. Sin PHP/tests edits durante suites, frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Siguiente MFA/lecturas y demásS01–S13/gates reales; goal abierto.


## backend-laravel/app/Support/Auth/MfaConfigurationAdmission.php

O21: cinco cuerpos transaccionales completos leídos y comparados después de format, adaptando sólo SecurityContext/objecto y su wrapper actor. Cuenta→sesión verificada/version/TTL; setup inicial password-only y reemplazo con factor/freshness; pending expiry exclusivo/consume TOTP; cancel sólo pending; regenerate reemplaza hashes y no consume por separado el recovery anterior; disable requiere factor concreto y preserva rol admin. Rotaciones conservan propia sesión, revocan otras y cancelan cases, con mail/notificación/exact audit en el mismo commit. Política API tokens distinta de recuperación preservada.

42 controles nuevos:30 cambios tras hydrate (6 variantes×blocked/revoked/expiry igualdad/session version/foreign) y12 outer commit/rollback. Recovery se puede reintentar tras rollback; TOTP consumido en cache permanece gastado y replay403 tras rollback SQL.146/1430 antes (31,00s) y después (36,04s), exit0. Pint465/PHPStan0, baseline168/157 tras sólo5 ignores resueltos. No bug nuevo ni latencia/SQL ahorro medido. Handler global503 ya cubría infraestructura: ausencia de catch local no era500. No prueba concurrente nueva/volumen/clock distribuido/provider real/UI/resto Auth acreditados por este bloque.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `setup` | 21 | TX completa comparada; autoridad/freshness/budget/replay/recovery y pending/exact audit, outer rollback/retry comprobados. |
| `enable` | 53 | TX completa comparada; first/reconfigure, pending proof/expiry, rotación/notice/audit, outer rollback y replay TOTP comprobados. |
| `cancel` | 109 | TX completa comparada; guard y pending/exact audit, factor activo/codes intactos, outer rollback/retry comprobados. |
| `regenerate` | 132 | TX completa comparada; step-up y reemplazo completo/cancel/revocación/notice/audit, outer rollback/retry comprobados. |
| `disable` | 179 | TX completa comparada; factor concreto/admin/freshness y rotación/cancel/revocación/notice/audit, outer rollback/retry comprobados. |


O21 verificación final (03/10): full1714/1714 backend,12722 aserciones,325,82s sólo uvh_test (`s01-mfa-configuration-full-backend.log`),exit0.42 caracterizaciones nuevas;146/1430 antes31,00s y después36,04s,exit0, sin fallos de fixture. Cinco TX completas comparadas después de format; sólo adaptación SecurityContext. AuthController1782→1604líneas. Pint465/PHPStan0 (`s01-mfa-configuration-quality.log`),exit0; baseline168/157, sólo5 ignores resueltos retirados, sin nuevos. Inventario462 archivos/2199 funciones con nombre/1138 callbacks/3 firmas;462 hashes y211 anchorsS01/48archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. No PHP/tests edits durante suites ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. No nuevo bug ni ganancia de latencia/SQL medida en O21. O20+B139 y O21 suman65 controles nuevos. Continúa reautenticación/perfil/reads/revocaciones y restoS01–S13/gates externos; objetivo activo.


## backend-laravel/app/Support/Auth/ReauthenticationAdmission.php

O22: transacción completa comparada tras format. Cuenta→sesión concreta activa/verified/version/TTL, presupuesto/factor/freshness/recovery y evento exacto/IP hasheada comparten commit. No requiere freshness previa ni rota/revoca sesiones. Dos pares recovery/TOTP outer commit/rollback complementan los controles de admisión previos; replay no-SQL no se retira por rollback. Sin nuevo bug ni ahorro SQL/latencia medido.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `admit` | 16 | Lectura completa y comparación mecánica; 55/386 antes/después y filtro conjunto105/596 pasan. Proveedores/reloj distribuido/configuración mantienen gates. |


## backend-laravel/app/Support/Auth/ProfileAdmission.php

O22: actualización de nombre y evento exacto juntos bajo SecurityContext. No se incorpora factor ni cambia política de perfil. Dos casos outer commit/rollback/retry con estado, generación y sesiones conservados; controles de contexto/audit previos incluidos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `update` | 13 | TX completa leída/comparada; nombre vivo y rollback de audit comprobados. UI mantiene gate propio. |


## backend-laravel/app/Support/Auth/AccountReadContext.php

O23: contexto de lectura por petición; SQL y guards del helper antiguo conservados. Constructor privado y factory typed; readonly no hace inmutables los modelos ni concede autoridad de mutación. Las consultas posteriores no forman un snapshot serializable de toda la respuesta.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `__construct` | 15 | Constructor completo leído; conserva User/UvhSession validados, sin adquisición de locks. |
| `resolve` | 17 | Factory completa leída y comparada: owner/SV/revoked/expiry>now y owner vivo/verified/SV; mismo SQL sin FOR UPDATE. Los commands mantienen SecurityContext. |


## backend-laravel/app/Support/Auth/AccountQueries.php

O23: cuatro cuerpos completos comparados tras format revirtiendo sólo adaptación contexto/date/HTTP. Payloads públicos, límites/order/truncated y fechas preservados. Cuatro GET reales nuevos comprueban TXlevel0 para consultas de cuenta, ausencia FOR UPDATE y no mutación. Controles de contextos invalidados, límites100/20 y minimización conservados.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `me` | 15 | Proyección pública existente conservada; sin secretos. |
| `mfaSession` | 23 | Estado/verifiedAt/expiresAt y freshness exactos, sin material de factor. |
| `sessions` | 42 | Current primero, orden last_used_at/id y limit101→100/truncated conservados, sin count histórico completo. |
| `securityCenter` | 67 | Cuenta propia; allowlist explícita, últimos20 de21, sóloid/action/date, sin metadata/IP. Counts y pending identity originales. |


O22/O23 verificados (03/10): full backend 1724/1724, 12910 aserciones, 334.17s exclusivamente uvh_test, exit0 (`s01-account-separation-full-backend.log`). Diez casos nuevos frente a O21: seis outer commit/rollback perfil/recovery/TOTP y cuatro GET sin locks/TX de negocio. Filtros O22 55/386 antes/después, O23 60/292 antes y conjunto final105/596 (20,08s), todos exit0. Pint469/PHPStan0; baseline168/157→162 findings/151entradas, sólo seis ignores resueltos retirados. AuthController1604→1469líneas; cuatro módulos nuevos con dos TX completas y cuatro proyecciones/contexto de lectura. Comparación mecánica tras format conserva SQL/policy/payload. Inventario466 archivos/2206 funciones con nombre/1138 callbacks/3firmas;466 hashes y224 anchorsS01/52archivos más16S03/2 comprobados después del full. Node--check y gitdiff--check correctos. No PHP/tests editados durante suite ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Sin nuevo bug ni ahorro de SQL/latencia medido. Objetivo/S01–S13 abiertos; siguiente bloque revocación de sesiones según plan, con política de logout preservada.


## backend-laravel/app/Support/Auth/SessionRevocationAdmission.php

O24: tres TX completas comparadas tras format, adaptando sólo actor wrapper a SecurityContext::lock?->user. Cuenta→sesión exacta bajo lock,requireVerifiedEmail=false original, luego filas propias/avisos/bearer/inbox/exact audit en el mismo commit. Idempotencia, counts incluidas expiradas no cerradas, current/cookie y respuestas se conservan.15 nuevos casos:8outer commit/rollback (individual propia/ajena/otras/todas),4admisión/historial individual y3snapshots ya autorizados antes de perder email verificado. Estos3no prueban que una nueva petición unverified esté permitida: hydrate la rechaza401. Logout mantiene revocación protectora aunque audit falle; no se homogeneiza. Dos wrappers/imports sin callers retirados y sólo1ignore de retorno resuelto; controlador1469→1408líneas. Sin ahorro SQL/latencia atribuido a extracción ni nueva concurrencia multiproceso.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `revoke` | 13 | TX completa leída/comparada; owner/current/idempotencia y notice/exact audit, outer rollback/retry y recuperación historial comprobados. |
| `others` | 34 | TX completa leída/comparada; mantiene current, count y cierre/notice/exact audit, outer rollback/retry y actor obsoleto comprobados. |
| `all` | 52 | TX completa leída/comparada; cierre incluido current, cookie tras resultado, count/notice/exact audit y outer rollback/retry comprobados. |


O24/O25 verificados (03/10): full1793/1793 backend,13590aserciones,369,85s exclusivamente uvh_test (`s10-notification-session-full-backend.log`),exit0;69controles nuevos respecto a1724 (15revocación+54notificaciones).134/1007 dedicado final37,75s y Pint471/PHPStan0,exit0. B140(P2) exact audit preferencias en su TX, también bare callers; B141(P2) seis rutas revalidan cuenta/sesión y verified,401GET/409command sin datos/cookies/cambios ante42invalidaciones tras hydrate; B142(P3) duplicate kind422sin cambio. Rojo API46fallos/3controles,120aserciones,17,28s; bare2fallos/1control,9aserciones,1,58s; consultas2fallos/3controles,23aserciones,2,02s. Vista reduce13SELECT delivery→1scoped por cuenta en GET/PATCH, sin atribuir latencia ni una sola query total HTTP. O24tres TX completas comparadas tras format;66/604antes20,06s/después18,79s, policy/logout intactos. AuthController1469→1408líneas; baseline162/151→161findings/150entradas, sólo1retorno resuelto retirado sin nuevos ignores. Inventario467archivos/2211funciones con nombre/1141callbacks/3firmas;467hashes y225anchorsS01/53files+16S03/2files+29S10/5files comprobados después de full. Node--check/diff correctos. No PHP/tests edits durante suites ni frontend/nueva suite/browser/E2E/migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. S01–S13/objetivo global abiertos; siguiente UI de notificaciones ligada a identidad, todavía candidato sin ID, más productores/retención/gates reales y CI billing histórico pendiente sin nueva consulta.


O27 — transporte y reloj local: B146(P1) intención de otra cuenta durante CSRF, B147(P1) tenant distinto por header tardío yB148(P2) loading heredado tras logout fallido.34controles nuevos,82/82 dedicado,950/950 full frontend ylint/tipos/build,exit0. Rojo18fallos/7controles; adicional1producto+2fixture de Blob nativo. QA logout503 con GET retenido confirmado antes de la acción: conserva user1, generation1,loading/busyfalse e inbox recuperado; capturas inspeccionadas. Sin PHP cambiado ni nueva ejecución backend atribuida. Full backend1793/13590/calidad471/0 siguen deO24/O25. Lecturas y transporte no acreditan todos los permisos, cookies o roles servidor.


## frontend/src/app/core/services/session-context.service.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `advance` | 16 | O27: Reloj reactivo monotónico; signal user único compartido por fachada/API. Sin HTTP/secretos ni política de autorización; evita ciclo DI. |


## frontend/src/app/core/api-request-scope.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `apiPathname` | 4 | O27: Extracción exacta del pathOf previo; URL/query/hash/classificación preservada. |
| `isWorkspaceScopedPath` | 12 | O27: Único regex de clasificación tenant usado por interceptor y guard. S01/S03/S13 comparten dependencia. |


## frontend/src/app/core/interceptors/api.interceptor.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `usesSession` | 29 | O28/B151: catálogo completo leído; mismas rutas públicas/bearer independientes; se conserva clasificación tenant. |
| `apiInterceptor` | 54 | O28/B151: adjunta expectativa de cuenta local sólo en rutas de sesión; mismatch409 exacto limpia proyección original y no retry/revoke; 401/reauth conservados. |
| `blobSessionConflict` | 38 | O28/B151: lee sólo reason de Blob de hasta4096 bytes; JSON inválido no invalida; conserva error original. |
| `reconcileConflict` | 69 | O28/B151: compara ID todavía visible y generación originaria; Blob decoding tardío no borra una cuenta nueva. |

## frontend/src/app/core/services/workspace.service.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `selectionGeneration` | 16 | O27: Revisión monotónica distingue A→B→A. |
| `readStored` | 20 | O27: Conserva safeInteger>0 y fallo de storage→null. |
| `setList` | 30 | O27: Lista/selección de miembro vigente, sin nueva política de roles. |
| `select` | 38 | O27: Revisión sólo cambia si ID normalizado cambia; mismos valores/storage/validaciones. Controles API de retorno y reselección. |
| `currentRole` | 53 | O27: Proyección local de rol existente, no autoridad servidor. |


## frontend/src/app/core/services/auth.service.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `generation` | 68 | O27: Getter al signal compartido, antes primitive; todos los reads de generación adquieren reactividad. |
| `onStorage` | 85 | O27: Marker local revoca proyección/generación, sin secreto; cleanup de listeners/múltiples raíces no acreditado. |
| `clearLocalAuth` | 98 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `sessionGeneration` | 113 | O27: API pública intacta, read ahora reactivo. |
| `nextGeneration` | 117 | O28: invalida también identity reads antes de avanzar; protege cancelación y respuesta ya decodificada. |
| `isCurrent` | 122 | O27: Misma comparación de número, no ampliado a userid para responses ya enviados. |
| `assertCurrent` | 126 | O27: Mismo control-flow SupersededError, no abort de transporte. |
| `init` | 237 | O28/B149/B150: probe coalesced con LatestRequest/abort/epoch; comprueba otra vez antes de publicar, adopta generación propia y no borra /me más nuevo; retry/transient/401 preservados. |
| `refreshWorkspaces` | 284 | O27: Revision/generation propios existentes; sin gate nuevo para cada rol. |
| `login` | 298 | O27: Generación antes de enviar/clear; DTO/Auth facade/workspaces intactos. Real HTTP login propio pasa guard de dispatch.  O52: sólo expresiónHTTP sustituida por owner; resto de método/clase comparado.24nuevos contratos HTTP/API/interceptor y407antes/después,types/lint/build7.242s verdes. Full1397/1397,804hashesintactos; no nueva garantía nativa/proveedor/DOM. |
| `verifyMfa` | 320 | O27: Transición pública con su generación, decoded user yworkspaces comprobados.  O52: sólo expresiónHTTP sustituida por owner; resto de método/clase comparado.24nuevos contratos HTTP/API/interceptor y407antes/después,types/lint/build7.242s verdes. Full1397/1397,804hashesintactos; no nueva garantía nativa/proveedor/DOM. |
| `recoverMfa` | 331 | O27: Mismo lifecycle probado a través de HTTP real simulado.  O52: sólo expresiónHTTP sustituida por owner; resto de método/clase comparado.24nuevos contratos HTTP/API/interceptor y407antes/después,types/lint/build7.242s verdes. Full1397/1397,804hashesintactos; no nueva garantía nativa/proveedor/DOM. |
| `register` | 346 | O27: Registro anónimo/generic user:null sigue permitido ydecoded; no creación de sesión.  O52: sólo expresiónHTTP sustituida por owner; resto de método/clase comparado.24nuevos contratos HTTP/API/interceptor y407antes/después,types/lint/build7.242s verdes. Full1397/1397,804hashesintactos; no nueva garantía nativa/proveedor/DOM. |
| `logout` | 383 | O27: Mismo cierre sólo confirmado, gen avanza antes deawait; B148 effect ya observa avance si falla yuser permanece.; O28/B152: probe settled para reemplazo fallido o cierre definitivo, transient retry conserva loadedfalse  O52: sólo expresiónHTTP sustituida por owner; resto de método/clase comparado.24nuevos contratos HTTP/API/interceptor y407antes/después,types/lint/build7.242s verdes. Full1397/1397,804hashesintactos; no nueva garantía nativa/proveedor/DOM. |
| `sessionExpired` | 395 | O27: Esperada generación filtra401viejos, mismo invalidate. |
| `accountSignedOut` | 407 | O27: Esperada generación protege confirmación tardía; fixture real usa para invalidar intento pendiente.; O28/B152: probe settled para reemplazo fallido o cierre definitivo, transient retry conserva loadedfalse |
| `invalidateLocalSession` | 418 | O27: Incrementa reloj/borrauser/workspaces yflag; no nueva política.; O28/B152: probe settled para reemplazo fallido o cierre definitivo, transient retry conserva loadedfalse |
| `announceInvalidation` | 427 | O27: Marker sin credenciales yfallo storage silencioso, igual. |
| `me` | 436 | O28/B149/B150: única lectura vigente, abort + guard antes de publicar; cuenta distinta avanza epoch y recarga workspaces sin heredar rol; misma cuenta conserva commands. |
| `publishUser` | 131 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `adoptObservedUser` | 194 | O28/B150: centraliza identidad observada, loaded/probe y epoch; sólo una cuenta previa distinta descarta selección almacenada; workspaces se cargan con epoch nuevo. |
| `assertIdentityCurrent` | 211 | O28/B149: guard sin await justo antes de publicar; dos nuevas regresiones de invalidación entre helper y writer. |
| `readIdentity` | 215 | O28/B149: transporte GET cancelable y decoder real; reevalúa propiedad en éxito/error, traduce cancelación obsoleta a Superseded sin borrar estado actual.; O28/B152: probe settled para reemplazo fallido o cierre definitivo, transient retry conserva loadedfalse |
| `sessionContextChanged` | 401 | O28/B151: sólo la generación originaria limpia la proyección; sin logout, cookie write ni marker cross-tab; probe queda resuelto. |
| `updateProfile` | 477 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `requestEmailChange` | 491 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `cancelEmailChange` | 495 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `changePassword` | 481 | O28/B150: ACK tardío después de observar B queda Superseded; misma cuenta conserva comando válido, sin modificar seguridad backend. |
| `assertUserContext` | 139 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `reconcileUserMutations` | 144 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `applyUserMutation` | 155 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |

O29/B153 sustituye publicación incondicional de snapshots simultáneos por reconciliación posterior. Una lectura iniciada o publicada durante command obliga reconciliación (también post-MFA). Failure conserva notice explícito y ACK; supresión sólo de fallos del read, no command. API/contexto capturados antes de awaits; no cambia generación de misma cuenta.
| `markUserProjectionStale` | 160 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `confirmedMfaMutation` | 169 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `refreshUser` | 447 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `mfaSetup` | 600 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `mfaEnable` | 604 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `mfaCancelSetup` | 608 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `mfaRegenerateRecoveryCodes` | 612 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `mfaDisable` | 616 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |

| `listSessions` | 565 | O33: GET con options/signal/timeout, generation antes/después de transporte conservada; entrada validada y supersession comprobadas por HTTP real simulado. |

| `revokeSession` | 572 | O33: Current protector/client+server/ACK inválido/interceptor401/identity reemplazada preservados; no abort/replay de write enviado. Caller Settings real prueba propia navegación y supresión tras replacement/destroy. |

| `revokeOtherSessions` | 584 | O33: Count0 ypositivo validados, ACK inválido/httpfail no cambia identidad ni se reenvía; guards duranteCSRF/retry ysettlement conservados. |

| `revokeAllSessions` | 592 | O33: Logout propio sólo tras ACK validado/generation vigente;0válido; late success/401 no borraB; política Auth intacta por comparación mecánica. |

## frontend/src/app/core/services/api.service.ts

O27: lectura completa de las funciones enumeradas y sus callbacks/dependencias relevantes; estados acotados a evidencia de transporte, no cierre del sistema. Auth tiene dos constructores: ambos leídos, sin anchor ambiguo en la tabla.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `boundedTimeout` | 29 | O27: Política de reads/mutations/artifacts intacta; no aumento de timeouts. |
| `constructor` | 41 | O27: ApiRequestError conserva status/details/retry/reason, nuevo guard usa discriminador409 request_context_changed. |
| `readCookie` | 51 | O27: Nombres/decoding CSRF intactos, ninguna escritura de cookie en nuevo guard. |
| `csrfToken` | 69 | O27: Primacía host-only yfallback local intactos. |
| `ensureCsrf` | 78 | O27: Mismo fast path/bootstrap, guard captura intención antes delawait. |
| `fetchCsrf` | 90 | O27: Coalesce/currentcookie/fallo/finally intactos; dos generaciones pueden esperar misma bootstrap sin send viejo. |
| `retryOnRejectedCsrf` | 115 | O27: Sólo csrf_rejected yuna repetición; contexto se comprueba antes de refrescar ycada intento.403/409/429/503otros no retry. |
| `mutationGuard` | 135 | O27: Captura generación/userID; workspaceID/revisión sólo para tenant. Compara sinawait antes delsend; no cookie HttpOnly/no autoridadserver. |
| `mutate` | 152 | O27: Captura antes deensureCsrf incluso con cookie presente, assert antes de source/build/subscribe; response ya enviado se conserva para caller. |
| `assertApiPath` | 161 | O27: Validación ruta propia intacta. |
| `headers` | 167 | O27: X-CSRF yextraHeaders/intención idempotente intactos. |
| `errorOf` | 176 | O27: Traducción message/status/details/retry/reason intacta, no contenido sensible en guard. |
| `decodeResponse` | 197 | O27: Decoder/error502 sin bodies/detalles; public DTOs comprobados en HTTP. |
| `request` | 209 | O27: Timeout yabort de read intactos, no cancel de write nueva. |
| `cancelOnAbort` | 230 | O27: Unsubscribe sólo reads consignal; write continúa. |
| `get` | 247 | O27: Read no recibe guard de mutación; caller conserva identidad/orden requerido. |
| `post` | 259 | O27: Guarda nuevo primer argumento path; mismos body/headers/idempotency/decoder, cuatro políticasCSRF/errores. |
| `postBlob` | 267 | O27: Guard antes debootstrap ycada intento, mismo artifactTimeout/Blob parsing; dos controles nativos retry. |
| `getBlob` | 281 | O27: Read binario intacto, caller responsable de snapshot yresultado. |
| `artifactRequest` | 293 | O27: Timeout/Blob.text/JSON retry reason intactos; pruebas esperan I/O real acotado. No Blob cancelado por nuevo guard. |
| `patch` | 319 | O27: Mismo dispatcherprotegido; account/tenant/bootstrap/retry/reselección/UIDme reproducidos. |
| `delete` | 325 | O27: Mismo dispatcherprotegidoybody, cuenta/tenant/bootstrap/retry comprobados. |
| `get$` | 331 | O27: Observable/readdecoder/cancel/timeout intactos; no guard global de éxito. |

## frontend/src/app/core/services/latest-request.ts

O28: función y dependencias leídas; controles acotados a propiedad de lecturas, sin cierre global S01/S13.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 21 | O28: dependency completa leída, destructor invalida read; regresión disposal de injector real. No acreditado uso productivo de raíces múltiples. |
| `begin` | 28 | O28/B149: abort anterior y revision nueva antes de GET init/me; dos respuestas fuera de orden y401cancelado. |
| `invalidate` | 34 | O28/B149: confirmed DTO y transición retiran propietario; no cancela mutación ya enviada. |
| `isCurrent` | 40 | O28/B149: destrucción/revisión/contexto requeridos; guard al decodificar y justo antes de publicar tras nested await. |

O28: AuthService completo y los dos constructores leídos; DestroyRef retira listener storage con su injector y LatestRequest cancela GET al destruir. Test real de disposal verifica ausencia de efecto posterior; no bug ID de raíces múltiples atribuido. Revisión/contratos de writers simultáneos de DTO de la misma cuenta y restantes callers/roles/gates S01–S13 continúan pendientes. Header server es precondición, no autorización ni solución universal a Set-Cookie ya enviado.

## frontend/src/app/core/services/account-profile.service.ts

O29 separa sólo transporte perfil/email; fachada mantiene publicación/generación. No espera previa nueva ni cola de password; API captura intención/CSRF como antes.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `updateName` | 11 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `requestEmail` | 16 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `cancelEmail` | 23 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |

## frontend/src/app/core/services/auth-user-mutations.ts

O29/B153: grupo de commands ya despachados del mismo epoch/ID, no orden por inicio/llegada. Tras settle, único /me si colisión o read concurrente; resultado command confirmado separado de refresh. No passwords retenidas en el grupo, reintento ni abort de writes.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `constructor` | 21 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `identityRead` | 29 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `run` | 33 | O29/B153 + O30: grupo hereda necesidad de reconciliación previa; ACK de seguridad cancela probes y marca grupos abiertos. Test profile previo y nuevo tras ACK impide downgrade de MFA. Sin serializar/reintentar commands. |


## frontend/src/app/panel/settings/settings.component.ts

O29: Settings conserva formularios montados y admite profile/email simultáneos. Aviso compartido muestra confirmación distinta de actualización; read manual deduplicado no reenvía command. Foco vuelve a #account sólo si control seguía elegido; aria-disabled conserva foco durante espera. Constructor/effects de identidad y caller HTML leídos; funciones ajenas no acreditadas.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `saveProfile` | 440 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `settleAfterConfirmedMutation` | 432 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `refreshAccountView` | 457 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `openEmailDialog` | 485 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |
| `loadSessions` | 521 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `startMfaSetup` | 983 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `startMfaReconfiguration` | 988 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `stageMfaSetup` | 996 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `beginMfaReconfiguration` | 1026 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `enableMfa` | 1032 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `disableMfa` | 1055 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `cancelMfaSetup` | 1092 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `cancelMfaReconfiguration` | 1109 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `accountContext` | 1115 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `clearSensitiveMfaUi` | 1119 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `clearMfaSetupUi` | 1131 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `settleUncertainMfaUi` | 1141 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `finishRecoveryCodes` | 1150 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `beginRecoveryRegeneration` | 1157 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `cancelRecoveryRegeneration` | 1163 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `regenerateRecoveryCodes` | 1169 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |

## frontend/src/app/panel/settings/email-access-dialog.component.ts

O29: archivo completo leído; etapas/step-up/success/secret cleanup/close existentes. submit sigue esperando confirmación; reconciliación fallida deja aviso en Settings y no false rollback. QA con formularios/DOM reales, fixture propia sin correo ni DB.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `submit` | 87 | O29/B153: lectura completa, contratos HTTP reales de solapamiento/decoder/contexto; no gate de DB/proveedor/roles nuevo. |

## frontend/src/app/core/services/account-mfa.service.ts

O30: contrato/caller completo leído. Cobertura limitada, sistema y roles restantes abiertos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `setup` | 10 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `enable` | 14 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `cancelSetup` | 18 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `regenerate` | 22 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |
| `disable` | 26 | O30/B154–B156: función/callbacks y caller leídos; HTTP/API/decoder/Auth reales y controles acotados de Settings. No nuevo gate DB/proveedor/roles ni cierre S01. |


## frontend/src/app/core/services/auth-response-decoders.ts

O34/B163: decodeMfaSetup y sus dos callbacks locales completos revisados con emisor/caller; validación del DTO antes de publicar instrucciones.

O30: contrato/caller completo leído. Cobertura limitada, sistema y roles restantes abiertos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `decodeRecoveryCodes` | 298 | O30/B156: v1 exige diez credenciales distintas, cuatro bloques de4 y alfabeto real Ids. Ocho casos enable/regenerate rechazan empty/partial/duplicate/invalid; no publica éxito parcial. Decoder inválido conserva resultado incierto; GET no recupera códigos write-only. |


| `session` | 220 | O33: Lectura completa de shape/strings/booleans, con current y nullablefields; datos válidos ytruncated comprobados por HTTP. Formatos semánticos de fecha se mantienen como strings por contrato vigente, no gate nuevo. |

| `nullableString` | 222 | O33: Callback local de session: null ostring, otros tipos rechazados. Código leído, nestedcallbackconciliado por caller; no nueva policy. |

| `decodeSessionsResponse` | 239 | O33: Lista acotada flagboolean, omissionlegacy→false;[]/truncatedtrue/errorstringflag probados. Sin transformar lectura en éxito vacío. |

| `decodeSessionRevocation` | 251 | O33: oktrue obligatorio/currentboolean si presente; malformed no false logout, currentomitido permiteprotectorlocal porfacade. |

| `decodeSessionsBulkRevocation` | 258 | O33: oktrue/countintegernonnegative,0válido;errshape/false/negativo/string rechazados sin cambios locales. |

| `decodeMfaSetup` | 270 | O34/B163: Base32 nuevo32, manual=QR, cinco parámetros únicos conocidos y coherentes, labelUVH/cuenta, path sin normalización engañosa, tipos/control/fragment/authority inválidos rechazados. Callback forEach cuenta keys y some descarta desconocidas; no cambios en credenciales legacy.47 pruebas de contrato/HTTP más7 callerSettings; full1179, con límites sin cookie/proveedor nativo. |

## backend-laravel/app/Support/Ids.php

O30: contrato/caller completo leído. Cobertura limitada, sistema y roles restantes abiertos.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `randomRecoveryCode` | 33 | Dependencia S13 leída completa para contrato O30/B156: alfabeto y default16 comprobados con newRecoveryCodes/formatRecoveryCode. Sin cambio PHP ni nueva prueba de entropy, random infra o todos los callers. |


O30: constructor Settings y efectos de identidad/incertidumbre leídos junto con HTML MFA. Nunca guardar plaintext codes/secret en Auth; sólo flag de entrega incierta del mismo epoch/ID. Ese flag sobrevive remount SPA y lecturas activas; se limpia al emitir codes válidos, observar factor desactivado o sustituir identidad. No persistencia tras reload ni gate de clipboard/descarga tardía acreditado. El foco de refresh vuelve a la sección originaria (#account/#security) sólo si el usuario conservó el control. Restantes proyecciones de Settings ante cambio de identidad y configuración setup URI/secret siguen como candidatos por revisar, sin bug ID antes de reproducción.

## frontend/src/app/core/services/account-sessions.service.ts

| Función | Línea actual | Estado |
| --- | --- | --- |

| `list` | 11 | O33: Transporte puro GET, decoder yoptions intactos; mismo round trip/context headers; AbortSignal cancela sólo read. Sin almacenamiento/proyección de identidad. |

| `revoke` | 15 | O33: Transporte puro POST a ID encodeURIComponent, body vacío yACK runtime; CSRF/preconditions centrales preservados. No política de invalidación propia. |

| `revokeOthers` | 21 | O33: Transporte puro POST+bulkdecoder; integercount0válido ymalformed/negativo rechazados; no nuevo retry/queue. |

| `revokeAll` | 25 | O33: Transporte puro POST+bulkdecoder; efectos de identity sólo en facade después de guard, ningún callback/publicación aquí. |

O33: cuatro transportes extraídos después de46caracterizaciones vigentes, sin bugID nuevo. Comparación de cuatro métodos completos conserva guard/effects después de adaptar expression API. Backend/DOM/CSS sin cambio; source/controller/tests previosO32 son evidencia anterior. Cinco controles nuevos del caller Settings fortalecen la composición. Gates finales:174dedicado/1125full/lint/tipos/build10,512s, exit0;473hashes y352S01anchors comprobados. No cierreS01.


## backend-laravel/app/Http/Controllers/SecurityIncidentController.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `revokeCompromisedAccess` | 22 | O16: caller HTTP leído; delega TX completa a CompromisedAccessRevocation, conserva cleanup/index/cookie tras resultado confirmado. B132 admite evidencia recuperable sin revertir protección por audit general. O18/B135-B137: dos casos físicos commit/rollback y dos fallbacks disco/logs/métricas pasan; cleanup HTTP espera commit exterior.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |


## backend-laravel/app/Http/Controllers/AccountRecoveryController.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `requestAccountRecovery` | 29 | O17: validación/CAPTCHA/lookup202 y catch genérico conservados; TX completa delegada. Cooldown59/60/61 y cuatro cambios después del lookup comprobados. Tiempo/carga/proveedor real pendientes.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |
| `confirmAccountRecovery` | 57 | O17: sintaxis/preflight y400/200 conservados; TX completa delegada, hash/owner/status y generación/estado vivos comprobados. No concede sesión.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |
| `completeAccountRecovery` | 78 | O17: hash y approvals preflight fuera de locks; TX completa delegada, respuesta/cleanup posteriores. B134 conserva cookie ajena y current booleano; O18/B135-B137: dos casos físicos commit/rollback y dos fallbacks disco/logs/métricas pasan; callback terminal revalida path/status bajo lock.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |


## backend-laravel/app/Support/Auth/AuthAccountLookup.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `activeByEmail` | 10 | Helper leído: trim en caller, lower(email) y deleted excluido; lookup no concede autoridad y servicio revalida bajo lock. Otros callers mantienen gate propio.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |


## backend-laravel/app/Http/Controllers/Concerns/ValidatesAuthInput.php

O46: propietario actual tras separación gradual; evidencia histórica conservada en cada fila. No cierre de S01/S02 ni dobleconteo de dependencia compartida.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `validEmail` | 31 | Helper leído: no vacío, máximo254bytes y filtro PHP; contratos HTTP existentes conservados. No implica entregabilidad del buzón.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |
| `validPassword` | 36 | Helper leído:10..72bytes; fuerza evaluada aparte y con identidad viva en mutación. Contratos locales; coste/rate limit reales pendientes.  O46: dueño trasladado; cuerpo completo preservado tras sólo adaptar lookup,191contratos/1923aserciones antes-después,185runtime-routes y44métodos comparados;Pint489/PHPStan0,full2149/17449/395,866s yJUnit0errors/failures/skips. |

| `captchaError` | 12 | O46: helper completo preservado ytrait compartido Auth/Recovery. Rechazo/proveedor503/hostajeno/ConnectionException porHTTPfake, un intento; publicmessage422/503exacto ysin admisión privada.36nuevos/191dedicados1923aserciones antes-después;full2149/17449/395,866s yJUnit0errors/failures/skips. No proveedor real ni timing productivo. |


O46 final verificado (04/10): **2149/2149 backend,17449aserciones,395,866s/139MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s01-auth-recovery-controllers-full-backend.log`). JUnit2149/17449/errors0/failures0/skipped0,36PublicRecoveryHttpContractTest/431aserciones,393,309949sJUnit en `backend-laravel/storage/logs/s01-auth-recovery-controllers-junit.xml`; summary `.uvh-runtime/s01-auth-recovery-controllers-junit-summary.json`.191/1923dedicado antes32,27s/después32,68s;Pint489/PHPStan0 exit0.15hashes de fuente/test/baseline conservados y479sourcehashes/354S01/16S03/63S10/194S02anchors comprobados después. FullAuth restante/44methodbodies/185runtime-routes/8dependencies y2deletion+6export+4sessions+3TX anteriores preservados tras las adaptaciones declaradas.

AccountRecoveryController3actions ySecurityIncidentController1action son los propietarios reales; shared3validators yactive-email preflight evitan duplicación. AuthController1227líneas/AuthService648,baseline152/141 sin nuevoignore. Sin nuevoBugID/TS/DOM/QA/provider/SMTP/Redis/nativecookie/latency/capacity claim;frontend1373O43 previo. Suites DB secuenciales ysin PHP/tests editados durante full. Handles propios terminales;sharedpostgres/mailpit operativos, sin worker/scheduler/appserver. No uvh_local/users/mail/providers/productioncommands/migraciones externas/commit/push/deploy.

PlanO46 cerrado sólo como extracción local. **Objetivo global/S01–S13 activos; Auth no está totalmente separado.** NextStep vigente: `docs/superpowers/plans/2026-10-04-account-deletion-lifecycle-audit.md`, reproducir admisión primaria deanonimización ycompensaciones protectoras por comando nativo guardado;sourcecandidates sin ID hasta rojo. Después continuar extracción coherente registro/activación ypasswordrecovery. RestoAuth/MFA/profile/sessions,registryTTL/configurable,funciones/roles/retención/capacidad/CI/operación real permanecen pendientes. No redefinir cierre como suites verdes/extracción parcial.


| `validName` | 41 | O48: original helper completo deAuth movido al trait; UTF8válido,2..80caracteres ysin controlesASCII, consumido por registro/activación/perfil. Cuerpo literal preservado y301/2852regresiones antes-después;Pint496/PHPStan0,full2205/18889/398,526s yJUnit0errors/failures/skips. |

## backend-laravel/app/Http/Controllers/RegistrationController.php

O48: propietario de acciones/helpers tras extracción literal. Evidencia histórica conservada;301/2852antes-después93,37s/95,46s, comparación de36cuerpos/comentarios y185routes. Pint496/PHPStan0;full2205/18889/398,526s yJUnit0errors/failures/skips; sin cierre de S01.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `register` | 28 | O12: validación/CAPTCHA/respuestas/cookies conservadas; SQL/mail/audit delegado completo a RegistrationAdmission. Proveedor/tiempo/concurrencia intersistemas con gates separados. O48: cuerpo ydoc completos trasladados sin reescritura. |
| `changeRegistrationEmail` | 89 | O13: validaciones/CAPTCHA/preflight/cookie y errores conservados; TX delegada. O14 revalida intento propio y emite v4; composición comprobada con ocupación/secuencias/replay y full1527/11020. O48: cuerpo ydoc completos trasladados sin reescritura. |
| `verifyEmail` | 145 | O12: contrato legal/token/password y HTTP conservados; activación pending/legacy transaccional delegada, sin sesión; UI/proveedores pendientes propios. O48: cuerpo ydoc completos trasladados sin reescritura. |
| `resendVerification` | 187 | O13: selección/HTTP/floor público; servicio común revalida elegibilidad/cooldown bajo lock, pruebas de carreras/rollback/retry locales. O48: cuerpo ydoc completos trasladados sin reescritura. |
| `findPendingRegistrationByEmail` | 256 | O48: helper completo leído; lookup lower(email)/first idéntico, sólo preflight del reenvío; servicio revalida autoridad bajo lock. Cuerpo íntegro comparado, sin nueva garantía de delivery o coste. |


## backend-laravel/app/Http/Controllers/PasswordRecoveryController.php

O48: propietario de acciones/helpers tras extracción literal. Evidencia histórica conservada;301/2852antes-después93,37s/95,46s, comparación de36cuerpos/comentarios y185routes. Pint496/PHPStan0;full2205/18889/398,526s yJUnit0errors/failures/skips; sin cierre de S01.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `forgotPassword` | 26 | O15: caller tipado; validación/CAPTCHA/floor y fallo público conservados; solicitud transaccional delegada. Cooldown y lookup/lock locales comprobados. O48: cuerpo ydoc completos trasladados sin reescritura. |
| `resetPassword` | 52 | O15: caller tipado; hash fuera del lock; reset transaccional completo delegado. Replay/kind/owner/expiry/live identity y cookie propia/ajena comprobados; no sesión emitida. O48: cuerpo ydoc completos trasladados sin reescritura. |


## backend-laravel/app/Http/Controllers/Concerns/EqualizesPublicMailDuration.php

O48: propietario de acciones/helpers tras extracción literal. Evidencia histórica conservada;301/2852antes-después93,37s/95,46s, comparación de36cuerpos/comentarios y185routes. Pint496/PHPStan0;full2205/18889/398,526s yJUnit0errors/failures/skips; sin cierre de S01.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `equalizePublicMailDuration` | 18 | Lectura completa; suelo configurable hrtime/usleep, sin garantía de tiempo constante bajo toda carga. Controles existentes de ramas públicas conservados. O48: cuerpo ydoc completos trasladados sin reescritura. |


## backend-laravel/app/Http/Controllers/AccountProfileController.php

O49: cuerpos/comentarios completos movidos literalmente; propietario real sin herencia ni forwarding a Auth. 185contratos runtime idénticos salvo11owners;23dependencias hash-preservadas. Regresión300/2669antes-después46,63s/47,25s;Pint500/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;683hashes conservados. Evidencia histórica conservada, sin cierre S01 ni gate UI/proveedores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `me` | 17 | O23: resolve por petición y payload AccountQueries; SQL/401 conservados. GET real sin FOR UPDATE/TX de negocio, secretos ni cookie nueva con CSRF existente; UI mantiene gate. O49: traslado literal del método ycomentarios. |
| `profile` | 27 | O22: validación y DTO conservados; delega TX completa a ProfileAdmission. Nombre y exact audit bajo autoridad viva, outer commit/rollback/retry comprobados; no step-up nuevo. O49: traslado literal del método ycomentarios. |


## backend-laravel/app/Http/Controllers/AccountCredentialsController.php

O49: cuerpos/comentarios completos movidos literalmente; propietario real sin herencia ni forwarding a Auth. 185contratos runtime idénticos salvo11owners;23dependencias hash-preservadas. Regresión300/2669antes-después46,63s/47,25s;Pint500/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;683hashes conservados. Evidencia histórica conservada, sin cierre S01 ni gate UI/proveedores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `requestEmailChange` | 31 | O20: caller HTTP completo; validación/preflight/token/url conservados y TX delegada. B139 rechaza reserva ajena vigente con rollback y mismo409. Factor inválido no revela ocupación; native PostgreSQL sin ciclo. UI/gates reales pendientes. O49: traslado literal del método ycomentarios. |
| `cancelEmailChange` | 109 | O20: caller HTTP conservado; TX completa delegada. Cancelación con/sin pendiente mantiene consumption de recovery y exact audit; outer rollback/retry comprobados. UI/gates reales pendientes. O49: traslado literal del método ycomentarios. |
| `confirmEmailChange` | 156 | O20: lookup/sintaxis/HTTP/current conservados; TX completa delegada. Siete cambios tras lookup, ocupación User/Pending, expiry/replay y outer rollback/mail doble/audit comprobados. UI/gates reales pendientes. O49: traslado literal del método ycomentarios. |
| `changePassword` | 191 | O19: caller HTTP completo, validación/hash fuera de locks y catches/status sin cambios. TX completa delegada;18 nuevas caracterizaciones y93/873 antes/después. Hash a TXlevel0 y own-session/current policy conservados; dependencias/UI/gates reales abiertos. O49: traslado literal del método ycomentarios. |
| `appUrl` | 266 | Wrapper leído hacia FrontendUrl::base; notices/password usan mismo propietario compartido tras traslado. Configuración del despliegue mantiene su gate. O49: traslado literal del método ycomentarios. |


## backend-laravel/app/Http/Controllers/AccountSessionsController.php

O49: cuerpos/comentarios completos movidos literalmente; propietario real sin herencia ni forwarding a Auth. 185contratos runtime idénticos salvo11owners;23dependencias hash-preservadas. Regresión300/2669antes-después46,63s/47,25s;Pint500/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;683hashes conservados. Evidencia histórica conservada, sin cierre S01 ni gate UI/proveedores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `sessions` | 17 | O23: caller y proyección completa separados; current validado, orden estable y límite101→100/truncated conservados. GET sin locks de mutación; volumen/UI pendientes. O49: traslado literal del método ycomentarios. |
| `securityCenter` | 31 | O23: caller y proyección completa separados; scopes, allowlist, limit21→20/truncated sin metadata/IP conservados. GET sin locks de mutación; UI pendiente. O49: traslado literal del método ycomentarios. |
| `revokeSession` | 41 | O24: caller HTTP leído; TX completa en SessionRevocationAdmission, SQL/policy/cookies/404/409/503 conservados.15 controles nuevos,66/604 antes/después y134/1007 final conjunto; UI mantiene gate. O49: traslado literal del método ycomentarios. |
| `revokeOtherSessions` | 69 | O24: caller HTTP leído; TX completa en SessionRevocationAdmission, SQL/policy/cookies/404/409/503 conservados.15 controles nuevos,66/604 antes/después y134/1007 final conjunto; UI mantiene gate. O49: traslado literal del método ycomentarios. |
| `revokeAllSessions` | 96 | O24: caller HTTP leído; TX completa en SessionRevocationAdmission, SQL/policy/cookies/404/409/503 conservados.15 controles nuevos,66/604 antes/después y134/1007 final conjunto; UI mantiene gate. O49: traslado literal del método ycomentarios. |


## backend-laravel/app/Http/Controllers/Concerns/NormalizesRecoveryCodes.php

O49: cuerpos/comentarios completos movidos literalmente; propietario real sin herencia ni forwarding a Auth. 185contratos runtime idénticos salvo11owners;23dependencias hash-preservadas. Regresión300/2669antes-después46,63s/47,25s;Pint500/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;683hashes conservados. Evidencia histórica conservada, sin cierre S01 ni gate UI/proveedores.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `normalizeRecoveryCode` | 8 | Helper completo leído; trim, mayúsculas y retirada de espacios/guiones conservados; factor sigue comprobándose bajo lock. O49: traslado literal del método ycomentarios. |


## backend-laravel/app/Http/Controllers/MfaChallengeController.php

O50: propietario real sin herencia/forwarding. Todos14cuerpos/docs yclase restante comparados;12literales/dos sólo quitan coalesce redundante garantizado porgetfinal;9acciones+3helpers movidos;185runtime-routes idénticas salvo9classes;34dependencias ynormalización compartida intactas;baseline149/139retira sólo la supresión previa(count2). Regresión378/3444antes71,73s/después final62,67s;Pint503/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;686hashes conservados. No gate frontend/provider/capacity ni cierre global.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `mfaVerify` | 21 | Caller MfaLoginAdmission::totp, resultado union y JsonResponse tipados; consumo/fallback/rollback locales comprobados; lock/presupuesto/HTTP aún aquí O50: traslado literal completo. |
| `mfaRecovery` | 100 | Caller MfaLoginAdmission::recovery, resultado union/JsonResponse tipados; B126 distingue cuenta obsoleta de código incorrecto; marker conservado al fallar cleanup O50: traslado literal completo. |


## backend-laravel/app/Http/Controllers/MfaSessionController.php

O50: propietario real sin herencia/forwarding. Todos14cuerpos/docs yclase restante comparados;12literales/dos sólo quitan coalesce redundante garantizado porgetfinal;9acciones+3helpers movidos;185runtime-routes idénticas salvo9classes;34dependencias ynormalización compartida intactas;baseline149/139retira sólo la supresión previa(count2). Regresión378/3444antes71,73s/después final62,67s;Pint503/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;686hashes conservados. No gate frontend/provider/capacity ni cierre global.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `mfaSessionStatus` | 20 | O23: caller completo y AccountQueries::mfaSession; estado/fechas exactas B120 y SQL/401 conservados. Contexto vivo por petición; GET sin locks/TX de negocio. UI mantiene gate. O50: traslado literal completo. |
| `mfaReauthenticate` | 31 | O22: caller HTTP y rechazos conservados; delega TX completa a ReauthenticationAdmission. Factor concreto, audit/IP hasheada y outer commit/rollback/replay comprobados; no rotación de sesión. O50: traslado literal completo. |
| `iso` | 73 | Helper completo leído haciaIsoDate::format; original cuerpo/documentación preservados. Configuración/relojes distribuidos conservan gate. O50: traslado literal completo. |


## backend-laravel/app/Http/Controllers/MfaConfigurationController.php

O50: propietario real sin herencia/forwarding. Todos14cuerpos/docs yclase restante comparados;12literales/dos sólo quitan coalesce redundante garantizado porgetfinal;9acciones+3helpers movidos;185runtime-routes idénticas salvo9classes;34dependencias ynormalización compartida intactas;baseline149/139retira sólo la supresión previa(count2). Regresión378/3444antes71,73s/después final62,67s;Pint503/PHPStan0,full2205/18889 yJUnit0errors/failures/skips;686hashes conservados. No gate frontend/provider/capacity ni cierre global.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `mfaSetup` | 24 | O21: caller completo; generación/cifrado fuera de locks, input/HTTP preservados. Setup recovery/estado pendiente y outer rollback/retry comprobados; no reemplaza activo. O50: traslado literal completo. |
| `mfaEnable` | 59 | O21: caller HTTP completo; código/generación aleatoria/formato/catches conservados. TX completa delegada; first/reconfigure, autoridad viva y outer rollback/TOTP replay comprobados; UI/reloj/provider real pendientes. O50: traslado literal completo. |
| `mfaCancelSetup` | 95 | O21: caller completo; cancela sólo pendiente sin step-up, con cuenta/sesión vigente. Outer rollback/retry conserva factor activo y códigos. O50: traslado literal completo. |
| `mfaRegenerateRecoveryCodes` | 109 | O21: caller completo; input/codes aleatorios/formato/HTTP conservados. Reemplazo/generación/sesiones/casos/notice/exact audit en TX; autoridad y outer rollback/retry verificados. O50: traslado literal completo. |
| `mfaDisable` | 157 | O21: caller completo; preflight/HTTP/catches conservados. Factor concreto, prohibición admin y commit de rotación/revocación/cancel/notice/audit permanecen; autoridad y outer rollback/retry verificados. O50: traslado literal completo. |
| `newRecoveryCodes` | 208 | Helper completo leído;10 cadenas aleatorias usando Ids antes de locks. Respuesta/hash de10 códigos comprobados; entropy/infra real conserva gate. O50: traslado literal completo. |
| `formatRecoveryCode` | 218 | Helper completo leído; grupos de4 y guiones; char42 comprueba respuesta normalizada contra hashes persistidos. O50: traslado literal completo. |

## frontend/src/app/core/services/auth-entry.service.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `login` | 17 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `verifyMfa` | 21 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `recoverMfa` | 25 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `logout` | 29 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `mfaSessionStatus` | 33 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `reauthenticateMfa` | 37 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |

## frontend/src/app/core/services/registration.service.ts

| Función | Línea actual | Estado |
| --- | --- | --- |
| `register` | 11 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `resendVerification` | 31 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |
| `changeRegistrationEmail` | 35 | O52: transporte puro; clase entera comparada con expresiones/cuerposHTTP originales. Generación/publicación/CSRF/anti-enumeración permanecen en fachada/cliente/servidor.24contratos HTTP nuevos,407caracterización antes/después,types/lint/build verdes; full1397/1397,804hashesintactos, sin nuevoBugID ni medición de latencia. |

## frontend/src/app/core/services/auth-session-contracts.ts

O52: cuatro declaraciones públicas de tipos originales trasladadas literalmente; AuthService conserva re-export público ydecoder sólo cambia importtype. Archivo sin funciones; no sumar anchors de funciones ni atribuir nuevo gate de DTO/backend.

## frontend/src/app/auth/auth-flow-state.ts

O53: unión discriminada de tipos, sin funciones. Login/registro/verificación no admiten desafío; MFA y recuperación comparten challenge y recoveryAvailable. Las tres proyecciones del componente son readonly; las transiciones escriben el estado completo. No añadir función ficticia ni atribuir nueva garantía de backend a este módulo.

O54: el módulo auth-flow-state ahora declara también etapa/modo de registro, originalEmail para corrección y source/email para las tres procedencias de verificación. Tipos completos leídos/comparados; rama MFA literalmente preservada. No contiene funciones ni reemplaza autorización firmada del servidor. B186 y el nuevo bloque de estado tienen417auth/1407full/types/lint/build yQA3POSTs con límites documentados.
