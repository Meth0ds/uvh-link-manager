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
- Suite frontend completa: 253/253 en la última ejecución registrada.
- Suite backend `WorkspaceUsageTest`: 13 casos y 120 aserciones en `uvh_test`.
- El caso de volumen insertó 10.000 enlaces (5.000 activos), obtuvo el agregado
  mediante una sola consulta indexada y respondió dentro del presupuesto de 5 s.
- Playwright recorrió `owner`, `admin`, `editor` y `viewer`, teclado/enlace de
  salto, reflow 390×844 y Axe WCAG 2.0/2.1 A/AA. Los 27 E2E, incluidos ambos de
  Uso, pasaron juntos el 7 de septiembre en 27,6 minutos con un worker.
- No se aplicó la migración 000034 ni se ejecutaron pruebas en `uvh_local`.

## Gate operativo pendiente

Los cuatro roles, teclado, móvil, contraste automatizable y volumen representativo
ya tienen evidencia aislada. PRODUCT-VALID-003 permanece abierto únicamente para
una revisión con lector de pantalla real; Axe no sustituye esa prueba. La revisión
global de temas continúa en el gate manual transversal, no justifica tocar
`uvh_local` ni aplicar allí 000034.
