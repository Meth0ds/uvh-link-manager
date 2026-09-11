# hCaptcha: excepción explícita para desarrollo local

`HCAPTCHA_DEV_FALLBACK=true` permite continuar los formularios de acceso de
desarrollo cuando el widget no consigue una respuesta o el verificador de
hCaptcha no está disponible. Por defecto está desactivada. Se ha activado en
el `.env` local de este checkout; no debe copiarse a un despliegue.

El backend exige **todas** estas condiciones en cada petición:

- `APP_ENV=local` exactamente (no staging, testing ni production).
- `APP_DEBUG=true` y `HCAPTCHA_DEV_FALLBACK=true` como booleanos.
- Tanto `APP_HOST` como el host de la petición son `localhost`, `127.0.0.1` o `::1`.

La API publica únicamente un booleano de capacidad en `/api/v1/config`.
La pantalla de acceso muestra un aviso permanente. Si el widget funciona,
se sigue enviando un token real a la verificación oficial. Si falla, el
marcador `uvh-local-captcha-unavailable` solicita la excepción: **no es una
credencial** y el servidor vuelve a comprobar todas las condiciones.
Una caída de `/config` nunca concede la excepción. Un token rechazado por
el proveedor tampoco se convierte automáticamente en válido.

La excepción pertenece exclusivamente a la comprobación antiabuso de
autenticación: se mantienen contraseñas, consentimiento de registro,
verificación de email, MFA, honeypots, CSRF y límites de frecuencia.
Las denuncias públicas siguen fallando de forma cerrada. La aplicación de
producción rechaza el arranque si se ha activado esta variable, además de
rechazar el marcador en tiempo de ejecución fuera de los gates locales.

El navegador no puede demostrar criptográficamente una caída del widget;
por eso un desarrollador local puede fabricar el marcador. No exponer este
entorno de depuración a Internet ni mediante túneles/proxies públicos. El
Compose local publica los servicios en loopback. La configuración no convierte
un entorno local accesible desde fuera en uno apto para producción.

Tras cambiar la opción, reinicia los procesos locales que mantengan configuración
en memoria. Si se usa caché de configuración, debe regenerarse explícitamente.
No es necesario ejecutar migraciones. Para desactivarla, usa
`HCAPTCHA_DEV_FALLBACK=false`.
