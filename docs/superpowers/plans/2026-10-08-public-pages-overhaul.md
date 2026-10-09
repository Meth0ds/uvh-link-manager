# Public Pages Overhaul Implementation Plan

> **For agentic workers:** execute task by task inline in this authorized checkout. No delegation, branch changes, commits or deployment; these session constraints override workflow defaults.

**Goal:** Rebuild Help and Report around clear tasks, bring the other public pages into the same professional design, and add intentional menu/hover/action feedback, including the landing.

**Architecture:** LegalShell remains the shared header/footer and anchor-offset owner for Help, Report and legal documents; reuse it for service status. Local components continue to own search, CAPTCHA, report submission and status projection. Keep transport/security logic separate from visual transitions; preserve native navigation and Material input semantics.

**Tech Stack:** Angular22, TypeScript6, Material, SCSS, Manrope. No new packages, fonts or raster assets.

**Spec:** Updated human goal08/10: finish current landing first (O75 verified), completely overhaul Help/Report to remove abstract metaphors, extend serious professional language and visuals to other pages, and add microinteractions to landing/mobile/desktop menus. This plan is the concrete spec for this public-page lot; remaining auth/panel surfaces will be reconciled after it without touching concurrent edits.

## Global constraints and design

- Paper#f5f2e9, raised#fffcf5, ink#262821, muted#626357, accent#b53c20, guide#e5e8dc; existing dark tokens. Manrope headings/body; monospace only code/URLs.
- Direct task headings: Centro de ayuda; Crear y editar enlaces; Configurar un dominio; Permisos del equipo; Consultar los clics; Usar la API; Verificar webhooks; Resolver problemas; Denunciar un enlace; Cómo revisamos una denuncia; Página no encontrada; Acceso restringido.
- Search and report form take visual and DOM priority. Body15–16px, secondary13–14px;44px controls,16px mobile inputs. Reading width under80ch.
- Shared desktop navigation + accessible mobile disclosure; primary route active, clear return/access, grouped footer. No decorative chapter numbering unless actual steps or numbered legal clauses.
- One restrained entrance per page; hover/focus underline or2–3px icon movement180–220ms; pointer hover effects inside `(hover:hover) and (pointer:fine)`; touch press feedback and reduced-motion overrides. No perpetual decoration, layout jumps or animated availability signal.
- Preserve report categories, optional email/details, normalization/validation, single-flight admission, CAPTCHA config fail-closed and single-use reset, no navigation to reported destinations. No automatic report replay.
- Preserve technical guidance: API path/scopes, raw-body HMAC and milliseconds, five webhook attempts, at-least-once/event_id, roles/DNS/TLS distinctions. Preserve legal clauses/version/identity evidence and truthful unknown status.
- Existing concurrent auth/admin/backend changes are external to this lot. Freeze owned sources and a copied static build for QA. Do not claim whole workspace green if unrelated checks fail. No real API/DB/accounts/mail/providers/shared control/independent panel/agents/commit/deploy.

```
UVH | help / status / legal / report | theme / account / mobile menu
Help: literal title + description -> search -> task links -> index | guides
Report: literal title -> form | review procedure and safety -> contact channels
Legal: readable title/metadata -> index | clauses
Status: literal title -> refresh / truthful snapshot -> component states/incidents
Footer: brand / account | support | legal
```

Self-critique: keep UVH's established palette, use typography and task hierarchy rather than serif-accent metaphors or repeated all-caps labels. No duplicate hero slogans. Form before process also in actual DOM, not only CSS. Keep safety guidance short and contextual instead of making it the primary action.

## Task1 — Shared public chrome and landing microinteractions

Modify `frontend/src/app/legal/legal-shell.component.ts`, `.html`, `.scss`; create `legal-shell-navigation.spec.ts`. Modify landing SCSS only, after O75 evidence is frozen.

Interfaces: `mobileOpen: WritableSignal<boolean>`, `toggleMenu():void`, `closeMenu(restoreFocus?:boolean):void`, `onEscape():void`, `onResize():void`, owned `focusFrame` and existing ViewportScroller offset cleanup. Header navigation items `{path:string,label:string}[]` are fixed public destinations.

