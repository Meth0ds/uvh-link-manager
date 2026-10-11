import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from "@angular/core";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { GlobalSearchService, type GlobalSearchResponse } from "../../core/services/global-search.service";
import { LatestRequest } from "../../core/services/latest-request";
import { linkStateLabel } from "../../core/link-state-label";
import { workspaceRoleLabel, isWorkspaceRole } from "../../core/workspace-role-label";
import { SearchHighlightComponent } from "./search-highlight.component";

export type SearchAction = { kind: "navigate"; path: string } | { kind: "create" } | { kind: "qr"; id: number } | { kind: "workspace"; id: number } | { kind: "all"; q: string };
export interface SearchSelection { action: SearchAction; context: string }
interface Option { key: string; group: string; title: string; subtitle: string; icon: string; state?: string; action: SearchAction | { kind: "choose-qr" } }
const EMPTY: GlobalSearchResponse = { version: 1, links: [], domains: [], moreLinks: false, moreDomains: false };

@Component({
  selector: "app-global-search-dialog", standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, SearchHighlightComponent],
  templateUrl: "./global-search-dialog.component.html", styleUrl: "./global-search-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchDialogComponent {
  readonly search = inject(GlobalSearchService);
  private readonly owner = inject(DestroyRef);
  private readonly dialog = inject(MatDialogRef<GlobalSearchDialogComponent, SearchSelection>);
  private readonly requests = new LatestRequest(this.owner);
  private readonly openingContext = this.search.context();
  private timer?: ReturnType<typeof setTimeout>;
  readonly q = signal(""); readonly qrMode = signal(false);
  readonly queryLength = computed(() => Array.from(this.q().trim()).length);
  readonly busy = signal(false); readonly error = signal<string | null>(null);
  readonly results = signal<GlobalSearchResponse>(EMPTY); readonly active = signal(0);
  readonly workspaceName = computed(() => this.search.workspaces.list().find(workspace => workspace.id === this.search.workspaces.currentId())?.name ?? "Tu workspace");
  readonly options = computed<Option[]>(() => {
    const term = this.q().trim().toLocaleLowerCase();
    const options: Option[] = [];
    if (!this.qrMode()) {
      if (this.search.canCreate()) options.push({ key: "create", group: "Acciones", title: "Crear enlace", subtitle: "Abrir el editor de enlaces", icon: "add", action: { kind: "create" } });
      options.push({ key: "qr", group: "Acciones", title: "Abrir editor QR", subtitle: "Elegir un enlace y preparar su QR", icon: "qr_code_2", action: { kind: "choose-qr" } });
      for (const group of this.search.navigation()) for (const item of group.items) options.push({ key: item.path, group: "Navegación", title: item.label, subtitle: group.label, icon: item.icon, action: { kind: "navigate", path: item.path } });
    }
    const local = options.filter(option => !term || `${option.title} ${option.subtitle}`.toLocaleLowerCase().includes(term));
    for (const link of this.results().links) local.push({ key: `link-${link.id}`, group: "Enlaces", title: link.name || this.displayUrl(link.shortUrl), subtitle: this.displayUrl(link.shortUrl), icon: "link", state: linkStateLabel(link.state),
      action: this.qrMode() ? { kind: "qr", id: link.id } : { kind: "navigate", path: `/app/links/${link.id}` } });
    if (!this.qrMode()) {
      const domainLabels = { online: "Disponible", degraded: "Degradado", provisioning: "Preparando", offline: "Sin servicio" };
      for (const domain of this.results().domains) local.push({ key: `domain-${domain.id}`, group: "Dominios", title: domain.hostname, subtitle: "Dominio personalizado", icon: "language", state: domainLabels[domain.state], action: { kind: "navigate", path: `/app/domains/${domain.id}` } });
      for (const workspace of this.search.workspaces.list()) {
        if (workspace.id !== this.search.workspaces.currentId() && (!term || workspace.name.toLocaleLowerCase().includes(term))) local.push({ key: `workspace-${workspace.id}`, group: "Cambiar de workspace", title: workspace.name, subtitle: isWorkspaceRole(workspace.role ?? "") ? workspaceRoleLabel(workspace.role as "owner" | "admin" | "editor" | "viewer") : "Workspace", icon: "workspaces", action: { kind: "workspace", id: workspace.id } });
      }
      if (Array.from(term).length >= 2) local.push({ key: "all", group: "Biblioteca", title: "Ver todos los enlaces", subtitle: `Buscar «${this.q().trim()}» en la biblioteca`, icon: "arrow_forward", action: { kind: "all", q: this.q().trim() } });
    }
    return local;
  });
  readonly optionGroups = computed(() => {
    const groups: { label: string; options: { option: Option; index: number }[] }[] = [];
    this.options().forEach((option, index) => {
      if (groups.at(-1)?.label !== option.group) groups.push({ label: option.group, options: [] });
      groups.at(-1)!.options.push({ option, index });
    });
    return groups;
  });
  readonly activeId = computed(() => this.options()[this.active()] ? `search-option-${this.active()}` : null);
  readonly status = computed(() => {
    if (!this.q() && !this.qrMode()) return "Busca en tu workspace o elige una acción.";
    if (this.busy()) return "Buscando…";
    if (this.error()) return "No se pudo completar la búsqueda.";
    if (Array.from(this.q().trim()).length < 2) return "Escribe al menos dos caracteres para buscar enlaces.";
    const { links, domains, moreLinks, moreDomains } = this.results();
    const linkCount = `${links.length}${moreLinks ? '+' : ''} ${links.length === 1 ? 'enlace' : 'enlaces'}`;
    const domainCount = `${domains.length}${moreDomains ? '+' : ''} ${domains.length === 1 ? 'dominio' : 'dominios'}`;
    return this.qrMode() ? `${linkCount}.` : `${linkCount} y ${domainCount}.`;
  });

  constructor() {
    effect(() => {
      const context = this.search.context();
      if (context !== this.openingContext) untracked(() => { this.requests.invalidate(); this.results.set(EMPTY); this.dialog.close(); });
    });
    this.owner.onDestroy(() => clearTimeout(this.timer));
  }
  displayUrl(url: string): string { return url.replace(/^https?:\/\//, ""); }
  onQuery(value: string): void {
    clearTimeout(this.timer); this.requests.invalidate();
    this.q.set(Array.from(value).slice(0, 200).join("")); this.active.set(0); this.results.set(EMPTY); this.error.set(null);
    this.busy.set(Array.from(this.q().trim()).length >= 2);
    if (this.busy()) this.timer = setTimeout(() => { void this.load(); }, 180);
  }
  async load(): Promise<void> {
    if (Array.from(this.q().trim()).length < 2 || this.search.context() !== this.openingContext) return;
    const request = this.requests.begin(this.openingContext); const q = this.q().trim();
    this.busy.set(true); this.error.set(null);
    try {
      const results = await this.search.search(q, request.signal);
      if (this.requests.isCurrent(request, this.search.context()) && q === this.q().trim()) { this.results.set(results); this.active.set(0); }
    } catch (error) {
      if (this.requests.isCurrent(request, this.search.context())) this.error.set(error instanceof Error ? error.message : "No se pudo buscar. Vuelve a intentarlo.");
    } finally { if (this.requests.isCurrent(request, this.search.context())) this.busy.set(false); }
  }
  choose(index: number): void {
    const option = this.options()[index];
    if (!option || this.search.context() !== this.openingContext) return;
    if (option.action.kind === "choose-qr") { this.qrMode.set(true); this.onQuery(""); return; }
    this.dialog.close({ action: option.action, context: this.openingContext });
  }
  onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (!(event.target instanceof HTMLInputElement)) return;
    const length = this.options().length;
    if (length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault(); this.active.set((this.active() + (event.key === "ArrowDown" ? 1 : -1) + length) % length);
      document.getElementById(`search-option-${this.active()}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && length) { event.preventDefault(); if (!this.busy()) this.choose(this.active()); }
  }
  close(): void { if (this.qrMode()) { this.qrMode.set(false); this.onQuery(""); } else this.dialog.close(); }
}
