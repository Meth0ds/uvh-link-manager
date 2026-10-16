# Enlaces que abren aplicaciones

UVH ofrece adaptadores HTTPS para Spotify, YouTube, Google Maps y Apple Maps, y asociaciones para aplicaciones propias en dominios personalizados. No detecta instalaciones ni confirma aperturas. Las métricas continúan siendo **visitas**.

## Activación y despliegue

1. Ejecutar `php artisan migrate --force` antes de desplegar el frontend.
2. Desplegar Laravel y la configuración Nginx actualizada. Los documentos de asociación y `/a/` deben llegar a Laravel, también en el edge de dominios personalizados.
3. Desplegar Angular. `UVH_FEATURE_APP_PROVIDERS` y `UVH_FEATURE_NATIVE_APPS` son independientes y están desactivadas por defecto. La API pública de configuración controla la presentación del editor.
4. Activar proveedores tras las comprobaciones del flujo web. Activar aplicaciones propias únicamente para validar una app firmada con HTTPS público. La publicación de JSON no acredita la integración nativa.
5. Comprobar errores, latencia y volumen de admisiones mediante los mecanismos operativos existentes. No incluir cuerpos de resolución, contraseñas, comprobantes ni URLs completas en logs, APM o capturas de red compartidas.

Las admisiones se limpian cada cinco minutos mediante el scheduler. Sus destinos están cifrados en reposo y participan en `uvh:rotate-app-secret`. La eliminación del enlace/workspace elimina sus recibos. El rollback operativo consiste en desactivar las dos funciones; no ejecutar la migración descendente mientras existan datos que se quieran conservar.

## Configuración del enlace

`appOpening` es opcional. Omitirlo conserva su valor; `null` lo elimina. Se integra en creación, edición, duplicación, plantillas, historial y exportación de cuenta. El destino HTTP/HTTPS sigue siendo obligatorio. No se amplían los esquemas aceptados por el validador general.

```json
{"version":1,"kind":"provider","provider":"spotify","url":"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"}
```

Proveedores admitidos: `spotify`, `youtube`, `google_maps`, `apple_maps`. Se aceptan formatos explícitos de contenido, no acortadores opacos que requieran visitar un sitio remoto para descubrir su destino. Spotify elimina parámetros de seguimiento; YouTube normaliza vídeos y listas; Maps conserva únicamente los parámetros de lugares/rutas admitidos. Nunca se aceptan `intent:` escritos por el usuario, esquemas arbitrarios ni credenciales incrustadas.

```json
{"version":1,"kind":"native","profileId":"UUID_DEL_PERFIL","route":"/productos/123"}
```

Las reglas y el fallback tienen prioridad y siguen respondiendo mediante web. La apertura en app se aplica al destino principal. En escritorio se utiliza la redirección web. En dispositivos móviles se ofrece una pantalla con apertura y alternativa web; la delegación de los enlaces HTTPS de proveedores depende del navegador y del sistema. No se usan temporizadores ni falsas confirmaciones de apertura.

`shortUrl` mantiene la dirección antigua. `appLaunchUrl` incorpora `/a/` para apps propias cuando la función está activa; `shareUrl` es la dirección recomendada para copiar o crear QR nuevos. Los QR ya impresos conservan su URL. Las variantes QR mantienen `?qr=...` en la dirección de apertura.

## Perfil de aplicación propia

`GET/PATCH /api/v1/domains/{id}/app-profile`. Solo propietarios y administradores pueden modificarlo. `PATCH` requiere `Idempotency-Key` y `version` (0 al crear). Todos los miembros pueden consultar el perfil; los editores pueden usarlo en enlaces del mismo workspace y dominio.

- Apple: App ID Prefix real y Bundle ID, por ejemplo `ABCDE12345.es.empresa.app`.
- Android: paquete y entre 1 y 10 huellas SHA-256, separadas por `:`. Utilizar las firmas de distribución/Play App Signing correspondientes. No se necesitan claves privadas.
- Prefijos: rutas como `/productos/` o `/ofertas/`. Se rechazan escapes, traversal, query strings, fragmentos y rutas absolutas de otro host.
- Publicación: exige dominio reclamado, activo y HTTPS operativo. El dominio público compartido de UVH no admite perfiles de clientes.

`POST /api/v1/domains/{id}/app-profile/diagnose` es explícito, está limitado y utiliza el transporte SSRF existente, sin redirecciones. Distingue dominio operativo, contenido servido por HTTPS y prueba en dispositivo **pendiente**. Un fallo de red no implica que una app esté mal integrada.

### Apple

Añadir a los entitlements de la app firmada:

```xml
<key>com.apple.developer.associated-domains</key>
<array><string>applinks:enlaces.empresa.es</string></array>
```

UVH sirve `https://enlaces.empresa.es/.well-known/apple-app-site-association`, sin autenticación ni redirección, y con rutas limitadas a `/a/*`. Gestionar `NSUserActivity.webpageURL` con [UvhAppLinks.swift](UvhAppLinks.swift), resolver y después navegar mediante una lista propia de pantallas permitidas. No convertir el texto recibido en una clase, selector ni comando ejecutable.

### Android

