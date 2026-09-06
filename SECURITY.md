# Security Policy

## Comunicación responsable

No publiques vulnerabilidades, credenciales, datos personales ni pruebas de
concepto sensibles en una issue, discusión o pull request.

Utiliza el canal privado de GitHub:

https://github.com/Meth0ds/uvh-link-manager/security/advisories/new

Incluye la revisión afectada, impacto esperado, condiciones necesarias y una
reproducción mínima con datos sintéticos. No pruebes vulnerabilidades contra
usuarios, dominios, correos, webhooks o infraestructura reales.

## Versiones mantenidas

El proyecto no dispone todavía de una versión estable publicada. Solo la rama
`main` actual recibe correcciones de seguridad.

## Sistema y alcance

Esta política cubre la SPA Angular, la API Laravel, PostgreSQL, workers, tareas
programadas, contenedores, proxy, herramientas locales y workflows incluidos
en este repositorio.

Los activos principales son cuentas, sesiones, secretos, enlaces, dominios,
analítica, webhooks, correo, auditoría y datos aislados por workspace.

## Modelo de amenazas y fronteras de confianza

Se consideran controlados por un atacante los parámetros HTTP, cabeceras no
inyectadas por un proxy autorizado, destinos de enlaces, URLs de webhooks,
payloads remotos, respuestas DNS, tokens presentados y contenido almacenado
por usuarios.

El frontend, los guards de Angular y la ocultación de botones no constituyen
fronteras de autorización. Toda autorización debe decidirse en el backend.

## Invariantes de seguridad

- Cada lectura o mutación tenant debe revalidar identidad, versión de seguridad,
  workspace y rol en el backend.
- La cookie del panel pertenece únicamente al host de aplicación; nunca debe
  compartirse mediante `.uvh.es`.
- Las mutaciones de sesión requieren CSRF y las operaciones críticas requieren
  reautenticación o MFA cuando corresponda.
- Sesiones y tokens persistentes se almacenan mediante hash; secretos sensibles
  se cifran en reposo y nunca se devuelven después de su única visualización.
- hCaptcha se verifica servidor a servidor, con timeout acotado y fallo cerrado.
- Las salidas, redirecciones y webhooks solo admiten esquemas autorizados y las
  conexiones salientes deben conservar las defensas SSRF.
- El orden de bloqueo es cuenta o cuentas ordenadas, sesión y después
  workspace o recurso.
- Los correos que conceden capacidades deben admitirse en el outbox dentro de
  la misma transacción que crea la capacidad.
- Las pruebas destructivas solo pueden ejecutarse contra una base aislada cuyo
  nombre termine en `_test`.
- Producción debe rechazar secretos de ejemplo, configuración insegura,
  migraciones pendientes y dependencias operativas obligatorias ausentes.
- Los workflows externos deben estar permitidos explícitamente y fijados a un
  SHA completo.

## Hallazgos reportables

Son reportables los fallos alcanzables que rompan aislamiento tenant,
autenticación, autorización, confidencialidad, integridad, disponibilidad
acotada, retención, auditoría o las invariantes anteriores.

La severidad depende de la exposición real, privilegios necesarios, alcance
entre cuentas, persistencia, sensibilidad de los datos y posibilidad de
explotación remota o sin interacción.

## Fuera de alcance

No se excluye por defecto ninguna clase de vulnerabilidad del código.

No están autorizadas las pruebas contra producción o terceros, ingeniería
social, acceso físico, denegación de servicio volumétrica ni extracción de
datos reales. Estas restricciones limitan el método de prueba, no invalidan un
hallazgo demostrable de forma segura.

## Limitaciones conocidas

Las pruebas automatizadas no acreditan por sí solas TLS, DNS, correo, backups,
observabilidad, accesibilidad ni comportamiento multiproceso reales. Consulta
`docs/production-readiness.md` y `docs/threat-model.md` antes de afirmar que un
despliegue está listo para producción.

## Divulgación

Permite un plazo razonable para investigar, corregir y desplegar antes de una
divulgación pública coordinada. No publiques detalles que faciliten explotación
mientras los usuarios sigan expuestos.