- [x] Tests: open menu makes projected main/footer inert and locks body; Escape restores trigger focus; desktop resize closes/unlocks; destroyed view cancels queued focus and resets router offset. Existing Help/Report tests exercise projection.
- [x] Implement disclosure with fixed overlay below72px header,44px trigger/brand/theme/links, account destinations and current-page semantics. Main remains a single landmark; projected status content is a section.
- [x] Group footer support/legal and access; replace “Enlaces con recorrido”/“Decisiones…” with “Acorta y gestiona tus enlaces”. Keep native links and skip focus.
- [x] Add landing desktop-nav hover/focus underline, mobile menu icon movement, CTA icon movement/pressed feedback and footer link feedback with motion preferences.

```ts
closeMenu(restoreFocus = false): void {
  this.mobileOpen.set(false);
  this.document.body.classList.remove('uvh-menu-open');
  if (restoreFocus) this.focusFrame = this.document.defaultView?.requestAnimationFrame(() => {
    this.focusFrame = undefined;
    if (!this.destroyRef.destroyed) this.menuButton?.nativeElement.focus();
  });
}
```

## Task2 — Help: search first and literal guides

Modify `frontend/src/app/help/help.component.ts`, `.html`, `.scss`; retain existing `help.component.spec.ts`.

Consumes existing `query`, `matchingChapters`, local DOM corpus, fragment router links and clipboard results. No external search/index or highlighted HTML.

- [x] Replace hero and seven chapter headings with the direct names above. Simplify prose without removing technical limitations; remove redundant chapter numbers and arbitrary serif/emphasis.
- [x] Promote search, four task shortcuts, persistent desktop index and mobile topic overview. Keep no-results guidance and clear/Escape/slash focus behavior. Search results enter as a single group via `animate.enter="results-enter"`; do not animate every paragraph.
- [x] Make anchors focusable; preserve all seven IDs. Set guide revision to2026-10-08 after content review. All index/clipboard/support controls≥44px and secondary content≥13px.

```html
<h1>Centro de ayuda</h1>
<p>Guías para crear enlaces, configurar tu espacio de trabajo y resolver problemas.</p>
<article id="links" tabindex="-1" aria-labelledby="links-title">…</article>
```

## Task3 — Report: form first and trustworthy completion

Modify `frontend/src/app/legal/report.component.ts`, `.html`, `.scss`; create `report-interaction.spec.ts` using a fake CAPTCHA component and deferred API responses.

Interfaces: preserve `submit():Promise<void>` and `form`; add `startAnotherReport():void` and private `focusAfterRender(selector:string):void` using `afterNextRender(...,{injector})` guarded by DestroyRef. Keep single-use CAPTCHA cleanup.

- [x] Tests: pending submission disables editing and prevents a duplicate; failure restores controls/values and clears used CAPTCHA without replay; success shows a dedicated completion panel, focuses it after render and allows a deliberate new report; late completion after destroy remains retired. Existing report contract tests unchanged.
- [x] Capture form values then `form.disable({emitEvent:false})` during admitted POST; enable in current finally. Keep pending text and formaria-busy; do not imply the report caused removal.
- [x] Actual DOM form before review aside; title “Denunciar un enlace”, supporting copy explains optional fields and no need to open destination. Three form groups, clear reason hint, loading/retry/error feedback. Success replaces fields and contains “Enviar otra denuncia” + help/home.
- [x] Keep all accepted references/categories and API payload, no real verification bypass or provider changes.

```ts
const v = this.form.getRawValue();
this.form.disable({emitEvent:false});
// Existing admitted single-flight request and context check.
// In current finally: this.form.enable({emitEvent:false}); CAPTCHA reset.
```

## Task4 — Remaining public pages

Modify legal-doc SCSS and only presentation/readiness text in terms/privacy HTML; preserve numbered clauses, dates, links and content policy. Modify public-status TS/HTML/SCSS to reuse LegalShell and remove duplicated header/footer. Modify status-page TS/SCSS for literal403/404 and restrained action feedback. Keep all data decoders/status rules/API/allowed navigation unchanged.

