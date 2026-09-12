# UVH — Sistema de diseño

Identidad editorial del panel Angular: papel, tinta y un acento terracota, con
marcos finos en lugar de tarjetas redondeadas con sombra. Los tokens viven en
`frontend/src/app/core/_identity-tokens.scss` (mezclas `light`, `dark` y
`aliases`) y se inyectan en `frontend/src/styles.scss`.

> La identidad anterior (azul eléctrico `#2457F5` y turquesa `#00A99D`) está
> retirada: no quedan usos en `frontend/src`.

## 1. Tokens

| Token | Claro | Oscuro | Rol |
| ----- | ----- | ------ | --- |
| `--paper` | `#f5f2e9` | `#21241f` | Fondo de página |
| `--paper-raised` | `#fffcf5` | `#2c3028` | Placas y superficies elevadas |
| `--ink` | `#262821` | `#f4f0e4` | Texto principal |
| `--muted` | `#626357` | `#b9bbae` | Texto secundario |
| `--line` | `#cecec0` | `#4d5145` | Filetes y bordes |
| `--accent` | `#c44324` | `#f79573` | Acento (terracota) |
| `--accent-ink` | `#fffaf0` | `#25251e` | Tinta sobre relleno de acento |
| `--soft` | `#eae7dd` | `#30352b` | Pistas y carriles |
| `--guide` | `#e5e8dc` | `#2a3025` | Superficie de guías |
| `--uvh-teal` | `#486344` | `#b1c6a2` | Medidas y series |
| `--uvh-danger` | `#b12e30` | `#ffb0aa` | Error y destrucción |
| `--uvh-success` | `#386044` | `#a8d3a6` | Confirmación |
| `--uvh-warn` | `#805509` | `#eac67a` | Advertencia y límite alcanzado |

Cada color de estado tiene su variante `*-soft` para fondos.

**Los nombres semánticos se conservan como alias** (`--uvh-ink`,
`--uvh-surface-raised`, `--uvh-electric`, `--uvh-border`, …). Cambiar la
apariencia nunca debe cambiar el significado de un estado ni los datos de un
gráfico: por eso los componentes consumen el alias, no el valor.

## 2. Tipografía

- **Manrope** autoalojada vía `@fontsource/manrope` (pesos 400, 500, 600, 700 y
  800) más `material-icons/iconfont/filled.css`. No hay peticiones a CDNs de
  terceros, lo que mantiene una política de contenidos estricta.
- Escala del panel: título de bloque `17.5px`/`800`/`-.03em`; cuerpo `12.5–13px`
  con `line-height: 1.6`; texto monoespaciado `10–11px`.
- Los *eyebrows* y los valores de datos usan monoespaciada con
  `letter-spacing: .1em` y `text-transform: uppercase`.
- Cifras métricas con `font-variant-numeric: tabular-nums` (clase `.tnum`) para
  que las columnas no "bailen".
- Contenedor de página: `max-width: 1120px`.

Deuda conocida: la pila monoespaciada no está unificada. Algunos componentes
declaran `"JetBrains Mono"` en primer lugar, pero esa fuente no se instala ni se
importa, así que cae a `ui-monospace`/Consolas; los componentes del panel usan
`"Courier New"`. Conviene fijar una sola pila.

## 3. Temas

- El tema claro es el estado por defecto de `:root`.
- El tema oscuro se aplica con la clase `html.dark`, que vuelve a inyectar la
  mezcla `dark`.
- `ThemeService` persiste la preferencia en `localStorage` (`uvh.theme`:
  `light` | `dark` | `system`), escribe `dataset.theme` en el elemento raíz y, en
  modo `system`, sigue `prefers-color-scheme` en vivo.
- `frontend/public/theme-init.v1.js` se carga de forma bloqueante y externa
  (permite `script-src 'self'` sin `unsafe-inline`) para evitar el destello de
  tema incorrecto.

## 4. Geometría y composición

- **Marcos de 3px.** Las placas del panel son rectángulos planos con borde
  `1px solid var(--uvh-border)` y `border-radius: 3px`. El mismo valor se aplica
  a botones, campos y esqueletos desde el tema Material (`mat.button-overrides`,
  `--mat-form-field-outlined-container-shape`), para que no convivan dos
  geometrías.
- **Sin sombras decorativas.** La elevación se reserva a solapas y diálogos
  (`--uvh-shadow-*`). Los halos de estado se expresan con `outline`, no con
  `box-shadow`, para que una auditoría de sombras siga siendo significativa.
- **Container queries.** Cada componente declara
  `:host { container-type: inline-size }` y responde con `@container`, de modo
  que la composición depende del ancho real de la página y no del viewport.
