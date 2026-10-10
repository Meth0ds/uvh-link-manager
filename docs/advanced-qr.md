# QR avanzados

Los QR comparten una escena geométrica para la vista previa, PNG, SVG y PDF. El contrato `QrDesignSpec` versión 1 contiene solo diseño: ninguna URL, lienzo ni archivo. El SVG tiene módulos y marca UVH vectoriales, texto trazado y logos propios PNG incrustados. El PDF usa la misma escena vectorial y Manrope incrustada, con texto buscable; únicamente los logos propios son imágenes.

## Uso

En **Enlaces**, el botón QR abre **Diseño**, **Archivo** e **Imprimir**. En Diseño se eligen colores de alto contraste, margen, logo y marco. Aplicar una plantilla solo cambia el QR abierto; **Guardar como nuevo** y **Guardar cambios** son acciones separadas. Propietarios, administradores y editores gestionan diseños; los lectores pueden aplicarlos y exportar.

**Archivo** ofrece PNG, SVG y PDF individual. Copiar imagen usa PNG y la resolución seleccionada. Si el navegador no lo permite, se ofrece descargar PNG. **Imprimir** configura A4 vertical, mm/cm, copias o llenar hoja y marcas de corte. El tamaño mide el QR incluyendo su margen blanco; el marco ocupa espacio adicional. La vista muestra la primera hoja y el recuento de páginas. Imprimir al 100 %, sin ajustar a página.

La selección de enlaces se conserva al cambiar de página dentro del workspace. **Exportar QR** admite hasta 100 enlaces: ZIP con PNG/SVG y `manifest.json`, o PDF A4. Se obtiene primero una instantánea autorizada; el trabajo se genera en un worker, con progreso, cancelación y límite de 64 MiB. Un cambio de sesión, cuenta, workspace o rol invalida los resultados pendientes.

**QR de campaña**, en el detalle, guarda un nombre y una copia del diseño. La URL conserva el enlace y añade `?qr=<identificador>`. Guardar el diseño de una campaña es explícito; archivar conserva los QR impresos. Solo se atribuyen redirecciones admitidas y el identificador debe pertenecer al enlace. La comparación usa visitas, serie diaria UTC, porcentajes sobre visitas atribuidas, tráfico sin atribución y fechas sin datos; no identifica personas ni demuestra escaneos físicos.

## Límites y almacenamiento

- `QR_DESIGNS_PER_WORKSPACE`: 50 por defecto.
- `QR_ASSET_BYTES_PER_WORKSPACE`: 67108864 por defecto, sobre PNG normalizados; incluye reservas incompletas.
- `QR_VARIANTS_PER_LINK`: 100 por defecto; configurable entre 1 y 100.
- Entrada de logos: PNG/JPG reales, máximo 2 MiB y 4096 px por lado. Laravel comprueba firma y decodificación, aplica orientación, quita margen transparente y metadatos y normaliza a un máximo de 1024 px.
- Disco privado `qr-private`: `storage/app/private/qr-assets`. No publicar esta carpeta ni añadir un enlace público de storage.
- Diseños y variantes usan versiones optimistas; las creaciones y cargas requieren UUID de idempotencia. Repetir una creación eliminada responde 410, sin recrearla.
- Housekeeping conserva logos referenciados por diseños o variantes. Limpia cargas abandonadas tras un día; recibos duraderos sobreviven al borrado del workspace y recogen escrituras tardías. La analítica QR usa la retención existente. La exportación de cuenta incluye diseños, variantes, recuentos y PNG normalizados sin rutas privadas.

## Despliegue

1. Reconstruir las imágenes PHP con GD y ejecutar las comprobaciones de extensiones. Composer declara `ext-gd`; las imágenes de desarrollo, producción y simulacro lo incluyen, y el arranque de producción lo exige.
2. Desplegar primero el backend y ejecutar `php artisan migrate --force`. Las tres migraciones QR son aditivas; no requieren reinicializar la base de datos. Mantener el housekeeping existente en marcha y respaldar también el nuevo disco privado.
3. Aplicar la configuración Nginx/backend de seguridad que admite la política concreta `uvh#qr-worker`, conservando `worker-src 'self'` y Trusted Types. Después desplegar el frontend, sus workers/chunks y `/fonts/manrope.ttf`. Conservar los assets de la versión anterior durante el cambio para sesiones abiertas.
4. Comprobar diseño compartido, lectura de logo privado, PDF/SVG, A4, lote y campaña protegida en el entorno destino. La implementación no ejecuta un despliegue automáticamente.

Manrope se distribuye con su licencia OFL en `frontend/public/fonts/manrope-OFL.txt`. `pdf-lib`, Fontkit y `fflate` se cargan cuando se utilizan. No hace falta un servicio externo para generar archivos QR.

La [validación de esta implementación](advanced-qr-validation.md) recoge las suites, comprobaciones de archivos y navegadores, y los pasos pendientes antes de desplegar.
