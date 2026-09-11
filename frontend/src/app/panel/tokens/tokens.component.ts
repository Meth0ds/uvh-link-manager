import { Component, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { ApiTokenDto } from "../../core/models";
import { WorkspaceService } from "../../core/services/workspace.service";
import { AuthService } from "../../core/services/auth.service";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeApiTokensResponse, decodeCreatedApiTokenResponse } from "../../core/services/credential-response-decoders";

const SCOPES = [
  { value: "links:read", label: "Consultar enlaces" },
  { value: "links:write", label: "Crear y editar enlaces" },
  { value: "analytics:read", label: "Consultar analítica" },
  { value: "domains:read", label: "Consultar dominios" },
  { value: "domains:write", label: "Gestionar dominios" },
] as const;

@Component({
  selector: "app-tokens",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatSnackBarModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./tokens.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./tokens.component.scss",
})
export class TokensComponent {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);
  private auth = inject(AuthService);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly mutations = new LatestRequest(inject(DestroyRef));

  readonly tokens = signal<ApiTokenDto[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly plainToken = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly name = signal("");
  readonly expiresAt = signal("");
  readonly selectedScopes = signal<string[]>([]);
  readonly password = signal("");
  readonly factorCode = signal("");
  readonly user = this.auth.user;
  readonly scopeOptions = SCOPES;

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.requests.invalidate();
      this.mutations.invalidate();
      this.tokens.set([]);
      this.error.set(null);
      // Plain tokens and authentication factors must never cross workspaces.
      this.plainToken.set(null);
      this.password.set("");
      this.factorCode.set("");
      this.creating.set(false);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) {
      this.requests.invalidate();
      this.tokens.set([]);
      this.loading.set(false);
      return;
    }
    const request = this.requests.begin(workspaceId);
    this.loading.set(true);
    this.error.set(null);
    try {
      const { tokens } = await this.api.get<{ tokens: ApiTokenDto[] }>("/api/v1/tokens", undefined, decodeApiTokensResponse, { signal: request.signal });
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.tokens.set(tokens);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los tokens");
    } finally {
      if (this.requests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
    }
  }

  toggleScope(scope: string): void {
    this.selectedScopes.update((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  }

  async create(): Promise<void> {
    if (!this.name().trim() || !this.selectedScopes().length || !this.password()
      || (this.user()?.mfaEnabled && !this.factorCode().trim()) || this.creating()) return;
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const request = this.mutations.begin(workspaceId);
    this.creating.set(true);
    try {
      const { token, plainToken } = await this.api.post<{ token: ApiTokenDto; plainToken: string }>("/api/v1/tokens", {
        name: this.name().trim(),
        scopes: this.selectedScopes(),
        expiresAt: this.expiresAt() ? new Date(this.expiresAt()).toISOString() : null,
        password: this.password(),
        ...(this.factorCode().trim() ? { factorCode: this.factorCode().trim() } : {}),
      }, decodeCreatedApiTokenResponse);
      if (!this.mutations.isCurrent(request, this.workspaces.currentId())) return;
      this.tokens.update((t) => [token, ...t]);
      this.plainToken.set(plainToken);
      this.name.set("");
      this.expiresAt.set("");
      this.selectedScopes.set([]);
      this.password.set("");
      this.factorCode.set("");
      try {
        await this.auth.refreshUser();
      } catch {
        this.snackbar.open("Token creado. Recarga Ajustes para actualizar el estado de recuperación.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (!this.mutations.isCurrent(request, this.workspaces.currentId())) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo crear el token", "Cerrar", { duration: 4000 });
    } finally {
      if (this.mutations.isCurrent(request, this.workspaces.currentId())) this.creating.set(false);
    }
  }

  async revoke(t: ApiTokenDto): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Revocar token",
      message: `¿Revocar el token “${t.name}”? Las integraciones que lo usen dejarán de autenticarse y esta acción no se puede deshacer.`,
      confirmLabel: "Revocar token",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await this.api.delete(`/api/v1/tokens/${t.id}`);
      this.tokens.update((list) => list.filter((x) => x.id !== t.id));
      this.snackbar.open("Token revocado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  copyPlain(): void {
    const p = this.plainToken();
    if (!p) return;
    const write = navigator.clipboard?.writeText(p);
    if (!write) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void write.then(
      () => this.snackbar.open("Token copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  trackByToken(_i: number, t: ApiTokenDto): number {
    return t.id;
  }
}
