# Contrato público de identidad e inscripción registral

Ejecutar inline, sin agentes/commits/despliegue. Objetivo completo permanece en .planning/2026-10-09-uvh-legal-ux-spain-eu. Turno O78 anterior es progreso probado (UX+drafts), no espera ni bloqueo. Este cambio elimina un gap real de información legal; no resuelve domicilio/contratos externos.

## Diseño y requisitos
La inscripción se declara explícitamente: registered o not_registered. Valor por defecto registered mantiene exigencia y compatibilidad de instalaciones antiguas. No deducir ausencia de inscripción del hecho de ser persona física. registered exige datos registrales válidos; not_registered exige ausencia de esos datos y publica registry:null. Cualquier contradicción/estado desconocido falla cerrado. Los demás cinco campos mantienen validación completa/bounded/UTF8/controlchars/placeholders.

PublicController y gate de producción comparten un validador puro de proyección pública (ninguna credencial ni PII adicional). Frontend acepta respuestas antiguas con registry válido como registered; permite registry:null sólo con not_registered explícito y rechaza contradicciones. Vistas imprimen la declaración en lenguaje claro sin separadores vacíos. No configurar not_registered ni titular en el entorno real sin evidencia; añadir sólo documentación/envtemplates.

## Implementación y verificación
- [ ] Capturar fuentes/specs propias antes de editar.
- [ ] Tests rojos del gate actual con no inscripción declarada y campos legales incompletos/contradictorios; prueba frontend rechaza null legacy pero acepta declaración explícita, conserva campos/bounds y no cambia otros datos.
- [ ] Crear Support/LegalIdentity.php con proyección limitada validada; test PHPUnit puro sin bootstrap Laravel, DB ni red.
- [ ] Integrar PublicController, ProductionSecurity, AppServiceProvider y config/ejemplos. Actualizar tipo/decoder y vistas Terms/Privacy. Cero datos personales en envexample.
- [ ] Pruebas unitarias con contenedor propio uvh-php:8.4, --network none y checkout sólo lectura, entrypoint php, sin servicio compartido. PHPUnit sin cache. PHPsyntax/Pint/PHPStan apropiados sin DB.
- [ ] Frontend pruebas dedicadas/full/build/lint/types; QA aislada copiado build con ambas declaraciones/null/error, móvil/desktop/dark/print y texto no vacío.
- [ ] Todos procesos propios terminales antes de editar; actualizar matriz y continuar redacción/versionado/otros gaps. No marcar objetivo completo por corregir sólo identidad.
