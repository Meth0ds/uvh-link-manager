# Funciones avanzadas de QR para UVH

## Goal
Implementar íntegramente el plan autorizado: generador común, SVG/PDF/copia, diseños compartidos seguros, impresión A4, lotes y atribución de campañas. Sin modificar destinos/UTM ni perder funciones existentes.

## Current Phase
Implementación y comprobaciones automatizadas completadas. Despliegue y Safari nativo pendientes como comprobaciones del entorno destino.

## Next Step
Entregar evidencia y pasos de despliegue. No migrar la base local ni publicar implícitamente.

### Phase 1: Generador y personalización
**Status:** complete
- [x] Contrato versionado sin URL, logos UVH/ninguno/custom, colores 7:1, marcos y texto seguro.
- [x] Matriz/geometría común; quiet zone >=4, logos H, vistas/exportaciones fieles.
- [x] SVG autónomo con texto trazado y PDF vectorial Manrope incrustada.
- [x] Copia PNG y fallback explícito; tests de decodificación/dimensiones.

### Phase 2: Diseños y logos privados
**Status:** complete
- [x] Migraciones aditivas, API CRUD/versiones/idempotencia, roles y aislamiento.
- [x] GD en Composer/imágenes/CI/arranque, normalización server independiente.
- [x] Cuotas 50/64MiB, entrada 2MiB/4096, referencias y limpieza resistente a fallos.
- [x] Biblioteca y controles modal intuitivos, cambios temporales vs guardar.

### Phase 3: Impresión
**Status:** complete
- [x] A4 210x297mm, márgenes10mm, separación5mm, tamaño35mm, pitch>=0.4mm.
- [x] cm/mm, copias1..500/llenar hoja, páginas/filas/columnas, marcas de corte, 100%.

### Phase 4: Lotes
**Status:** complete
- [x] Snapshot backend autorizado <=100, selección entre páginas.
- [x] ZIP fflate incremental PNG/SVG + manifiesto, PDF A4, progreso/cancelación/64MiB.
- [x] Lazy imports, trabajo fuera del hilo UI, invalidación sesión/cuenta/workspace/permisos.

### Phase 5: Campañas
**Status:** complete
- [x] Variantes aleatorias por enlace con snapshot, revisión explícita, archivo mantiene URLs.
- [x] ?qr= validado, contraseña y continuación conservan atribución; redirects admitidos solamente.
- [x] Eventos opcionales y recuentos diarios exactos idempotentes, comparación/sin atribución/fechas vacías.
- [x] Retención, exportación de cuenta y borrado seguro integrados.

### Phase 6: Validación integral
**Status:** automated_checks_complete; native_safari_release_check_pending
- [x] Dependabot cubre docker/caddy y docker/postgres.
- [x] Roles/concurrencia/reintentos/respuestas tardías/logos maliciosos/limpieza.
- [x] Decode PNG/SVG/PDF, físicas/paginación/marcas y casos de campañas.
- [x] Frontend/backend suites, lint/types/build/static/dependencies y navegador.
- [x] Documentar evidencia y limitaciones reales; backend antes frontend, sin despliegue implícito.

## Decisions
- Workspace compartido existente; no tocar DB local ni herramientas uvh-control/panel.
- Pruebas Docker propias aisladas, servicios salientes falsos.
- API de logos entrega únicamente PNG privado; ninguna URL persistida en diseños.
- UI conserva Manrope, color y componentes UVH; preview fija y secciones Diseño/Archivo/Imprimir.

## Errors Encountered
- Preexistente: cobertura Dependabot incompleta para dos Dockerfiles; corregir y comprobar antes de verde integral.

## Evidence
Resultado y limitaciones: docs/advanced-qr-validation.md. Frontend 2105; backend completo2932/34363assertions/1skipDNS, últimos cambios28/653; PHPStan/Pint/lint/types/build pasan. Chromium, WebKit y Firefox Linux; Safari nativo pendiente. Decodificados142QR ZIP + archivosindividuales +107QR A4. npm6HIGH preexistentes aceptados por política hasta2026-11-09. Despliegue no ejecutado.
