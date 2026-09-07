# Pruebas E2E en navegador

La suite Playwright valida los recorridos críticos con Chromium, Angular,
Laravel y PostgreSQL reales. No simula la API: únicamente sustituye hCaptcha y
la entrega externa de correo por adaptadores locales deterministas. El backend
sigue verificando cada token antiabuso servidor a servidor.

## Aislamiento y seguridad

- Docker Compose crea `uvh_e2e_test` en un volumen efímero independiente.
- El arranque aborta antes de migrar si `DB_DATABASE` no termina en `_test`.
- `APP_ENV=testing`, claves y contraseñas son fixtures fijos sin valor fuera de
  esta pila.
- PostgreSQL y el stub de hCaptcha no publican puertos al host. Laravel sólo se
  publica en `127.0.0.1:8010` y Angular en `127.0.0.1:4201`.
- El lector de correo se niega a funcionar fuera de `testing` o sobre una base
  no terminada en `_test`; descifra como máximo 100 filas y sólo devuelve el
  enlace del destinatario y tipo solicitados.
- Tokens API, secretos TOTP y códigos de recuperación permanecen en memoria y
  nunca se escriben en logs, capturas ni comandos de shell.
- Los helpers que envejecen sesiones o papelera vuelven a comprobar
  `APP_ENV=testing` y el sufijo `_test`. El de papelera exige además workspace,
  prefijo sin comodines y cardinalidad exacta antes de modificar una sola fila.
- El teardown elimina contenedores, red y volúmenes incluso cuando falla una
  aserción. Si una ejecución se interrumpe de forma abrupta, `pree2e` limpia la
  pila exacta `uvh-e2e` antes de volver a empezar.

No apuntes esta suite a `uvh_local`, a una base compartida ni a infraestructura
real.

## Ejecución

Requisitos: Docker Desktop operativo, Node.js 22 y las dependencias bloqueadas
del frontend.

```powershell
Set-Location frontend
npm ci
npm run e2e:install
npm run e2e
```

Para aislar un recorrido durante la depuración:

```powershell
npm run e2e -- --grep "token mínimo"
```

Los fallos conservan captura, vídeo y trace bajo `frontend/test-results`; esos
artefactos están ignorados por Git. CI los adjunta durante siete días sólo si
el job falla.

## Cobertura actual: 27 recorridos

La ejecución conjunta más reciente terminó con 27/27 en 27,6 minutos el 7 de
septiembre de 2026, usando un único worker. El teardown eliminó la base, los
contenedores, la red y los volúmenes efímeros.

1. Registro, verificación por email e inicio de sesión.
2. Bloqueo de sesión para una cuenta no verificada.
3. Registro duplicado sin enumeración de cuentas.
4. Redirección de una ruta privada al login.
5. Recuperación de contraseña y revocación de la contraseña anterior.
6. Rechazo de un enlace de verificación ya consumido.
7. Logout y rechazo posterior de rutas privadas.
8. Configuración pública de hCaptcha sin secretos.
9. Recuperación de email desconocido con respuesta genérica.
10. Creación de workspace y ciclo crear/pausar/editar/eliminar/restaurar enlace.
11. Cambio de email, cierre de sesiones y traslado del acceso.
12. Alta MFA por TOTP y consumo único de un código de recuperación.
13. Solicitud y cancelación de exportación con invalidación del enlace.
14. Creación, uso y revocación efectiva de un token Bearer de alcance mínimo.
15. Invitación y aceptación por el destinatario verificado con rol `viewer`.
16. Uso y límites con roles reales `owner`, `admin`, `editor` y `viewer`.
17. Centro de seguridad minimizado y revocación de la sesión actual.
18. Purga irreversible con contraseña, TOTP y doble confirmación.
19. Uso con teclado, reflow móvil y Axe WCAG A/AA.
20. Revocación independiente de una sesión remota desde otro navegador.
21. Reautenticación administrativa de una sesión MFA envejecida.
22. Carrera multiproceso de clic/restore con contador exacto.
23. Carrera multiproceso de restore/purge con un único ganador.
24. Carrera entre restore y housekeeping sobre papelera envejecida.
25. Primeros pasos aislado por cuenta/workspace, omisión/reanudación y cambio real
    de `viewer` a `editor`, con teclado, móvil y Axe.
26. Actividad con `owner`/`admin` autorizados, ausencia de petición para
    `editor`/`viewer` y respuesta minimizada, con teclado, móvil y Axe.
27. Estado público sin feed: HTTP 503 y estado desconocido tras carga/actualización,
    con navegación por teclado, reflow móvil y Axe.

## Qué no acredita

La suite no convierte el proyecto en listo para producción. Siguen requiriendo
evidencia separada el navegador y dispositivo reales adicionales, accesibilidad
manual, DNS/TLS, proxy y cookies de producción, correo y webhooks externos,
concurrencia multiproceso fuera de las carreras concretas ya cubiertas,
backups/restauración, observabilidad y revisión legal. Consulta
`production-readiness.md` para el inventario completo.
