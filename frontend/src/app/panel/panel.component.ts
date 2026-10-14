import { DestroyRef, Component, computed, effect, HostListener, ElementRef, inject, signal, ChangeDetectionStrategy, viewChild } from "@angular/core";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { BreakpointObserver } from "@angular/cdk/layout";
import { filter, map, startWith } from "rxjs";
import { NavigationEnd, RouterOutlet, RouterLink, RouterLinkActive, Router } from "@angular/router";
import { MatSidenavModule } from "@angular/material/sidenav";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatListModule } from "@angular/material/list";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatDividerModule } from "@angular/material/divider";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";

import { AuthService } from "../core/services/auth.service";
import { NotificationService } from "../core/services/notification.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { isWorkspaceRole, workspaceRoleLabel } from "../core/workspace-role-label";
import { LinkDialogService } from "./links/link-dialog.service";
import { WorkspaceDialogComponent, type WorkspaceDialogResult } from "./workspace-dialog.component";
import { GlobalSearchDialogService } from "./search/global-search-dialog.service";
import { PANEL_NAVIGATION, visiblePanelNavigation, canEditLinks } from "./panel-navigation";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

const NAVIGATION_STORAGE_PREFIX = "uvh.navigation.pinned.v1.";
const NAVIGATION_OPEN_DELAY = 70;
const NAVIGATION_CLOSE_DELAY = 100;

@Component({
  selector: "app-panel",
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatDividerModule,
    MatSnackBarModule,
    PublicThemeToggleComponent,
  ],
  templateUrl: "./panel.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./panel.component.scss",
})
export class PanelComponent {
  private auth = inject(AuthService);
  private readonly dialogOwner = inject(DestroyRef);
  private router = inject(Router);
  private dialog = inject(LinkDialogService);
  private materialDialog = inject(MatDialog);
  private breakpoint = inject(BreakpointObserver);
  private snackbar = inject(MatSnackBar);