- [x] Legal docs: readable metadata/TOC/body,44px index/contact links, quieter summary panels; focusable anchors, no fabricated identity. Replace internal boot/config statements in unavailable identity state with clear public unavailability/contact wording; retain real identity display.
- [x] Status: clear snapshot/unknown explanations, keep local time/manual refresh and stale/source safeguards. Group entry transition on state changes; no heartbeat/green assumed health. Test original unknown and stale specs.
- [x] Error pages: “Acceso restringido”/“Página no encontrada”, useful original actions, no reflected query/fragment/secret. Use consistent Manrope and button/icon feedback; existing safe-navigation tests must pass.

## Task5 — Verify, critique and evidence

- [x] Directed public-page/safety tests, full frontend suite, build, lint/types. Log unrelated concurrent failures without altering their work. Cosmetic hover/layout changes rely on browser review, not mirrored CSS tests.
- [x] Copy final static build into own artifact and serve only that copy on loopback. Fake config/status/CAPTCHA iframe/report API; record method/path only. Verify actual report pending/error/success/new-report/invalid states with no destination visit, no real network/provider, explicit retries only.
- [x] Five widths1440/1024/768/390/320, both themes; Help search/match/empty/clear/slash/index/copy, report form/CAPTCHA/retry/reason/success, menu/Escape/resize/inert/focus, footer, terms/privacy/status/403/404, landing hover/microinteractions and reduced motion. Inspect captures for legibility, overflow, targets and input hints.
- [x] Freeze owned source hashes and copied build, regenerate local source index, record checks/process closure and remaining goal scope. O75 verifier is historical once landing SCSS/build changes.

## Resultado verificado — O76,08/10/2026

18 fuentes de producto y dos specs nuevas (ocho casos de navegación/formulario). Ocho requisitos nuevos de interacción y guardas de teardown;55 pruebas dirigidas antes del último caso y1767/1767 en suite completa después. Compilación/lint/tipos finales exit0 tras el ajuste visual. La suite funcional precede sólo a los últimos ajustes de clase/SCSS; no se atribuye una repetición de la suite a esos cambios cosméticos.

97 estados del build copiado/API ficticia, cinco anchuras1440/1024/768/390/320 y ambas apariencias, error/éxito/retry, sin overflow/pageerrors/red externa. Dos POST ficticios deliberados: fallo y nuevo intento; no replay. QA adicional: referencia inválida sin comando,28 anclas legales enfocadas y fuera de la cabecera,403 sin reflejar parámetros privados y refresco manual que conserva snapshot. Hover real: subrayado del menú de escritorio y flechas de CTA/menú móvil del landing; selector de motivo accionado también con ratón. Copia de ejemplo comprobada en navegador separado.

Se corrigen dos detalles detectados por QA: contador que se partía en320px y animación interna de hints Material que ignoraba reduced-motion. El override vive en LegalShell para cubrir tanto Ayuda como Denuncia. Cláusulas/versiones legales preservadas byte a byte después de retirar únicamente tabindex añadido.

Primeros intentos del harness confundieron el alcance del término «analítica», buscaron por rol un botón ya oculto en escritorio, pulsaron el centro de mat-select bajo su label y no esperaron la inicialización de la comprobación ficticia/carga lazy del índice. Se ajustaron las esperas y selectores nativos; no se usa force ni se elimina validación. La altura de la caja flex del contador incluía el hint paralelo: la comprobación final mide su texto con Range. Los intentos y logs quedan separados de los hallazgos visuales reales. Un build redundante se lanzó tras un script de edición con cwd incorrecto que no cambió producto; no se atribuye esa salida a la corrección.

Verificador local exit0:20 hashes de fuentes propias y128 archivos del build copiado;97 estados finales y cláusulas conservadas. Procesos propios cerrados; no DB/cuentas/correo/proveedor/control compartido/agents/commit/deploy. Inventario actualizado503/2455named/1335anonymous/3signatures/0provisional; enumeración frontend actual y evidencia PHP previa, no revisión completa backend.

El objetivo global sigue activo: acceso/recuperación y copy del panel requieren la continuación del plan `2026-10-08-remaining-pages-design.md`. La QA Chromium no acredita Firefox, lector de pantalla ni producción.
