import { Component, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";

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
import { ActionDialogService } from "../action-dialog.service";

const SCOPES = [
  { value: "links:read", label: "links:read — Leer enlaces" },
  { value: "links:write", label: "links:write — Crear y editar enlaces" },
  { value: "analytics:read", label: "analytics:read — Leer analítica" },
  { value: "domains:read", label: "domains:read — Leer dominios" },
  { value: "domains:write", label: "domains:write — Gestionar dominios" },
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
    MatSnackBarModule
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

  readonly tokens = signal<ApiTokenDto[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly plainToken = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly name = signal("");
  readonly expiresAt = signal("");
  readonly selectedScopes = signal<string[]>([]);
  readonly scopeOptions = SCOPES;

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { tokens } = await this.api.get<{ tokens: ApiTokenDto[] }>("/api/v1/tokens");
      this.tokens.set(tokens);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los tokens");
    } finally {
      this.loading.set(false);
    }
  }

  toggleScope(scope: string): void {
    this.selectedScopes.update((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  }

  async create(): Promise<void> {
    if (!this.name().trim() || !this.selectedScopes().length || this.creating()) return;
    this.creating.set(true);
    try {
      const { token, plainToken } = await this.api.post<{ token: ApiTokenDto; plainToken: string }>("/api/v1/tokens", {
        name: this.name().trim(),
        scopes: this.selectedScopes(),
        expiresAt: this.expiresAt() ? new Date(this.expiresAt()).toISOString() : null,
      });
      this.tokens.update((t) => [token, ...t]);
      this.plainToken.set(plainToken);
      this.name.set("");
      this.expiresAt.set("");
      this.selectedScopes.set([]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo crear el token", "Cerrar", { duration: 4000 });
    } finally {
      this.creating.set(false);
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
