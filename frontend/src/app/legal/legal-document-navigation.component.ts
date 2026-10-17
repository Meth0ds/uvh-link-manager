import { UI_TEXT } from "../core/localisation/template-messages";
import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, NgZone, ViewChild, afterNextRender, computed, inject, input, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

export interface LegalSection { readonly id: string; readonly title: string; }

@Component({
  selector: "app-legal-document-navigation",
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./legal-document-navigation.component.scss",
  template: `
    <nav id="document-index" tabindex="-1" aria-label="Índice del documento" i18n-aria-label="@@ui.41a9156503a03b">
      <div class="outline-heading">
        <span><ng-container i18n="@@ui.88e6efb3084388">En este documento</ng-container></span>
        <button class="outline-toggle" type="button" [attr.aria-expanded]="expanded()" aria-controls="legal-outline-body" (click)="toggle()">
          {{ expanded() ? uiText.ui_fcbcef75b48f69 : uiText.ui_6b37bc8af603f5 }} <span class="toggle-mark" [class.is-open]="expanded()" aria-hidden="true"></span>
        </button>
      </div>
      @if (reading(); as position) {
        <div class="reading-position" role="progressbar" aria-label="Recorrido por el documento" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="position.percent" [attr.aria-valuetext]="uiText.ui_5eda18b899d81c + (position.index + 1) + uiText.ui_553c27d45c0c54 + sections().length" i18n-aria-label="@@ui.04deade24081d2">
          <span><ng-container i18n="@@ui.ef4b66b6f1f60e">En este punto</ng-container></span><b>{{ number(position.id) }} / {{ sections().length }}</b>
          <div class="reading-track" aria-hidden="true"><i [style.transform]="'scaleX(' + position.percent / 100 + ')' "></i></div>
        </div>
        <div class="document-track" aria-hidden="true"><i [style.transform]="'scaleX(' + position.percent / 100 + ')' "></i></div>
      }
      <div #body id="legal-outline-body" class="outline-body" [class.collapsed]="!expanded()">
        <label for="legal-chapter-search"><ng-container i18n="@@ui.c3701a46a8954e">Buscar un apartado</ng-container></label>
        <div class="search-field">
          <input #search id="legal-chapter-search" type="search" autocomplete="off" placeholder="Ej. seguridad" [value]="query()" (input)="searchChanged(search.value)"  i18n-placeholder="@@ui.e77a81b8195588"/>
          @if (query()) { <button type="button" aria-label="Limpiar búsqueda" (click)="clear()" i18n-aria-label="@@ui.a7859bae872b6c">×</button> }
        </div>
        <p class="outline-result" role="status">{{ query() ? filtered().length + uiText.ui_8e2d1073666ba5 : sections().length + uiText.ui_0ba53f647f35d6 }}</p>
        <ol>
          @for (section of filtered(); track section.id) {
            <li><a [routerLink]="[]" [fragment]="section.id" [class.is-current]="reading()?.id === section.id" [attr.aria-current]="reading()?.id === section.id ? 'location' : null">
              <span aria-hidden="true">{{ number(section.id) }}</span><span>{{ section.title }}</span>
            </a></li>
          } @empty { <li class="no-results"><ng-container i18n="@@ui.ab7d797f3b4ea7">No hay apartados con ese nombre. Prueba otra búsqueda.</ng-container></li> }
        </ol>
        <p class="outline-hint"><ng-container i18n="@@ui.f5912615afb52c">La búsqueda filtra el índice. El documento siempre se muestra completo.</ng-container></p>
      </div>
      <button class="print-document" type="button" (click)="print()"><span aria-hidden="true">↗</span> <ng-container i18n="@@ui.295877a4557d04">Imprimir o guardar PDF</ng-container></button>
    </nav>
  `,
})
export class LegalDocumentNavigationComponent {
  readonly uiText = UI_TEXT;
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private removeScrollListener?: () => void;
  private frame?: number;
  private resizeObserver?: ResizeObserver;
  @ViewChild("search") private search?: ElementRef<HTMLInputElement>;
  @ViewChild("body") private body?: ElementRef<HTMLElement>;
  readonly sections = input.required<readonly LegalSection[]>();
  readonly query = signal("");
  readonly expanded = signal(false);
  readonly reading = signal<{ id: string; index: number; percent: number } | null>(null);
  readonly filtered = computed(() => this.sections().filter((section) => fold(section.title).includes(fold(this.query()))));
  number(id: string): string { return String(this.sections().findIndex((section) => section.id === id) + 1).padStart(2, "0"); }
  constructor() {
    afterNextRender(() => {
      if (this.destroyRef.destroyed) return;
      const root = this.host.nativeElement.closest<HTMLElement>(".legal-doc");
      const view = this.document.defaultView;
      if (!root || !view) return;
      this.zone.runOutsideAngular(() => {
        const scroll = () => this.queueReading();
        view.addEventListener("scroll", scroll, { passive: true });
        this.removeScrollListener = () => view.removeEventListener("scroll", scroll);
        const Observer = (view as Window & typeof globalThis).ResizeObserver;
        if (typeof Observer === "function") {
          this.resizeObserver = new Observer(() => this.queueReading());
          this.resizeObserver.observe(root.querySelector(".doc-content") ?? root);
          const header = root.closest("app-legal-shell")?.querySelector<HTMLElement>(".legal-header");
          if (header) this.resizeObserver.observe(header);
        }
      });
      this.updateReading();
    });
    this.destroyRef.onDestroy(() => {
      if (this.frame !== undefined) this.document.defaultView?.cancelAnimationFrame(this.frame);
      this.frame = undefined;
      this.resizeObserver?.disconnect();
      this.removeScrollListener?.();
    });
  }
  toggle(): void { this.expanded.update((expanded) => !expanded); this.queueReading(); }
  searchChanged(value: string): void { this.query.set(value); this.queueReading(); }
  clear(): void { this.query.set(""); this.search?.nativeElement.focus(); this.queueReading(); }
  print(): void { this.document.defaultView?.print(); }
  @HostListener("window:resize")
  onResize(): void {
    // A breakpoint must not hide the control that currently holds focus.
    if ((this.document.defaultView?.innerWidth ?? 0) <= 680 && this.body?.nativeElement.contains(this.document.activeElement)) this.expanded.set(true);
    this.queueReading();
  }