- Objetivos táctiles de al menos `44px` y comportamiento correcto a `320px` sin
  overflow horizontal.

## 5. Gramática editorial

| Recurso | Convención |
| ------- | ---------- |
| Placa | Rectángulo plano con filete de 1px y radio de 3px sobre `--paper-raised`. |
| Nota al margen | Filete izquierdo de 3px (acento, `--uvh-warn` o `--uvh-danger`) más el fondo suave correspondiente. |
| Eyebrow | Etiqueta monoespaciada en mayúsculas que abre una sección. |
| Etiqueta de estado | Cuadrado de 3px sobre `*-soft` con el color fuerte del token. |
| Libro / ledger | Filas separadas por filetes de 1px, sin tarjetas ni hover elevado. |
| Reveal de secreto | Nota al margen con filete, nunca una caja tintada flotante. |
| Icono de bloque | Cuadrado enmarcado de 38px sobre `--uvh-surface`. |

Regla transversal: **la apariencia acompaña al significado**. Un estado de aviso
se dibuja con tokens de aviso; un dato no confirmado no puede pintarse como
confirmado.

## 6. Estados y feedback

- Estados remotos: `idle / loading / success / empty / error`, siempre
  compuestos (nunca un indicador desnudo).
- Error: barra de peligro con filete izquierdo sobre `--uvh-danger-soft`.
- Vacío: `.empty-state` global, marco discontinuo de 3px.
- Carga: `mat-progress-bar` indeterminado o esqueletos etiquetados.
- Feedback breve mediante snackbars; sin avisos redundantes.

## 7. Movimiento

- Microinteracciones con `transform`, `opacity` y `border-color`; transiciones de
  `replace`/`160–240ms`.
- `prefers-reduced-motion: reduce` desactiva animaciones y transiciones.
- El cambio de tema usa View Transitions cuando el navegador lo soporta y se
  degrada a un cambio directo.
- Sin animaciones permanentes de fondo.

## 8. Accesibilidad (WCAG 2.2 AA)

Contraste medido sobre los tokens reales:

| Par | Claro | Oscuro |
| --- | ----- | ------ |
| `--ink` sobre `--paper` | 13,32:1 | 13,79:1 |
| `--muted` sobre `--paper` | 5,45:1 | 8,07:1 |
| `--accent` sobre `--paper-raised` | 4,91:1 | 7,11:1 |
| `--accent-ink` sobre `--accent` | 4,83:1 | — |
| `--uvh-danger` sobre `--paper` | 5,68:1 | 9,01:1 |

Aviso medido: **`--accent` sobre `--paper` da 4,49:1**, ligeramente por debajo
del `4,5:1` que exige AA para texto normal. Sobre `--paper-raised` cumple. Usa el
acento para texto sobre placas elevadas, o ajusta el token (por ejemplo
`#c14022` alcanza `4,66:1` sobre `--paper` con un cambio imperceptible).

Además: elementos nativos siempre que sea posible, `aria-label` en botones de
icono, foco visible con `outline` de 2–3px y `outline-offset`, y verificación en
360 / 768 / 1024 / 1280 / 1440 px.

## 9. Verificación

Un cambio de estilos está terminado cuando:

1. `npm run typecheck`, `npm run lint` y `npm test -- --watch=false` pasan.
2. El barrido de identidad antigua no devuelve resultados en los ficheros
   tocados: `rgba(`, hex literal, `linear-gradient`, `radial-gradient`,
   `box-shadow` decorativo y radios mayores de `3px`.
3. `npm run build` termina sin avisos.
4. La página se revisa en claro y oscuro, a `320px`, y con movimiento reducido.

Para inspeccionar los componentes reales sin backend existe
`frontend/design-preview` (build propio en `dist/design-preview`); sus datos son
ficticios y no acreditan comportamiento.

## 10. Deuda conocida

- El acento sobre `--paper` queda en 4,49:1 (sección 8).
- La pila monoespaciada no está unificada y `JetBrains Mono` no se instala
  (sección 2).
- `--uvh-radius: 6px` y `--uvh-radius-lg: 10px` siguen definidos como alias
  heredados. Las primitivas globales del panel (`.card`, `.card-block`,
  `.stat-card`, tablas, expansion panels y barras de progreso) ya usan el marco
  de 3px, pero el alias permanece y conviene retirarlo para que nadie lo
  reintroduzca.
- `.code-block` no tiene usos; se mantiene alineado a 3px a la espera de
  decidir si se elimina.
- Los overlays sí conservan elevación real: el diálogo usa `--uvh-shadow-lg` y
  el menú `--uvh-shadow-md`. Es intencional.
