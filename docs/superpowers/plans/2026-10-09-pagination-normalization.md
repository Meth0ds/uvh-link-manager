# O89 — Normalización estricta de paginación Laravel

Lote de fase4 de optimización global. Lectura de helpers y consumidores:9 listados Admin y show de Workspace (miembros/invitaciones). Dos implementaciones equivalentes aceptan int positivo o cadena exclusivamente decimal, saturan máximo y usan default para inválidos. PrivacyRights FILTER_VALIDATE_INT y searchMembers cast mantienen semántica distinta: no ampliarlos a este helper.

Conservar page1/max10.000, perPage25/max100 (audit50), claves memberPage/memberPerPage e invitationPage/invitationPerPage, límites/orden/totales/scopes/autorización/MFA. No modificar SQL/migraciones/permisos. Objetivo medible de mantenibilidad:2 implementaciones del mismo contrato→1 fuente pura compartida, dos consumidores reales, ninguna supresión nueva ni abstracción de todos los controllers. No ahorro de latencia/SQL ficticio.

- [x] Pruebas HTTP de entradas inválidas, arrays, newline, ceros iniciales, overflow/límites/defaults25/50 y paginación/roles/tenant/orden, verdes en baseline previo. Guardar proyecciones de parámetros reales y mapear rutas.
- [x] Extraer helper puro acotado; tests unitarios de contrato y equivalencia con implementaciones anteriores; preservar políticas diferentes.
- [ ] PHPUnit afectado y completo, Pint/PHPStan sin nuevos ignores, diff/rutas/cuerpos equivalentes. Ensayo de DB `_test` exclusivamente propia, red interna sin proveedores reales.
- [ ] Hashes y coste/mantenibilidad documentados; cerrar procesos y recursos Docker propios. Backend/SQL/jobs/fases restantes del objetivo global pendientes.

Entorno: copia propia sin .env/vendor/storage/cache; vendor read-only de dependencias ya instaladas, imagen PHP local fijada por ID, PostgreSQL efímero propio y red interna. Ningún contenedor compartido/uvh_local ni launcher de control.

## Verificación en curso

Baseline anterior a la extracción:31 pruebas/387 aserciones.26.016 comparaciones puras con las dos implementaciones anteriores,0 diferencias;32 proyecciones de parámetros y186 rutas iguales. En la ejecución actual63 pruebas/586 aserciones dirigidas pasan, incluyendo el contrato legal y la concurrencia real del cambio de email.

El primer ensayo completo2794 no acreditó regresión: agotó el tmpfs PostgreSQL (1320 errores posteriores), ejecutó una copia anterior de PublishedLegalDocumentsTest y la sonda de email rechazó la DB uvh_o89_test porque exige exactamente uvh_test. Conservar logs y guards. Se recreó exclusivamente la DB propia como uvh_test en un volumen Docker propio con espacio suficiente; las fuentes se copiaron de nuevo, incluida la corrección ya presente del test legal que utiliza RepositoryRoot. No se relajó ninguna sonda ni se modificó producción para resolver el fixture. Suite completa/Pint/PHPStan final en curso; no dar el lote por cerrado hasta inspeccionar sus resultados y cerrar recursos propios.

Lectura adicional: LinkController rechaza ceros iniciales/overflow mediante regexp+FILTER_VALIDATE_INT y PrivacyRights usa otros límites/fallbacks. No son consumidores de este helper. El inventario global se regeneró desde el árbol actual (521 archivos,2509 funciones con nombre,1371 callbacks,3 firmas);9 propietarios provisionales requieren conciliación específica.
