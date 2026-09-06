# Uso y límites del workspace

## Alcance implementado

`/app/usage` presenta una fotografía agregada del consumo que devuelve
`GET /api/v1/workspaces/:id/usage`. No calcula cuotas en el navegador ni ofrece
planes, precios o ampliaciones inexistentes. Cada mutación mantiene su propia
comprobación autoritativa en backend; la fotografía no reserva capacidad.

La pantalla cubre enlaces, dominios, miembros, tokens API, webhooks,
invitaciones pendientes y la política de retención de analítica. Las categorías
sensibles siguen la proyección del servidor: viewers no reciben recuentos de
tokens y sólo owner/admin reciben invitaciones. Los botones navegan a superficies
internas fijas donde un rol autorizado puede liberar capacidad.

## Garantías de interfaz

- El decodificador verifica workspace, rol, políticas y coherencia entre
  `used`, `limit`, `remaining` y `reached` antes de publicar el snapshot.
- Un cambio de cuenta, rol o workspace retira los datos visibles de inmediato y
  descarta respuestas tardías.
- Los estados sin cuota y cuota no disponible se muestran como desconocidos; no
  se interpretan como capacidad infinita o libre.
- `401/403`, contrato inválido, indisponibilidad y `429` producen mensajes
  acotados. `Retry-After` se conserva por cuenta sin polling ni reintento
  automático.
- La retención se identifica como política configurada y `purgeVerified=false`
  no se presenta como evidencia de una purga ejecutada.

## Evidencia actual

- Typecheck y build Angular correctos.
- Suite frontend completa: 245/245.
- Suite backend `WorkspaceUsageTest`: 12 casos y 116 aserciones en `uvh_test`.
- No se aplicó la migración 000034 ni se ejecutaron pruebas en `uvh_local`.

## Gate operativo pendiente

PRODUCT-VALID-003 requiere una ejecución autenticada en navegador para los cuatro
roles, teclado/lector de pantalla, temas, móvil y contraste. También requiere
medir la consulta con volumen representativo y el índice 000034 aplicado en una
copia aislada. Ese gate no se deduce de las pruebas unitarias o de componente.
