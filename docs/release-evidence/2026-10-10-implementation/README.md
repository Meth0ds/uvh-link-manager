# Evidencia de publicación — 10 de octubre de 2026

Se publicó el trabajo local antes de transferir la aplicación a la VPS. Commits de código: frontend `49d0487`, backend `8c257b4`, documentación de revisión `ff382ee`, política de seguridad/dependencias `40885d1`. El SHA del release debe ser el HEAD final publicado, no una selección histórica.

## Resultados de esta ejecución

- Frontend: `npm ci`, lint, typecheck, **2046 tests Karma** y build terminados con código 0 sobre el lockfile corregido. [Estados](frontend-status.tsv).
- Audit: [informe completo](npm-audit.json), seis entradas altas de la única cadena dev aprobada. La [política](../../npm-audit-policy.md) bloquea el resto y caduca el 9 de noviembre a las 00:00 UTC. Sus **9 regresiones** pasaron.
- Backend: Composer install/validate/audit, Pint (**534 ficheros**), PHPStan y esquema terminaron con código 0. La suite completa produjo **2896 aprobados y 3 fallos** en 660,63 segundos / 33605 aserciones, por usar `uvh_commit_test` donde esos probes exigen exactamente `uvh_test`. No se oculta el código 1 en [los estados originales](backend-status.tsv).
- Repetición con base aislada `uvh_test`: **17 tests de EmailChangeConcurrencyTest y LockedSecurityContextTest aprobados**, incluidas las tres comprobaciones anteriores; 62 aserciones, 2,83 segundos. No se modificó el código del backend ni se relajó el guard de los probes. La repetición de toda la suite con esa configuración y los gates de runtime siguen formando parte de la validación final del release.
- Contrato actualizado de escáneres: **11 tests, 319 aserciones** contra la configuración actual, código 0; Pint del fichero modificado también pasó.
- Gitleaks: árbol público completo sin secretos detectados. Historial completo (165 commits en ese momento) sin resultados pendientes después de revisar fingerprints exactos de valores sintéticos y ejemplos. No se añaden exclusiones generales de carpetas de tests.

Los logs completos permanecen en el directorio local ignorado `.uvh-runtime/upcloud-implementation-20261010/evidence-*`. Sus [hashes SHA-256](local-log-sha256.json) permiten contrastarlos; los hashes no sustituyen acceso a esos logs ni constituyen prueba de despliegue. Se conservan los fallos históricos separados.

## Límites

No se han transferido imágenes o código, arrancado UVH o correo, cambiado DNS ni contratado servicios. Los tests funcionales de código no certifican producción. Faltan E2E, release, arranque, colas, restauración externa, imágenes/SBOM, configuración real de proveedores, identidad legal completa y aceptación de UVH y webmail. [Estado operativo y procedimiento](../../upcloud-production-runbook.md).
