import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { DomainDto, DomainState } from "../../core/models";

const STATE_LABEL: Record<DomainState, string> = {
  pending: "Pendiente",
  verifying: "Verificando…",
  verified: "Verificado",
  active: "Activo",
  error: "Error",
  disabled: "Desactivado",
};

@Component({
  selector: "app-domains",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSnackBarModule,
  ],
  templateUrl: "./domains.component.html",
  styleUrl: "./domains.component.scss",
})
export class DomainsComponent {
  private api = inject(ApiService);
  private snackbar = inject(MatSnackBar);

  readonly domains = signal<DomainDto[]>([]);
  readonly loading = signal(true);
  readonly adding = signal(false);
  readonly verifyingId = signal<number | null>(null);
  readonly newDomain = signal("");
  readonly error = signal<string | null>(null);

  readonly stateLabel = (s: DomainState) => STATE_LABEL[s];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains");
      this.domains.set(domains);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los dominios");
    } finally {
      this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    const domain = this.newDomain().trim();
    if (!domain || this.adding()) return;
    this.adding.set(true);
    try {
      const { domain: created } = await this.api.post<{ domain: DomainDto }>("/api/v1/domains", { domain });
      this.newDomain.set("");
      this.snackbar.open("Dominio añadido. Añade el registro TXT para verificar.", "Cerrar", { duration: 4000 });
      this.domains.update((d) => [created, ...d]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo añadir el dominio", "Cerrar", { duration: 4000 });
    } finally {
      this.adding.set(false);
    }
  }

  async verify(d: DomainDto): Promise<void> {
    this.verifyingId.set(d.id);
    try {
      await this.api.post<{ state: string }>(`/api/v1/domains/${d.id}/verify`);
      this.snackbar.open("Dominio verificado correctamente", "Cerrar", { duration: 3000 });
      void this.load();
    } catch (err) {
      this.snackbar.open(
        err instanceof ApiRequestError ? err.message : "No se pudo verificar el dominio",
        "Cerrar",
        { duration: 5000 },
      );
      void this.load();
    } finally {
      this.verifyingId.set(null);
    }
  }

  async activate(d: DomainDto): Promise<void> {
    try {
      await this.api.post(`/api/v1/domains/${d.id}/activate`);
      this.snackbar.open("Dominio activado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  async disable(d: DomainDto): Promise<void> {
    try {
      await this.api.post(`/api/v1/domains/${d.id}/disable`);
      this.snackbar.open("Dominio desactivado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  async remove(d: DomainDto): Promise<void> {
    if (!confirm(`¿Eliminar el dominio ${d.domain}?`)) return;
    try {
      await this.api.delete(`/api/v1/domains/${d.id}`);
      this.snackbar.open("Dominio eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    }
  }

  copy(value: string): void {
    void navigator.clipboard.writeText(value).then(
      () => this.snackbar.open("Registro copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  trackByDomain(_i: number, d: DomainDto): number {
    return d.id;
  }
}
