# Auditoría de enlaces con token y flujos sensibles

## Goal
Clasificar el fallo de `preview-only`, revisar flujos análogos en frontend y backend, corregir hallazgos reproducibles y documentar riesgos restantes con evidencia.

## Next Step
Profundizar en enlaces de formato correcto inexistentes/caducados, handoffs y respuestas asíncronas; reproducir cualquier fallo antes de modificar código.

## Current Phase
Phase 6

## Phases

### Phase 1: Requirements & Discovery
- [x] Revisar intención del usuario y el fallo original
- [x] Preservar cambios existentes en el árbol de trabajo
- [x] Inventariar rutas y contratos de token
- **Status:** complete

### Phase 2: Análisis
- [x] Comparar validación frontend/backend y estados visibles
- [x] Revisar autorización, caducidad, consumo y filtrado de secretos
- **Status:** complete

### Phase 3: Correcciones
- [x] Reproducir hallazgos concretos
- [x] Corregirlos con pruebas que eviten regresiones
- **Status:** complete

### Phase 4: Verificación
- [x] Ejecutar pruebas dirigidas y compilación/análisis estático
- [x] Probar los flujos afectados en navegador cuando proceda
- **Status:** complete

### Phase 5: Entrega
- [x] Separar errores confirmados, riesgos no confirmados y límites de cobertura
- [x] Explicar el nombre del bug original y los cambios al usuario
- **Status:** complete

### Phase 6: Segunda pasada solicitada
- [ ] Probar enlaces con forma correcta pero inexistentes, caducados y consumidos
- [ ] Auditar invitaciones, intentos de retorno y respuestas asíncronas
- [ ] Corregir hallazgos nuevos y ejecutar pruebas dirigidas
- [ ] Informar límites y pendientes reales
- **Status:** in_progress

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Validar forma de 43 caracteres en `authBearer` y en verify/reset | Todo emisor histórico inspeccionado usa 32 bytes base64url; el servidor conserva la autoridad para existencia, vencimiento y consumo. |
| No añadir endpoint público de introspección de token | Introduciría una nueva superficie de consulta y no eliminaría la carrera entre consulta y uso; el flujo se valida en la acción. |
| Tratar la muestra `preview-only` como problema de interfaz, no como bypass de autenticación | No existía token emitido en DB y el backend ya rechazaba el intento. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| Fixtures de backend prefijaban tokens de 16 bytes y fallaron con el contrato nuevo | Se confirmó por historia del emisor que nunca se entregaba ese formato; fixtures actualizados a 32 bytes. |
| Tres templates accedían a un campo privado | Getters booleanos sin exposición del token. |
| Loop de QA usó `path`, variable especial de zsh | Repetido con `route_name`. |
