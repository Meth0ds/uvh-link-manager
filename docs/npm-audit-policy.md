# Política compartida de npm audit

CI y `scripts/verify-local.mjs` ejecutan `npm run audit:policy` desde `frontend`. El comando conserva la salida completa de npm y stderr en `.uvh-runtime/npm-audit/`; en CI se publica como artefacto incluso si la puerta falla. `npm run audit:policy:test` prueba los rechazos sin consultar el registro.

Se bloquea cualquier aviso moderado, alto o crítico, salvo esta única excepción aprobada:

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `braces`, sin versión corregida publicada al revisar el 10 de octubre de 2026.
- Solo los nodos marcados `dev: true` en el lockfile y su propagación revisada: `braces`, `chokidar`, `karma`, `@angular/build`, `karma-jasmine` y `karma-jasmine-html-reporter`.
- Caduca el **9 de noviembre de 2026 a las 00:00 UTC**. Una subida a crítico, un nuevo aviso en cualquiera de esos paquetes, otra dependencia, alcance de producción, informe incompleto o error del registro bloquean la puerta.
- La herramienta de tests procesa patrones del repositorio; no debe recibir patrones no confiables ni exponerse como servicio público. Mantener Karma temporalmente no autoriza otras excepciones ni despliegues sin el resto de comprobaciones.

`source-map-js` está fijado mediante override a **1.2.2**, versión corregida para [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). El lockfile conserva Angular y Karma; no se ejecuta `npm audit fix --force`.

Los informes de npm siguen mostrando seis entradas altas de la cadena de pruebas. La aprobación proviene de esta política explícita, no de ocultar esos resultados ni de ejecutar solo `--omit=dev`.
