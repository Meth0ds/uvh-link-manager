# Landing Navigation and Interaction Polish Implementation Plan

> **For agentic workers:** use the written plan task by task. Execution is inline in the current authorized checkout; no agents, branch changes, commit or deployment. Existing user constraints override workflow defaults.

**Goal:** Complete the proposed menu/footer/form/demo/mobile refinements while preserving UVH's real registration and pending-link behavior.

**Architecture:** Landing owns cached section/form/header elements, one coalesced animation frame for layout measurements and one owned frame for focus. Scroll/resize/content-size changes update section highlighting, page progress and contextual mobile access. Templates retain native links, Material FAQ and the established palette.

**Tech Stack:** Angular22, TypeScript6, SCSS, Manrope, Material; no new dependency.

**Spec:** Current user goal, most recent landing/menu/footer/motion requests and `2026-10-08-landing-clarity.md`. Global S01–S13 and phases4/5 remain open.

## Global constraints and direction

Keep paper#f5f2e9, raised#fffcf5, ink#262821, muted#626357, accent#b53c20, guide#e5e8dc and existing dark counterparts. Manrope for headings/body; URLs only may use monospace. The giant wordmark remains the footer's visual signature. Group links by purpose; accent underline identifies the actual visible section. Reserve native semantics, >=44px targets,16px mobile input, reduced motion and focus. No fake prices/features/testimonials or assertions that URL format guarantees reachability/security.

```
brand | active section links | appearance / enter / prepare
clear hero + form | local destination demonstration
existing sections
brand + access | product | help | legal
copyright + return to start
UVH giant wordmark
```

Self-review: avoid adding floating controls over content. Contextual preparation replaces Enter in the mobile header only after the form leaves view; Enter remains in the menu/footer. Preserve focused header controls and hide the contextual action when the menu is open or the closing CTA is visible. Compact desktop header uses hysteresis160/64px, retaining72px minimum height and44px controls. Content changes refresh geometry through one ResizeObserver; disconnect and cancel frames on destroy. Native anchors retain browser history and keyboard behavior.

## Task1 — Navigation, lifecycle and mobile access

Files: modify `frontend/src/app/landing/landing.component.ts` and `.html`; create `landing-navigation.spec.ts`.

Interfaces: `navigationItems` (IDs producto/control/operacion/faq), `activeSection`, `compactHeader`, `showMobileCreate`, `mobileCreateVisible`, private `scheduleMeasurements()`/`measureLayout()`/`captureLayout()`, `focusStart()` and owned `queueFocus()`.

- [x] Add component tests through actual DOM: section aria-current follows geometry, clears outside sections; frame coalescing/destruction; contextual action preserves focused controls; pending request freezes the input and unlocks on failure without replay.
- [x] Run focused tests against O74 and preserve failing output; keep all126 existing specs intact.
- [x] Cache owned elements after render. Schedule at most one frame, guard destroyed ref, calculate covered section using header bottom+32px. Clamp progress to[0,1]. Observe main/header sizes and disconnect on destroy.
- [x] Add active state/aria-current to native desktop/mobile links. Add mobile contextual button without overlaying content, preserve focus through visibility changes. Queue and cancel focus work for input/start/menu/tabs.
- [x] Run directed tests including existing landing contract tests.

Core measurement rules:
```ts
const line = header.getBoundingClientRect().height + 32;
const selected = sections.find(({ element }) => {
  const bounds = element.getBoundingClientRect();
  return bounds.top <= line && bounds.bottom > line;
});
// One frame is pending at a time. Cleanup cancels it and disconnects the observer.
```

## Task2 — Footer and purposeful motion

Files: modify `.html` and `.scss`.

- [x] Footer has brand/access, Product (four native section links), Help (help/status), Legal (privacy/terms/report), copyright and `focusStart()` button, followed by giant UVH.
- [x] Use3 link columns on desktop and2 on mobile. All links/buttons keep minimum44px and visible focus; heading receives programmatic focus for return-to-start.
- [x] Compact header, active underline and demo enter motion answer state changes. Existing reduced-motion override disables them. No repeated scroll reveals.

## Task3 — URL feedback and preparation

Files: modify `.ts` and `.html`/`.scss`; tests in new spec and isolated browser fixture.

- [x] Replace unused host/alias preview derivation with a boolean format check preserving http(s), no credentials and2048-character limit.
- [x] Show truthful format feedback; link input/help/error/status IDs correctly. During preparation use native readonly and aria-busy, preserving selected destination and allowing copy. Failure releases the field, keeps the entered URL and permits deliberate retry.
- [x] Preserve one request and opaque fragment handoff; no destination in auth URL. Fake browser command only; never real API/DB/accounts.

