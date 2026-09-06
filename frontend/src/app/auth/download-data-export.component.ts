import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Location } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { downloadBlob } from "../core/services/browser-download";

@Component({
  selector: "app-download-data-export",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <main class="card center" aria-live="polite">
        <mat-icon class="icon" [class.ok]="downloaded()" [class.bad]="error()">{{ downloaded() ? 'download_done' : (error() ? 'error_outline' : 'file_download') }}</mat-icon>
        <h2>{{ downloaded() ? 'Descarga iniciada' : (error() ? 'No se pudo descargar' : 'Tu archivo está listo') }}</h2>
        <p class="sub">{{ message() }}</p>
        @if (!downloaded() && !error()) {
          <button mat-flat-button color="primary" type="button" (click)="download()" [disabled]="busy()">
            <mat-icon>download</mat-icon>{{ busy() ? 'Preparando descarga…' : 'Descargar mis datos' }}
          </button>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">Volver a UVH</a>
        }
      </main>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DownloadDataExportComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly token: string;

  readonly busy = signal(false);
  readonly downloaded = signal(false);
  readonly error = signal(false);
  readonly message = signal("El enlace funciona una sola vez. La descarga sólo se consumirá cuando pulses el botón.");

  constructor() {
    this.token = authBearer(this.route);
    // Remove the bearer from address bar/history before any user interaction.
    this.location.replaceState("/auth/download-export");
    if (!this.token) {
      this.error.set(true);
      this.message.set("Falta el token de descarga.");
    }
  }

  async download(): Promise<void> {
    if (this.busy() || this.downloaded() || this.error()) return;
    this.busy.set(true);
    try {
      const blob = await this.api.postBlob("/api/v1/auth/data-export/download", { token: this.token });
      if (this.destroyRef.destroyed) return;
      if (!downloadBlob(blob, `uvh-datos-${new Date().toISOString().slice(0, 10)}.json`)) {
        // The server has already consumed this one-use bearer. Do not imply
        // that retrying the same link can recover a browser-side failure.
        this.error.set(true);
        this.message.set("El servidor entregó el archivo, pero el navegador no pudo guardarlo. Solicita una nueva exportación.");
        return;
      }
      this.downloaded.set(true);
      this.message.set("El archivo se ha entregado y el enlace ya ha quedado invalidado.");
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      this.error.set(true);
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo descargar el archivo.");
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }
}
