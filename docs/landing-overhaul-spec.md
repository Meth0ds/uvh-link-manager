# UVH · Enlaces con recorrido

Dirección editorial y visual de la landing, 8 de septiembre de 2026.
Sustituye la propuesta anterior de paneles azules y tarjetas de capacidades.
El propietario autoriza cambiar la identidad completa y ha pedido extenderla
al resto del producto. Estado y pendientes: `redesign-checkpoint-2026-09-08.md`.

## Idea central

«El enlace ya está fuera. El control sigue aquí.»

La página explica el valor de conservar una dirección compartida cuando cambia
su destino. Habla de situaciones concretas: una carta impresa, un evento
bilingüe y una newsletter ya enviada. Los ejemplos están identificados como
ilustrativos; no representan clientes, métricas ni enlaces reales publicados.

## Composición y contenido

1. Cabecera tipográfica `uvh.`, navegación breve y acceso a la preparación.
2. Titular editorial y etiqueta interactiva: cambia la carta de verano por la
   de otoño, conservando el alias. La demostración es local y no llama a la API.
3. Formulario real de URL con la continuidad de acceso existente. En móvil se
   coloca antes de la ilustración para reducir la distancia hasta la tarea.
4. Tres casos de uso con pasos concretos y diagramas del recorrido.
5. Guía «Antes de imprimir 500 copias»: alias, caducidad, reglas y lectura de
   analítica. Una contraseña de UVH no se presenta como protección del destino.
6. Workspace, roles, dominios propios, API tokens y webhooks descritos según
   sus límites actuales, sin garantías de operación todavía no acreditadas.
7. FAQ con Angular Material, llamada a preparar una URL y recursos públicos.

## Identidad compartida

| Uso | Claro | Oscuro |
| --- | --- | --- |
| Papel | `#f5f2e9` | `#21241f` |
| Papel elevado | `#fffcf5` | `#2c3028` |
| Tinta | `#262821` | `#f4f0e4` |
| Texto secundario | `#626357` | `#b9bbae` |
| Acento | `#c44324` | `#f79573` |
| Líneas | `#cecec0` | `#4d5145` |

Manrope local para cuerpo y titulares; Georgia cursiva para énfasis editorial;
monoespaciada del sistema para anotaciones. Radios mínimos, líneas finas y
espacio entre secciones. El cartel conserva sus tintas de papel impreso en
ambos temas. No se añaden fuentes remotas, librerías, fotos ni rastreadores.

La paleta compartida vive en `frontend/src/app/core/_identity-tokens.scss`.
Los controles Material, incluidos overlays, usan variables de sistema.
La landing conserva su composición específica; acceso, páginas legales y
estructura del panel ya comparten la identidad. La transición de apariencia
es reutilizable y conserva ThemeService y la preferencia del producto.

## Comportamiento y accesibilidad

- Un solo botón abre/cierra el menú móvil. Escape restaura el foco; el contenido
  cubierto queda `inert`, y cerrar o destruir el componente libera el scroll.
- Pestañas con flechas, Home/End, selección ARIA y foco visible.
- FAQ con acordeón Angular Material y semántica de expansión accesible.
- La demostración anuncia los cambios de destino; no anuncia cada pulsación
  del formulario ni presenta un alias como reservado.
- La URL de acceso conserva el token opaco existente; no incorpora el destino.
- Los saltos al formulario respetan movimiento reducido; doble submit bloqueado.

## Verificación

La revisión del rediseño se hace con la compilación de desarrollo y el navegador
local, incluidos tamaños móvil y escritorio, ambos temas y controles principales.
Los resultados concretos se registran al terminar la revisión. Las suites del
informe de depuración siguen reservadas para el final de aquel trabajo.
