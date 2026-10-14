# Informes compartidos y tarjetas sociales — validación local

14 de octubre de 2026. Angular y Laravel reales, PostgreSQL mediante Docker. Sin subagentes. Las capturas contienen exclusivamente una cuenta y datos sintéticos; no contienen URL de acceso, secretos ni sesiones.

## Alcance implementado

- Informes vivos de hasta 100 enlaces, etiquetas públicas explícitas, periodo y secciones fijados por el autor. Gestión restringida a propietario/administrador, paginación, edición, copia, revocación y regeneración de acceso.
- URL con secreto en fragmento, retirado antes del intercambio; cookie independiente limitada al informe y a 30 minutos, contraseña opcional, versión de acceso, origen y CSRF. Idempotencia cifrada y compatibilidad con rotación de claves. Ningún destino, nota, miembro ni identificador de visitante se publica.
- Tarjeta social en Destino y detalle, título/imagen independientes del nombre interno, recorte local, normalización JPEG 1200 × 630, imagen privada y publicación ligada al enlace disponible. Integración en duplicación, plantillas, historial y restauración; una revisión antigua sin el campo conserva la tarjeta actual.
- Lectores sociales acotados, tarjetas neutras con contraseña, HTML escapado, imágenes sin consumo ni estadísticas. Las variantes QR propias conservan su URL canónica; variantes ajenas no se incorporan. Navegadores normales e integrados conservan la redirección.
- Cuotas, limpieza de cargas y referencias históricas, recibos duraderos tras borrados en cascada e índices concurrentes para las referencias de imágenes.

## Comprobaciones realizadas

- Suite backend completa: **3015 pruebas / 35029 aserciones**. Tras los ajustes finales se ejecutaron las áreas afectadas: **85 pruebas / 578 aserciones**, y posteriormente **20 pruebas / 175 aserciones** de informes y tarjetas tras ampliar la carga de prueba. Además, 13 pruebas / 816 aserciones de contratos de configuración, limitadores y esquema pasaron al cierre. Estas ejecuciones se solapan; no se suman sus recuentos.
- Suite frontend final: **2254 pruebas** en ChromeHeadless. TypeScript, ESLint y build de producción correctos.
- PHPStan sin errores; Pint correcto en 602 archivos; `git diff --check` correcto. Las tres migraciones nuevas se aplicaron en `uvh_local` y `uvh_test`. Configuración Nginx validada con `nginx -t` en su imagen Docker.
- Informe con **100 enlaces y 50.000 eventos**: total y desgloses exactos, menos de 35 consultas incluyendo middleware/autorización; sin consultas por enlace.
- Chromium y WebKit: creación completa, acceso anónimo con contraseña, rechazo de contraseña incorrecta y fragmento inválido incluso con cookie válida, retirada del fragmento, carga/recorte de imagen y guardado de tarjeta.
- Revisión a 320, 390, 768, 1024 y 1440 px, tema oscuro y ventana de 600 px de altura. Sin desbordamiento horizontal y acciones visibles en los modales. Axe: cero infracciones detectadas en los tres flujos principales comprobados. Esto no sustituye la revisión manual de accesibilidad.
- Composer sin avisos de vulnerabilidades. La política npm no bloquea dependencias; mantiene las excepciones existentes de herramientas de desarrollo hasta el 9 de noviembre de 2026. No se afirma que npm tenga cero avisos.

## Capturas

- `report-editor-*.png`: editor, selección y vista previa; incluye escritorio, móvil y oscuro.
- `public-report-*.png`: informe real con 165 visitas sintéticas, países/dispositivos, contraseña y acceso no disponible.
- `social-card-editor-*.png`: imagen realmente normalizada, recorte y configuración; incluye oscuro y ventana corta.

## Reproducir el recorrido visual

Requiere Docker local, frontend en `http://localhost:4200`, migraciones y ambas activaciones locales. Desde la raíz del repositorio:

```sh
umask 077
docker compose -f docker-compose.local.yml --env-file .env.docker.local exec -T app php < frontend/e2e/sharing-fixture.php > /tmp/uvh-sharing-fixture.json
node frontend/e2e/sharing-smoke.mjs
```

La herramienta crea una cuenta de prueba con contraseña aleatoria, un workspace y visitas sintéticas. Solo admite `APP_ENV=local` y la base `uvh_local`. No introduce rutas de autenticación de prueba. El JSON temporal contiene una sesión: no publicarlo, registrarlo ni incluirlo en Git. Para borrar exclusivamente esa cuenta, pasar su `userId` como variable `UVH_SHARING_CLEANUP_USER` a la misma herramienta; se comprueba el patrón de email reservado de la fixture. Después eliminar el JSON temporal. La cuenta usada para estas capturas se eliminó tras la comprobación.

Pruebas backend siempre contra la base aislada:

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local exec -T -e DB_DATABASE=uvh_test app php artisan test --filter='SharedAnalyticsReportsTest|SocialPreviewTest'
npm --prefix frontend test -- --watch=false --browsers=ChromeHeadless
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

## Pendiente antes de aceptación externa

Firefox está instalado pero falla al arrancar en este entorno; no se validó. WebKit automatizado no acredita Safari nativo ni dispositivos físicos. Los lectores de Facebook, LinkedIn, X y otras plataformas requieren un dominio HTTPS público para probar presentación y caché reales; localhost no permite esa comprobación. No se ha desplegado en producción. El backend debe desplegarse y migrarse antes del frontend; las activaciones de producción siguen deshabilitadas por defecto.

Metadatos contrastados con la [especificación Open Graph](https://ogp.me/). La [documentación de Dub](https://dub.co/help/article/custom-link-previews) también describe las limitaciones de caché; el editor incluye aviso y enlaces a inspectores oficiales, sin prometer actualización inmediata.
