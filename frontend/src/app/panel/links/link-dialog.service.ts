import { DestroyRef, effect, inject, Injectable, InjectionToken, Injector, type EffectRef, type Type } from "@angular/core";
import { MatDialog, type MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { NavigationStart, Router } from "@angular/router";
import { Observable, type Subscription } from "rxjs";
import type { LinkDialogComponent, LinkDialogData } from "./link-dialog.component";
import type { LinkDto } from "../../core/models";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";

export const LINK_EDITOR_LOADER = new InjectionToken<() => Promise<Type<LinkDialogComponent>>>("Link editor loader", {
  providedIn: "root",
  factory: () => () => import("./link-dialog.component").then(module => module.LinkDialogComponent),
});

@Injectable({ providedIn: "root" })
export class LinkDialogService {
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly session = inject(SessionContextService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly loadEditor = inject(LINK_EDITOR_LOADER);
  private modulePromise?: Promise<Type<LinkDialogComponent>>;

  openCreate(initialDestination = "", owner?: DestroyRef): Observable<LinkDto | null> {
    return this.open({ mode: "create", initialDestination }, owner);
  }

  openEdit(link: LinkDto, owner?: DestroyRef): Observable<LinkDto | null> {
    return this.open({ mode: "edit", link }, owner);
  }

  private context(): string {
    return JSON.stringify([this.session.generation(), this.session.user()?.id, this.workspaces.currentId(),
      this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }

  private editor(): Promise<Type<LinkDialogComponent>> {
    // Share code loading only; each opening still owns its form and result.
    return this.modulePromise ??= Promise.resolve().then(() => this.loadEditor()).catch(error => {
      this.modulePromise = undefined;
      throw error;
    });
  }

  private open(data: LinkDialogData, owner?: DestroyRef): Observable<LinkDto | null> {
    const context = this.context();
    return new Observable(subscriber => {
      let disposed = false;
      let settled = false;
      let ref: MatDialogRef<LinkDialogComponent, LinkDto> | undefined;
      let closed: Subscription | undefined;
      let watcher: EffectRef | undefined;
      let unregisterOwner: (() => void) | undefined;
      const current = () => !disposed && !owner?.destroyed && context === this.context();
      const cancel = () => {
        if (disposed) return;
        subscriber.next(null);
        subscriber.complete();
      };
      const navigation = this.router.events.subscribe(event => {
        if (!ref && event instanceof NavigationStart) cancel();
      });
      if (!current()) cancel();
      else {
        unregisterOwner = owner?.onDestroy(cancel);
        watcher = effect(() => { if (!current()) cancel(); }, { injector: this.injector, manualCleanup: true });
        void this.editor().then(component => {
          if (subscriber.closed || !current()) { cancel(); return; }
          ref = this.dialog.open<LinkDialogComponent, LinkDialogData, LinkDto>(component, {
            data,
            width: "1000px",
            height: "min(860px, calc(100dvh - 24px))",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100dvh - 24px)",
            disableClose: true,
            autoFocus: false,
          });
          closed = ref.afterClosed().subscribe({
            next: link => { settled = true; subscriber.next(current() ? link ?? null : null); },
            complete: () => subscriber.complete(),
          });
        }).catch(() => {
          if (subscriber.closed) return;
          if (current()) this.snackbar.open("No se pudo abrir el editor. Vuelve a intentarlo.", "Cerrar", { duration: 5000 });
          cancel();
        });
      }
      return () => {
        disposed = true;
        navigation.unsubscribe();
        watcher?.destroy();
        unregisterOwner?.();
        closed?.unsubscribe();
        if (!settled) ref?.close();
      };
    });
  }
}

export type { LinkDialogData };
