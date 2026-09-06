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

## Cobertura actual: 15 recorridos

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

## Qué no acredita

La suite no convierte el proyecto en listo para producción. Siguen requiriendo
evidencia separada el navegador y dispositivo reales adicionales, accesibilidad
manual, DNS/TLS, proxy y cookies de producción, correo y webhooks externos,
concurrencia multiproceso, backups/restauración, observabilidad y revisión
legal. Consulta `production-readiness.md` para el inventario completo.
