/**
 * Isolated visual fixture, NOT a route or auth bypass in the application.
 * Only the explicit design-preview build includes this entry point. It uses
 * the real shell/dialog components, fictional data and a rejecting API double.
 * No real account, database, credentials, proxy or writes are needed for QA.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, RouterOutlet } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog } from "@angular/material/dialog";
import { of } from "rxjs";
import { PanelComponent } from "../src/app/panel/panel.component";
import { PageHeaderComponent } from "../src/app/panel/page-header.component";
import { ActionDialogComponent } from "../src/app/panel/action-dialog.component";
import { AuthService } from "../src/app/core/services/auth.service";
import { WorkspaceService } from "../src/app/core/services/workspace.service";
import { ApiService } from "../src/app/core/services/api.service";
import { LinkDialogService } from "../src/app/panel/links/link-dialog.service";
import { WorkspacePreviewComponent } from "./workspace-preview.component";
import { blocked, currentId, fixtureRead } from "./workspace-fixture";

@Component({
  selector: "app-design-preview-content",
  standalone: true,
  imports: [PageHeaderComponent, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="fixture-notice">VISTA DE DISEÑO · DATOS FICTICIOS · SIN CONEXIÓN A LA API</p>
    <app-page-header icon="space_dashboard" eyebrow="Tu espacio de trabajo" title="Todo empieza por un enlace."
      description="Esta vista permite revisar la navegación, el modo oscuro y los diálogos reales sin acceder a una cuenta ni modificar datos.">
      <button mat-stroked-button (click)="openConfirmation()"><mat-icon>open_in_new</mat-icon> Revisar confirmación</button>
    </app-page-header>
    <section class="card-block">
      <span class="annotation">01 / CONTROLES COMPARTIDOS</span>
      <h2>Un espacio que se deja usar.</h2>
      <p>Prueba el selector de workspace, el menú de usuario y el cambio de tema. En móvil, abre la navegación para encontrar las mismas acciones.</p>
      <p class="note">Los botones de esta vista no crean ni eliminan datos. Los módulos internos se revisan por separado.</p>
    </section>
  `,
  styles: `
    .fixture-notice { margin: 0 0 28px; padding: 10px 12px; border: 1px dashed var(--uvh-muted); color: var(--uvh-muted); font: 10px/1.6 monospace; }
    .annotation { color: var(--uvh-electric); font: 10px/1.6 monospace; letter-spacing: .08em; }
    h2 { color: var(--uvh-ink); font-size: 26px; font-weight: 800; letter-spacing: -.04em; }
    p { max-width: 640px; color: var(--uvh-muted); font-size: 14px; line-height: 1.8; }
    .note { border-top: 1px solid var(--uvh-border); padding-top: 18px; font-size: 12px; }
  `,
})
class DesignPreviewContentComponent {
  private readonly dialog = inject(MatDialog);
  openConfirmation(): void {
    this.dialog.open(ActionDialogComponent, {
      width: "min(500px, 92vw)", maxWidth: "92vw", role: "alertdialog",
      data: { title: "Eliminar el enlace de ejemplo", message: "Esta es una confirmación de diseño. No hay ningún enlace real y aceptar no ejecuta ninguna operación.", confirmLabel: "Confirmar ejemplo", destructive: true },
    });
  }
}

@Component({ selector: "app-root", standalone: true, imports: [RouterOutlet], template: "<router-outlet />", changeDetection: ChangeDetectionStrategy.OnPush })
class DesignPreviewRootComponent {}

void bootstrapApplication(DesignPreviewRootComponent, {
  providers: [
    provideRouter([
      { path: "app", component: PanelComponent, children: [
        { path: "dashboard", component: WorkspacePreviewComponent, data: { page: "dashboard" } },
        { path: "getting-started", component: WorkspacePreviewComponent, data: { page: "getting-started" } },
        { path: "**", component: DesignPreviewContentComponent },
      ] },
      { path: "**", redirectTo: "app/dashboard" },
    ]),
    { provide: AuthService, useValue: { user: signal({ id: 900001, name: "Persona de ejemplo", email: "preview@example.invalid", isAdmin: false, emailVerified: true, mfaEnabled: false }), logout: blocked, refreshWorkspaces: blocked } },
    { provide: WorkspaceService, useValue: { currentId, list: signal([{ id: 1, name: "Estudio Norte", role: "owner" }, { id: 2, name: "Archivo editorial", role: "viewer" }]), select: (id: number) => currentId.set(id) } },
    { provide: ApiService, useValue: { get: fixtureRead, post: blocked, patch: blocked, delete: blocked } },
    { provide: LinkDialogService, useValue: { openCreate: () => of(null) } },
  ],
}).catch((error: unknown) => console.error(error));
