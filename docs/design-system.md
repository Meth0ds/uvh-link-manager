# UVH — Design System

Sistema de diseño del panel Angular. Definido con tokens globales de Angular Material + CSS propio.

## 1. Semillas de color

| Token | Hex | Rol |
| ----- | --- | --- |
| `--uvh-ink` | `#07111F` | Azul tinta — texto principal / superficies oscuras |
| `--uvh-surface` | `#F6F8FC` | Superficie clara de fondo |
| `--uvh-electric` | `#2457F5` | Azul eléctrico — acciones primarias |
| `--uvh-teal` | `#00A99D` | Turquesa — acento terciario |

Tema Material generado con `mat.define-theme` (M3):

- **primary**: `mat.$blue-palette` (aprox. azul eléctrico)
- **tertiary**: `mat.$cyan-palette` (aprox. turquesa; Material no incluye paleta "teal" predefinida)

No se hardcodean colores repetidos: los componentes usan las variables CSS y los roles del tema Material.

## 2. Tipografía

- Familia: **Manrope** (cargada desde Google Fonts), con fallback `system-ui`.
- Escala: jerarquía Material (`mat.typography-hierarchy`) + utilidades propias (`section-title`, `page-head`).
- Cifras métricas: `font-variant-numeric: tabular-nums` (clase `.tnum`) para que las métricas no "bailen".

## 3. Tema claro / oscuro / seguir sistema

- `html` → tema claro por defecto.
- `html.dark` → `mat.all-component-colors($uvh-dark-theme)` + variables CSS invertidas.
- Preferencia persistida en `localStorage` (`uvh.theme`: `light` | `dark` | `system`), aplicada antes del arranque (script inline en `index.html`) y gestionada por `ThemeService`.
- `system` respeta `prefers-color-scheme`.

## 4. Espaciado y radios

- Radio base de tarjetas/controles: **14px** (`--uvh-radius`), botones 10px.
- Contenedor de página: `max-width: 1120px`, padding responsivo.
- Tarjetas de panel: `.card-block` (blanco, borde `--uvh-border`, radio 14px).

## 5. Estados y feedback

- Estados remotos: `idle / loading / success / empty / error`.
- `mat-progress-bar` indeterminado durante carga.
- Alertas `.alert.error` (rojo) y `.alert.ok` (turquesa).
- Snackbars para feedback breve (copiar, guardar), sin spam.

## 6. Movimiento e identidad de marca

- Microinteracciones con `transform` y `opacity`; se evitan animaciones de layout costosas.
- `prefers-reduced-motion: reduce` desactiva transiciones/animaciones.
- Identidad de movimiento: una URL larga que **se condensa** visualmente hasta `uvh.es/X7aK9p` (hero, creación de enlace y resultado inicial). Nunca como animación permanente.
- Sin glassmorphism excesivo ni gradientes morados genéricos.

## 7. Accesibilidad (WCAG 2.2 AA)

- Elementos nativos cuando es posible; `aria-label` en icon buttons; foco visible; contraste verificado; zoom y reflow; dialogs/drawers accesibles; formularios con errores asociados.
- Responsive 360 / 768 / 1024 / 1280 / 1440 px sin overflow horizontal accidental.
