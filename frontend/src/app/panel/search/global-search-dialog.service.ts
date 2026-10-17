import { DestroyRef, Injectable, effect, inject } from "@angular/core";
import { MatDialog, type MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { BreakpointObserver } from "@angular/cdk/layout";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { take } from "rxjs";
import { GlobalSearchService } from "../../core/services/global-search.service";
import { ApiService } from "../../core/services/api.service";
import { decodeLinkResponse } from "../../core/services/link-response-decoders";
import { LinkDialogService } from "../links/link-dialog.service";
import type { GlobalSearchDialogComponent, SearchSelection } from "./global-search-dialog.component";

@Injectable({ providedIn: "root" })
export class GlobalSearchDialogService {
  private readonly dialogs = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly links = inject(LinkDialogService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly breakpoint = inject(BreakpointObserver);
  readonly search = inject(GlobalSearchService);
  private active?: MatDialogRef<GlobalSearchDialogComponent, SearchSelection>;
  private opening = false;
  private actionController?: AbortController;
  private actionContext?: string;
  constructor() { effect(() => { const context = this.search.context(); if (this.actionContext && this.actionContext !== context) this.actionController?.abort(); }); }

  async open(owner: DestroyRef): Promise<void> {
    if (this.opening || this.active || (this.dialogs.openDialogs?.length ?? 0) > 0 || !this.search.auth.user()?.emailVerified || this.search.workspaces.currentId() === null) return;
    // A new search supersedes a previous selection whose QR read is still pending.
    this.actionController?.abort();
    const context = this.search.context(); this.opening = true;
    try {
      const { GlobalSearchDialogComponent } = await import("./global-search-dialog.component");
      if (owner.destroyed || context !== this.search.context() || (this.dialogs.openDialogs?.length ?? 0) > 0) return;
      const mobile = this.breakpoint.isMatched("(max-width: 600px)");
      const reducedMotion = this.breakpoint.isMatched("(prefers-reduced-motion: reduce)");
      const viewport = window.visualViewport;
      const ref = this.dialogs.open<GlobalSearchDialogComponent, undefined, SearchSelection>(GlobalSearchDialogComponent, {
        width: mobile ? "100vw" : "680px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 80px)",
        height: mobile ? `${viewport?.height ?? window.innerHeight}px` : undefined, panelClass: "uvh-search-dialog", backdropClass: "uvh-search-backdrop",
        ariaLabelledBy: "global-search-title", autoFocus: "input", restoreFocus: true, disableClose: true,
        enterAnimationDuration: reducedMotion ? 0 : 150, exitAnimationDuration: reducedMotion ? 0 : 120,
      });
      this.active = ref;
      let isMobile = mobile;
      const layout = () => {
        ref.updateSize(isMobile ? "100vw" : "680px", isMobile ? `${viewport?.height ?? window.innerHeight}px` : "");
        ref.updatePosition(isMobile ? { top: `${viewport?.offsetTop ?? 0}px`, left: "0" } : {});
      };
      const resize = this.breakpoint.observe("(max-width: 600px)").subscribe(state => { isMobile = state.matches; layout(); });
      // Mobile keyboards can shrink the visual viewport without changing CSS dvh.
      const viewportChanged = () => { if (isMobile) layout(); };
      viewport?.addEventListener("resize", viewportChanged);
      viewport?.addEventListener("scroll", viewportChanged);
      const disconnectViewport = () => { viewport?.removeEventListener("resize", viewportChanged); viewport?.removeEventListener("scroll", viewportChanged); };
      const backdrop = ref.backdropClick().subscribe(() => ref.close());
      const unregister = owner.onDestroy(() => { disconnectViewport(); ref.close(); this.actionController?.abort(); });
      ref.afterClosed().pipe(take(1)).subscribe(selection => {
        this.active = undefined; resize.unsubscribe(); backdrop.unsubscribe(); disconnectViewport(); unregister();
        if (selection && !owner.destroyed && selection.context === this.search.context()) void this.perform(selection, owner);
      });
    } catch { if (!owner.destroyed && context === this.search.context()) this.snackbar.open($localize`:@@ui.f97282be93de08:No se pudo abrir la búsqueda. Vuelve a intentarlo.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 }); }
    finally { this.opening = false; }
  }

  private async perform(selection: SearchSelection, owner: DestroyRef): Promise<void> {
    const action = selection.action; const current = () => !owner.destroyed && selection.context === this.search.context();
    if (!current()) return;
    if (action.kind === "create") {
      if (!this.search.canCreate()) return;
      this.links.openCreate("", owner).pipe(takeUntilDestroyed(owner)).subscribe(() => { /* the editor owns its confirmation state */ });
    } else if (action.kind === "workspace") {
      if (!this.search.workspaces.list().some(workspace => workspace.id === action.id)) return;
      this.search.workspaces.select(action.id); void this.router.navigate(["/app/links"]);
    } else if (action.kind === "all") {
      void this.router.navigate(["/app/links"], { queryParams: { q: action.q } });
    } else if (action.kind === "navigate") {
      if (this.search.navigation().some(group => group.items.some(item => item.path === action.path)) || /^\/app\/(links|domains)\/[1-9]\d*$/.test(action.path)) void this.router.navigateByUrl(action.path);
    } else {
      this.actionController?.abort(); const controller = new AbortController(); this.actionController = controller; this.actionContext = selection.context;
      const unregister = owner.onDestroy(() => controller.abort());
      try {
        const { link } = await this.api.get(`/api/v1/links/${action.id}`, undefined, decodeLinkResponse, { signal: controller.signal });
        if (!current() || this.actionController !== controller || controller.signal.aborted) return;
        const { QrDialogComponent } = await import("../links/qr-dialog.component");
        if (current() && !controller.signal.aborted && (this.dialogs.openDialogs?.length ?? 0) === 0) this.dialogs.open(QrDialogComponent, { data: { url: link.shareUrl ?? link.shortUrl, linkId: link.id }, width: "760px", maxWidth: "calc(100vw - 32px)" });
      } catch (error) { if (current() && !controller.signal.aborted) this.snackbar.open(error instanceof Error ? error.message : $localize`:@@ui.e1390e37174788:No se pudo abrir el QR de este enlace.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 }); }
      finally { unregister(); if (this.actionController === controller) { this.actionController = undefined; this.actionContext = undefined; } }
    }
  }
}