Declarar **estáticamente** el prefijo en el manifiesto; no depender solo de reglas dinámicas de Android 15:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="enlaces.empresa.es" android:pathPrefix="/a/" />
</intent-filter>
```

UVH sirve `/.well-known/assetlinks.json`, con paquete y huellas públicas. Las reglas dinámicas también excluyen lo que queda fuera de `/a/`, pero no sustituyen el manifiesto en dispositivos anteriores. Gestionar `intent.data` con [UvhAppLinks.kt](UvhAppLinks.kt). El ejemplo utiliza OkHttp y `org.json` de Android; ejecutar en un trabajador IO. Las actividades y las pantallas internas necesitan su propia autorización, independientemente de la contraseña del enlace.

## Protocolo de resolución obligatorio

`POST https://uvh.es/api/v1/app-links/resolve` (o el origen público fijo de tu despliegue UVH), JSON explícito. **La app debe fijar este origen de confianza en su configuración: nunca construir el endpoint a partir del enlace entrante.** Así, un nuevo titular del dominio no puede suplantar UVH mientras una asociación antigua siga en caché. Los ejemplos separan `host` (dominio del enlace) de `resolverOrigin` (servidor UVH de confianza). Si UVH no responde, no consultar un endpoint alternativo en el dominio del enlace ni mostrar contenido almacenado. No enviar cookies del panel, cabeceras de workspace, credenciales de UVH ni Authorization. Para la página web de continuación se mantiene un alias del resolver en el dominio gestionado, validado contra ese mismo dominio; las apps deben usar siempre el origen fijo de UVH. El servidor ignora sesiones ambientales y rechaza orígenes web ajenos.

```json
{"launchUrl":"https://enlaces.empresa.es/a/producto?qr=ID_OPCIONAL","profileId":"UUID_ESPERADO","attemptId":"UUID_NUEVO_POR_APERTURA"}
```

1. Recibir `202 {"kind":"challenge_required","challenge":"..."}`. No consume visitas.
2. Repetir con el desafío. Mantener el mismo `attemptId` para reintentos por fallo de red y para el formulario de contraseña.
3. `401 {"kind":"password_required"}`: solicitar la contraseña y repetir explícitamente con `password`. No reutilizar una cookie de desbloqueo del navegador. Los intentos comparten el presupuesto de fuerza bruta del desbloqueo web.
4. `200 {"kind":"content","route":"/productos/123","profileId":"...","webUrl":"...","grant":"..."}`: comprobar perfil y prefijo localmente antes de navegar. La app sigue obligada a autorizar el contenido con su propio sistema.
5. `200 {"kind":"web","webUrl":"...","grant":"..."}`: abrir el destino HTTP/HTTPS autorizado; no interpretar una ruta nativa. Una regla puede producir este resultado.
6. `404/410 {"kind":"unavailable"}`: no mostrar contenido almacenado ni navegar basándose solo en el alias. `429` implica esperar el `Retry-After` disponible.

El comprobante dura como máximo cinco minutos, nunca más que el enlace, y está vinculado a enlace, contexto QR y versiones de seguridad/perfil. Se verifica la disponibilidad actual en cada continuación. El destino almacenado va cifrado; el comprobante firmado solo identifica el recibo. La contraseña no se persiste en recibos ni snapshots.

Para proveedores, el botón de apertura es un enlace preparado antes de pulsarlo. Su continuación comprueba un recibo mediante una cookie `HttpOnly`, limitada a la ruta de esa admisión; nunca transporta el comprobante en la URL. La alternativa web utiliza la misma continuación de lectura; el endpoint POST de compatibilidad conserva su protección CSRF. Ninguna de estas continuaciones admite visitas nuevas.

La pantalla web puede entregar `#grant=...` a la app, con `?handoff=1` para impedir ciclos si no está instalada. Extraer el fragmento a memoria, retirarlo de la URL y enviarlo exclusivamente en el cuerpo JSON. La pantalla de continuación sin app usa el mismo resolver y vuelve a validar antes de abrir el destino web. No copiar comprobantes a logs, preferencias o analítica. Los ejemplos mantienen cada apertura en memoria y no ofrecen modo offline. Envían idioma y un User-Agent móvil explícito: no usar el User-Agent por defecto de OkHttp/URLSession, porque impediría evaluar correctamente las reglas de dispositivo y sistema. En iPad, utilizar un identificador de iPad/Tablet apropiado; estos encabezados son contexto orientativo, nunca autorización.

Una admisión consume una visita. El reintento y la continuación con recibo no consumen otra. La admisión, el evento analítico deduplicado y el recibo se confirman juntos; las consultas técnicas, HEAD y lectores sociales no generan visitas.

## Validación externa que sigue siendo obligatoria

Con una app propia firmada y un dominio HTTPS público, comprobar iPhone/Android físicos: instalada/ausente, mensajes, QR, navegadores integrados, contraseñas, límites, reglas, revocación, caché de asociaciones y alternativa web. Los ejemplos y las pruebas automatizadas del servidor no acreditan compatibilidad real. No anunciar instalaciones detectadas, aperturas confirmadas ni recuperación de contenido tras instalar.

Referencias primarias: [Apple Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains), [Android App Links](https://developer.android.com/training/app-links/about), [Android Asset Links](https://developer.android.com/training/app-links/configure-assetlinks), [Chrome Intents](https://developer.chrome.com/docs/android/intents), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), [Spotify IDs](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids).
