# Plan de rediseño integral UVH — 2026-09-10

Continuidad de `redesign-checkpoint-2026-09-08.md`. Extiende la identidad
editorial (papel/tinta/terracota, Manrope, monotipo para eyebrows, layouts
reglados, radios mínimos) a todas las superficies que aún conservan la
composición antigua de "tarjetas redondeadas con sombra".

Regla de oro del checkpoint sigue vigente: **heredar los nuevos colores no
equivale a haber terminado el rediseño**. Una página solo está hecha cuando su
composición, estados y comportamiento responsive siguen el lenguaje editorial.
La referencia canónica de estilo es la skill `.agents/skills/uvh-editorial-design/SKILL.md`
y los patrones ya enviados: `page-header.component.*`, `dialog-identity.scss`,
`dashboard.component.*` y `getting-started.component.*`.

## Inventario verificado hoy (regex sobre `rgba(|border-radius: 1[0-9]px|gradient`)

| Superficie | Archivos | Señales antiguas |
| --- | --- | --- |
| Ajustes | `panel/settings/settings.component.scss` (914 líneas) | 34 |
| Administración | `panel/admin/admin.component.scss` | 20 |
| Tokens API | `panel/tokens/tokens.component.scss` | 13 |
| Webhooks + inspector | `panel/webhooks/*.scss` | 14 |
| Equipo | `panel/team/team.component.scss` | 10 |
| Enlaces (lista, detalle, papelera) | `panel/links/{links,link-detail,link-trash}.scss` | 20 |
| Diálogo de enlace | `panel/links/link-dialog.component.scss` | 8 |
| Diálogo QR | `panel/links/qr-dialog.component.ts` (inline) | tarjeta blanca antigua |
| Dominios + detalle | `panel/domains/*.scss` | 12 |
| Analítica + gráficos | `panel/analytics/{analytics,charts}.scss` | 5 |
| Uso y límites | `panel/usage/usage.component.scss` | 5 |
| Seguridad | `panel/security/security-center.component.scss` | 1 |
| Actividad | `panel/activity/activity.component.scss` | 1 |
| Estado público `/status` | `public-status/public-status.component.scss` | azul `#1d55d5` + rgba |
| 403/404 | `app/status-page.component.ts` | gradientes radiales + logo antiguo |
| Modales MFA/seguridad, invitaciones, ajustes/admin | inline en componentes | rgba suelto |

Sin deuda: `dashboard`, `getting-started`, `auth-card.scss`, shell del panel,
landing, legales, ayuda y diálogos compartidos (`action-dialog`,
`workspace-dialog`).

## Fases

### Fase 0 — Puesta a salvo (bloqueante)
1. Commit temático del árbol en curso (200 ficheros): gitattributes/fin de
   línea, rediseño ya hecho, docs, CI. Empujar `codex/utm-redirects` (2 commits
   por delante de `origin/main`) y abrir PR hacia `main`.
2. A partir de aquí, una PR por fase con evidencia adjunta.

### Fase 1 — Modales de uso diario (pequeña, alta frecuencia)
- **Diálogo de enlace**: sustituir pestañas/rgba por formularios reglados con
  secciones numeradas (estilo `getting-started`), sin mínimos de ancho.
- **Diálogo QR**: eliminar tarjeta blanca; vista en papel con marco fino y
  descarga como acción de texto (`text-link`).
- Modales MFA/reautenticación que viven en `security`.
- Verificación a 320 px y foco inicial en control seguro (regla ya establecida).

### Fase 2 — Bloque enlaces (patrón para el resto)
- Lista: tabla reglada con filas de `border-bottom`, estados como `link-state`,
  acciones de texto; nada de tarjetas por fila.
- Detalle: cabecera editorial + secciones numeradas; métricas en tira reglada
  (patrón `metric-strip` del dashboard).
- Papelera: lista reglada + `quiet-state` vacío.
- Aquí se decide si hace falta un partial SCSS compartido (candidato:
  `panel/_table-identity.scss`); solo si tres páginas lo repiten igual.

### Fase 3 — Bloque dominios y analítica
- Dominios: lista reglada; detalle con cabecera de diagnóstico y estados de
  DNS usando los soft tokens (`danger-soft`, `warn-soft`, `success-soft`).
- Analítica: filtros como `period-switch`; gráficos ya tokenizados — revisar
  ejes/leyendas con monotipo y `tabular-nums`.

### Fase 4 — Bloque integraciones
- Tokens API, Webhooks, Inspector, Equipo: mismas tablas regladas de Fase 2;
  payloads del inspector en bloque monoespaciado sobre `--guide`, sin sombras.

### Fase 5 — Ajustes y seguridad (el mayor)
- Ajustes (914 líneas): rehacer sidebar como índice editorial plano (sin
  tarjeta sticky), secciones numeradas, formularios de una columna reglada.
- Seguridad: heredar el resultado; revisar cada modal embebido.
- Administración: última página grande; misma gramática, sin concesiones de
  "es solo admin".

### Fase 6 — Estado público y errores
- `/status`: quitar azul `#1d55d5` y logo antiguo; **mantener la verdad
  operativa**: nunca parecer más producido de lo que es. Papel liso, tipografía
  reglada, sin animación de marca.
- 403/404: sustituir gradientes radiales por papel/planos con línea fina;
  conservar `--uvh-*` ya correctos.

### Fase 7 — Pasada transversal (cierra el checkpoint)
- Estados vacío/carga/error en todas las fases (no al final: cada página se
  entrega con sus estados).
- Revisión global: teclado y foco, `prefers-reduced-motion`, claro/oscuro a
  320/768/1024/1440 px, sin overflow horizontal.
- Regresión: `tsc --noEmit`, ESLint de ficheros tocados, Karma focalizado,
  build de producción, y revisión en `design-preview` (puerto 4301) y/o
  `ng serve --host 127.0.0.1 --port 4300 --no-open`.
- Actualizar `redesign-checkpoint` con nuevo estado y evidencia.

## Definición de hecho (por página)

1. Cero `rgba()` decorativo, cero `border-radius > 10px`, cero sombras nuevas
   salvo `--uvh-shadow-sm` justificado.
2. Cabecera con `app-page-header`; secciones con eyebrow monotipo numerado.
3. Estados vacío/carga/error compuestos (no spinners desnudos).
4. Claro/oscuro verificados; contraste de tokens respetado (los del checkpoint:
   texto 13,32:1 / secundario 5,45:1 / acento 4,91:1 en claro).
5. 320 px sin overflow horizontal; objetivos táctiles ≥ 44 px.
6. `prefers-reduced-motion` respetado; foco visible con `outline-offset: 3px`.
7. Sin cambios de contratos API, permisos ni textos de estados.

## Riesgos y reglas

- Los colores de estado mantienen sus alias `--uvh-*`: cambiar apariencia nunca
  cambia significado ni datos de gráficos.
- No tocar rutas, guards ni lógica durante el rediseño; los ajustes que toquen
  comportamiento van a commits/PR separados.
- Cada fase es revertible: commits por página dentro de la fase.
- No ejecutar migraciones ni suites contra `uvh_local` (regla del checkpoint).
