# Frontend design overhaul

## Objetivo
Revisar el frontend real de UVH, corregir bugs de presentación y navegación y pulir la biblioteca y superficies compartidas conservando la identidad documentada.

## Fases
- [ ] Auditar código y vista de diseño en escritorio/móvil, claro/oscuro.
- [ ] Implementar correcciones de layout, estados vacíos, filtros y accesibilidad.
- [ ] Ampliar fixtures y pruebas de regresión pertinentes.
- [ ] Ejecutar typecheck, lint, Karma, build y revisión visual; documentar resultados.

## Dirección visual
Papel #f5f2e9, placa #fffcf5, tinta #262821, secundario #626357, borde #cecec0, acento #b53c20; variantes oscuras existentes. Manrope para contenido y pila mono del sistema para datos técnicos. Mantener identidad editorial establecida, mejorar densidad, jerarquía y lectura en móviles, evitar ornamentación nueva.

## Restricciones
Conservar cambios de backend previos; no commits ni publicación solicitados. Fixtures son sólo evidencia visual, no validación de operaciones de backend.

## Next Step
Completar inspección del panel y ampliar la vista aislada a biblioteca y notificaciones.

## Incidencias de herramientas
- agent-browser no está en PATH; disponible vía npx.
- No se localizaron archivos AGENTS.md en el repositorio.