```html
<input [readOnly]="submitting()" />
<form [attr.aria-busy]="submitting()">…</form>
```

## Task4 — Verification and evidence

- [x] Directed tests, full frontend suite, build, lint and typecheck. Preserve terminal handles/results; only claim verified outcomes.
- [x] Owned static loopback fixture with no real proxy. Agent-browser preferred; documented O74 driver loss permits Playwright fallback. Test five widths and both themes, active anchors at every section, compact height/no jitter, footer grouping/wordmark, contextual action/focus/menu, deferred preparation/retry, tabs/FAQ/demo and reduced motion. Inspect screenshots after finite animations settle.
- [x] Freeze final hashes/build, regenerate source function inventory using read-only script, verify unchanged126 specs and backend241/E2E. Record requirement evidence and limits in selected planning files.

No shared uvh-control scripts or independent panel, accounts/mail/providers/workers/migrations, real writes, agents, commit or deployment. O74 verifier is historical after any product edit. This plan proves a local landing lot, not global completion.

## Additional finding during native-anchor QA

The router's coordinate scrolling ignores CSS scroll-margin. The landing previously had no ViewportScroller offset, so actual menu/footer clicks positioned section headings underneath the sticky header. Reuse the legal-shell pattern: a landing-owned callback measures the current header plus32px, reset on destroy. Focusable anchor sections allow Angular to transfer keyboard focus after mobile-menu navigation. Diagnostic JSON shows all four targets at approximately0px before correction despite104px computed margin. New test is red (one failure/15 successes) before the fix; verify real clicks after it.


## O75 — Menú, footer e interacciones del landing (08/10/2026)

Menú con sección visible/aria-current, cabecera compacta con histéresis160/64, footer agrupado Producto/Ayuda/Legal y acceso/retorno al inicio, acción contextual móvil que conserva foco, feedback de formato y URL readonly durante la preparación, transición local del destino/reduced-motion. Un RAF de medidas y otro de foco se cancelan al salir; ResizeObserver propio se desconecta. Se eliminan cálculos de preview sin uso. Navegación real reveló dos fallos corregidos: ViewportScroller ignoraba scroll-margin y tapaba destinos; coordenadas fraccionarias podían dejar marcada la sección anterior. Offset vivo de cabecera+32px, secciones enfocables, muestreo un píxel dentro del destino y restauración de offset al salir.

23 pruebas dirigidas finales, compilación29,770s/lint del landing/tipos exit0,87 estados de navegador en cinco anchos/ambos temas y dos POST ficticios (intento inicial y reintento explícito), sin overflow/pageerrors. Todos los procesos propios terminales; fixture81051 detenida130, QA33481 exit0,23dirigidas50122 ybuild/lint/tipos5108 exit0. Verificador29986 exit0. Tres fuentes de producto propias y un spec nuevo; hashes propios/build congelados. Capturas inspeccionadas: menú, anclas desktop/móvil, héroe y footer/wordmark en ambos temas.

Límite global: durante las comprobaciones llegaron cambios concurrentes en registro/admin/backend, conservados sin editarlos. Full inicial1752 pasó antes de corregir anclas; full posterior69177 exit1:1756 correctas/1 fallo en pausa de registros del admin. Lint global82815 exit1 por dos directivas de depuración no usadas; no se declara verde el workspace. Índice503/2448named/1333anonymous/3signatures se actualiza, pero no acredita revisión ni invariancia del backend concurrente. Evidencia ` .uvh-runtime/o75-landing-navigation/verify.py` y plan `docs/superpowers/plans/2026-10-08-landing-navigation-polish.md`. No API real/DB/cuentas/mail/control/panel ajeno/agentes/commit/deploy. O74 congelado.

Nuevo objetivo del usuario sustituye el anterior: terminar este lote y rehacer Ayuda/Denunciar enlace, extender lenguaje directo, diseño serio y profesional, transiciones y mejoras visuales a las demás páginas. Se empieza por shell público, Ayuda y Denuncia; después documentos/estado y restantes superficies, respetando cambios concurrentes.

La comprobación global se ejecutó y su fallo concurrente se registra: no queda certificada en verde. La invariancia de126 specs/backend241 del plan inicial no puede afirmarse tras los cambios concurrentes; se sustituye esa acreditación por hashes de los cuatro archivos propios.
