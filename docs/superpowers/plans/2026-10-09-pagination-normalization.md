# O89 — Normalización estricta de paginación Laravel

Lote de fase4 de optimización global. Lectura de helpers y consumidores:9 listados Admin y show de Workspace (miembros/invitaciones). Dos implementaciones equivalentes aceptan int positivo o cadena exclusivamente decimal, saturan máximo y usan default para inválidos. PrivacyRights FILTER_VALIDATE_INT y searchMembers cast mantienen semántica distinta: no ampliarlos a este helper.

Conservar page1/max10.000, perPage25/max100 (audit50), claves memberPage/memberPerPage e invitationPage/invitationPerPage, límites/orden/totales/scopes/autorización/MFA. No modificar SQL/migraciones/permisos. Objetivo medible de mantenibilidad:2 implementaciones del mismo contrato→1 fuente pura compartida, dos consumidores reales, ninguna supresión nueva ni abstracción de todos los controllers. No ahorro de latencia/SQL ficticio.

- [x] Pruebas HTTP de entradas inválidas, arrays, newline, ceros iniciales, overflow/límites/defaults25/50 y paginación/roles/tenant/orden, verdes en baseline previo. Guardar proyecciones de parámetros reales y mapear rutas.
- [x] Extraer helper puro acotado; tests unitarios de contrato y equivalencia con implementaciones anteriores; preservar políticas diferentes.
- [x] PHPUnit afectado y completo, Pint/PHPStan sin nuevos ignores, diff/rutas/cuerpos equivalentes. Ensayo de DB `_test` exclusivamente propia, red interna sin proveedores reales.
- [x] Hashes y coste/mantenibilidad documentados; cerrar procesos y recursos Docker propios. Backend/SQL/jobs/fases restantes del objetivo global pendientes.

Entorno: copia propia sin .env/vendor/storage/cache; vendor read-only de dependencias ya instaladas, imagen PHP local fijada por ID, PostgreSQL efímero propio y red interna. Ningún contenedor compartido/uvh_local ni launcher de control.

## Verificación en curso

Baseline anterior a la extracción:31 pruebas/387 aserciones.26.016 comparaciones puras con las dos implementaciones anteriores,0 diferencias;32 proyecciones de parámetros y186 rutas iguales. En la ejecución actual63 pruebas/586 aserciones dirigidas pasan, incluyendo el contrato legal y la concurrencia real del cambio de email.

El primer ensayo completo2794 no acreditó regresión: agotó el tmpfs PostgreSQL (1320 errores posteriores), ejecutó una copia anterior de PublishedLegalDocumentsTest y la sonda de email rechazó la DB uvh_o89_test porque exige exactamente uvh_test. Conservar logs y guards. Se recreó exclusivamente la DB propia como uvh_test en un volumen Docker propio con espacio suficiente; las fuentes se copiaron de nuevo, incluida la corrección ya presente del test legal que utiliza RepositoryRoot. No se relajó ninguna sonda ni se modificó producción para resolver el fixture. Suite completa/Pint/PHPStan final en curso; no dar el lote por cerrado hasta inspeccionar sus resultados y cerrar recursos propios.

Lectura adicional: LinkController rechaza ceros iniciales/overflow mediante regexp+FILTER_VALIDATE_INT y PrivacyRights usa otros límites/fallbacks. No son consumidores de este helper. El inventario global se regeneró desde el árbol actual (521 archivos,2509 funciones con nombre,1371 callbacks,3 firmas);9 propietarios provisionales requieren conciliación específica.

## Segundo ensayo completo y corrección de fixtures

El ensayo con volumen terminó:2794 pruebas/22993 aserciones,8 fallos y1 skip. Se leyó código productivo, framework y fixtures antes de corregir: RecoveryMailDeliveryTest usaba el atajo de mail.default=array y no ejercía su ArrayTransport; el proceso hijo de RegistrationEditConcurrencyTest no recibía las claves CAPTCHA sintéticas configuradas en el padre; RequestCorrelationTest esperaba eventos info filtrados por LOG_LEVEL=warning (Laravel Logger::writeLog retorna antes de emitir MessageLogged). No era evidencia de una fuga de trazas. Tres fixtures ahora independientes del launcher: mailer nombrado con ArrayTransport sustituido, configuración CAPTCHA del padre reenviada al hijo con Http::fake intacto y logger propio debug/NullHandler. Ninguna modificación de política productiva ni supresión de aserciones.

84 pruebas dirigidas/722 aserciones verdes tras estos ajustes. Pint524 verde después de normalizar el import NullHandler; PHPStan nivel6/app sin errores y mismos hashes productivos (los últimos cambios son fixtures/metadatos).26.016 comparaciones puras,32 parámetros y186 rutas iguales reejecutados sobre fuente final. Inventario521/2509/1371/3,0 archivos sin propuesta específica; se añadieron las nueve propuestas explícitas por consumidor al regenerador y se verificaron hashes. Enumerar/asignar propietario no acredita revisar todas las funciones.

La repetición completa `full-repaired.log` está admitida en sesión9289/contenedor uvh-o89-php; revalidar el handle antes de seguir.522 hashes fuente congelados sin cambios. DB propia uvh_test/uvh-o89-postgres, volumen uvh-o89-postgres-data y red uvh-o89-pagination siguen vivos hasta inspeccionar el resultado y limpiar. El skip del ensayo anterior es el caso de hostname público de SsrfTest que necesita DNS exterior; la red interna deliberadamente no lo ofrece. Registrar este límite, sin ocultarlo como cobertura completa de DNS. No cerrar lote/objetivo global todavía.

## Cierre O89

La sesión9289 terminó exit0:2794 pruebas/23039 aserciones,0 fallos/errores y1 skip explícito (SsrfTest requiere DNS externo). Tiempo14:21.409,memory149MB de ese runner; no métrica de latencia/capacidad de producción.522 hashes fuente y521 inventario sin cambios;32 parámetros/186 rutas iguales, inputs app de PHPStan coinciden aún con fuentes actuales. Formato524 y análisis level6 app sin nuevos ignores permanecen válidos; verificación de hashes/artefactos actual reejecutada.

Contenedores PHP/syntax terminales; PG/volumen/red propios O89 retirados y ningún recurso compartido modificado. Cierre del lote de mantenibilidad:2 normalizadores equivalentes→1 compartido. El skip DNS se conserva como límite de cobertura para el plan global; no acredita una revisión completa de SSRF/proveedores. Backend restante/SQL/jobs y fases globales siguen pendientes.