  readonly globalSearch = inject(GlobalSearchDialogService);
  readonly searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  openSearch(event?: MouseEvent): void {
    // Safari does not focus buttons on pointer clicks; give the dialog a stable return target.
    if (event?.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus({ preventScroll: true });
    void this.globalSearch.open(this.dialogOwner);
  }
  @HostListener("document:keydown", ["$event"])
  onSearchShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || (this.materialDialog.openDialogs?.length ?? 0) > 0) return;
    event.preventDefault(); this.openSearch();
  }

  readonly workspaces = inject(WorkspaceService);
  readonly notifications = inject(NotificationService);
  readonly user = this.auth.user;
  readonly unreadNotificationsLabel = computed(() => this.notifications.unread() > 0
    ? `${this.notifications.unread()} notificaciones sin leer`
    : "Notificaciones");
  readonly isAdmin = computed(() => this.user()?.isAdmin === true);
  readonly workspaceName = computed(() => this.workspaces.list().find((workspace) => workspace.id === this.workspaces.currentId())?.name ?? "Sin workspace");
  readonly workspaceRole = computed(() => this.workspaces.list().find(w => w.id === this.workspaces.currentId())?.role);
  readonly canCreate = computed(() => canEditLinks(this.user(), this.workspaces.currentRole()));
  readonly roleLabel = computed(() => {
    return this.roleLabelFor(this.workspaceRole());
  });

  roleLabelFor(role: string | null | undefined): string {
    if (!role) return "Sin rol asignado";
    return isWorkspaceRole(role) ? workspaceRoleLabel(role) : "Rol personalizado";
  }
  // Derive the breadcrumb from known routes only; never echo URL parameters.
  private readonly currentUrl = toSignal(this.router.events.pipe(
    filter(event => event instanceof NavigationEnd),
    map(event => event.urlAfterRedirects.split(/[?#]/)[0]),
    startWith(this.router.url.split(/[?#]/)[0]),
  ));
  readonly hasContextualCreate = computed(() => ["/app/dashboard", "/app/links"].includes(this.currentUrl() ?? ""));
  readonly currentPage = computed(() => this.nav.flatMap(group => group.items)
    .find(item => this.currentUrl() === item.path || this.currentUrl()?.startsWith(item.path + "/"))?.label ?? "Panel");
  readonly mobileOpen = signal(false);
  readonly logoutBusy = signal(false);
  readonly isMobile = toSignal(this.breakpoint.observe("(max-width: 720px)").pipe(map((state) => state.matches)), { initialValue: false });
  readonly panelMain = viewChild<ElementRef<HTMLElement>>("panelMain");
  private mainPagePath = this.router.url.split(/[?#]/)[0];
  readonly panelContent = viewChild.required<ElementRef<HTMLElement>>("panelContent");
  // Reserve a compact main rail throughout the desktop dashboard. Revealing
  // its labels overlays the page; only explicit pinning reserves more space.
  readonly mainNavPinned = signal(this.readMainNavPreference(this.user()?.id));
  readonly mainNavHovered = signal(false);
  readonly mainNavFocused = signal(false);
  readonly mainNavRail = computed(() => !this.isMobile());
  readonly mainNavExpanded = computed(() => !this.mainNavRail() ||
    this.mainNavPinned() || this.mainNavHovered() || this.mainNavFocused());
  readonly mainNavToggle = viewChild("mainNavToggle", { read: ElementRef<HTMLButtonElement> });
  private mainNavAccount = this.user()?.id;
  private mainNavOpenTimer?: ReturnType<typeof setTimeout>;
  private mainNavCloseTimer?: ReturnType<typeof setTimeout>;
  private mainNavPointerInside = false;
  private mainNavDismissed = false;

  private readMainNavPreference(userId: number | undefined): boolean {
    if (!Number.isSafeInteger(userId) || !userId || userId < 1) return false;
    try { return localStorage.getItem(NAVIGATION_STORAGE_PREFIX + userId) === "true"; }
    catch { return false; }
  }

  private clearMainNavTimers(): void {
    clearTimeout(this.mainNavOpenTimer); clearTimeout(this.mainNavCloseTimer);
    this.mainNavOpenTimer = undefined; this.mainNavCloseTimer = undefined;
  }

  private resetMainNavReveal(): void {
    this.clearMainNavTimers(); this.mainNavPointerInside = false; this.mainNavDismissed = false;
    this.mainNavHovered.set(false); this.mainNavFocused.set(false);
  }

  onMainNavPointerEnter(event: PointerEvent): void {
    if (event.pointerType !== "mouse" || !this.mainNavRail()) return;
    this.mainNavPointerInside = true;
    clearTimeout(this.mainNavCloseTimer);
    if (this.mainNavDismissed || this.mainNavHovered() || this.mainNavOpenTimer !== undefined) return;
    this.mainNavOpenTimer = setTimeout(() => {
      this.mainNavOpenTimer = undefined;
      if (!this.dialogOwner.destroyed && this.mainNavPointerInside && !this.mainNavDismissed && this.mainNavRail()) this.mainNavHovered.set(true);
    }, NAVIGATION_OPEN_DELAY);
  }

  onMainNavPointerLeave(): void {
    this.mainNavPointerInside = false; this.mainNavDismissed = false;
    clearTimeout(this.mainNavOpenTimer); this.mainNavOpenTimer = undefined;
    clearTimeout(this.mainNavCloseTimer);
    this.mainNavCloseTimer = setTimeout(() => {
      this.mainNavCloseTimer = undefined;
      if (!this.dialogOwner.destroyed && !this.mainNavPointerInside) this.mainNavHovered.set(false);
    }, NAVIGATION_CLOSE_DELAY);
  }

  toggleMainNavPinned(): void {
    const pinned = !this.mainNavPinned();
    this.resetMainNavReveal(); this.mainNavPinned.set(pinned);
    const userId = this.user()?.id;
    if (Number.isSafeInteger(userId) && userId && userId > 0) {
      try { localStorage.setItem(NAVIGATION_STORAGE_PREFIX + userId, String(pinned)); }
      catch { /* Navigation remains usable when browser storage is unavailable. */ }
    }
  }

  onMainNavEscape(event: Event): void {
    if (event.defaultPrevented || !this.mainNavRail() || this.mainNavPinned() || !this.mainNavExpanded()) return;
    this.clearMainNavTimers(); this.mainNavDismissed = this.mainNavPointerInside;
    this.mainNavHovered.set(false); this.mainNavFocused.set(false);
    const shell = event.currentTarget;
    if (shell instanceof HTMLElement && shell.querySelector("#panel-navigation")?.contains(document.activeElement)) {
      this.mainNavToggle()?.nativeElement.focus({ preventScroll: true });
    }
    event.preventDefault(); event.stopPropagation();
  }

  onMainNavFocusIn(event: FocusEvent): void {
    // Pointer focus must not keep a hover reveal open after the pointer leaves.
    const target = event.target;
    const visible = target instanceof HTMLElement && target.matches(":focus-visible");
    if (visible) this.mainNavDismissed = false;
    this.mainNavFocused.set(visible);
  }

  onMainNavFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) {
      this.mainNavFocused.set(false);
    }
  }


  // La campana sigue el ritmo de navegación: cada página del panel puede haber
  // registrado o leído avisos. El fallo silencioso conserva el último contador.
  private readonly unreadRefresh = this.router.events
    .pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed())
    .subscribe(event => {
      const path = (event as NavigationEnd).urlAfterRedirects.split(/[?#]/)[0];
      if (path !== this.mainPagePath) {
        // The panel scrolls inside <main>; window scroll restoration cannot
        // reset this container. Same-page filters keep the reader's position.
        const main = this.panelMain()?.nativeElement;
        if (main) main.scrollTop = 0;
      }
      this.mainPagePath = path;
      void this.notifications.refreshUnread().catch(() => undefined);
    });

  constructor() {
    effect(() => {
      const userId = this.user()?.id;
      if (userId !== this.mainNavAccount) {
        this.mainNavAccount = userId; this.resetMainNavReveal(); this.mainNavPinned.set(this.readMainNavPreference(userId));
      }
    });
    effect(() => { this.isMobile(); this.resetMainNavReveal(); });
    this.dialogOwner.onDestroy(() => this.clearMainNavTimers());
    void this.notifications.refreshUnread().catch(() => undefined);
  }

  readonly initials = computed(() => {
    const name = this.user()?.name ?? "?";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  });

  readonly nav = PANEL_NAVIGATION;

  readonly visibleNav = computed(() => visiblePanelNavigation(this.user(), this.workspaces.currentRole()));

  onWorkspaceChange(id: number): void {
    this.workspaces.select(id);
  }

  skipToContent(event: Event): void {
    // Angular's document-level link handling can resolve a bare fragment
    // against the application base and leave the current child route. Keep the
    // skip link on this page and move focus to the explicit main landmark.
    event.preventDefault();
    this.panelContent().nativeElement.focus();
  }

  newLink(): void {
    if (!this.canCreate()) return;
    this.dialog.openCreate("", this.dialogOwner).subscribe();
  }

  createWorkspace(): void {
    this.materialDialog.open(WorkspaceDialogComponent, {
      width: "min(480px, 92vw)",
      maxWidth: "92vw",
      autoFocus: "first-tabbable",
      ariaLabel: "Crear workspace",
    }).afterClosed().subscribe(async (result: WorkspaceDialogResult | undefined) => {
      if (!result) return;
      await this.auth.refreshWorkspaces();
      this.workspaces.select(result.workspace.id);
    });
  }

  async logout(): Promise<void> {
    if (this.logoutBusy()) return;
    this.logoutBusy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigate(["/"]);
    } catch {
      this.snackbar.open("No se pudo confirmar el cierre de sesión. Vuelve a intentarlo.", "Cerrar", { duration: 6000 });
    } finally {
      this.logoutBusy.set(false);
    }
  }
}