  private queueReading(): void {
    const view = this.document.defaultView;
    if (!view || this.destroyRef.destroyed || this.frame !== undefined) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = undefined;
      if (!this.destroyRef.destroyed) this.updateReading();
    });
  }

  private updateReading(): void {
    const root = this.host.nativeElement.closest<HTMLElement>(".legal-doc");
    const view = this.document.defaultView;
    if (!root || !view) return;
    const entries = this.sections();
    const ids = new Map(entries.map((entry, index) => [entry.id, index]));
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(".doc-content .doc-section"))
      .filter((block) => ids.has(block.id));
    if (!blocks.length) return;
    const bounds = blocks.map((block) => ({ id: block.id, rect: block.getBoundingClientRect() }));
    const header = root.closest("app-legal-shell")?.querySelector<HTMLElement>(".legal-header");
    const line = (header?.getBoundingClientRect().height ?? 0) + 24;
    const first = bounds[0].rect.top;
    const last = bounds[bounds.length - 1].rect.bottom;
    const complete = last <= view.innerHeight;
    const current = complete ? bounds[bounds.length - 1] : [...bounds].reverse().find((block) => block.rect.top <= line) ?? bounds[0];
    // Position only; it is never stored or used as evidence of legal acceptance.
    const percent = complete ? 100 : Math.max(0, Math.min(99, Math.floor((line - first) / Math.max(1, last - first) * 100)));
    const previous = this.reading();
    if (previous?.id !== current.id || previous.percent !== percent) this.zone.run(() => this.reading.set({ id: current.id, index: ids.get(current.id)!, percent }));
  }
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();
}
