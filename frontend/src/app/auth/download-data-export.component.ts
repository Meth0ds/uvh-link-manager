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
      <section class="card center" aria-labelledby="download-data-export-title">
        <span class="step-kicker">TUS DATOS / DESCARGA</span>
        <mat-icon class="icon" aria-hidden="true" [class.ok]="downloaded()" [class.bad]="error()">{{ downloaded() ? 'download_done' : (error() ? 'error_outline' : 'file_download') }}</mat-icon>
        <h2 id="download-data-export-title">{{ downloaded() ? 'Descarga iniciada' : (error() ? 'No se pudo descargar' : 'Descarga tus datos') }}</h2>
        <p class="sub" role="status">{{ message() }}</p>
        @if (!hasDownloadLink) {
          <a mat-flat-button routerLink="/auth">Volver al acceso</a>
        } @else if (!downloaded()) {
          <button mat-flat-button color="primary" type="button" (click)="download()" [disabled]="busy()">
            <mat-icon>download</mat-icon>{{ busy() ? 'Preparando descarga…' : 'Descargar mis datos' }}
          </button>
        } @else {
          <a mat-flat-button color="primary" routerLink="/auth">Volver a UVH</a>
        }
      </section>
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

  /** Avoid presenting an enabled download that cannot do anything. */
  get hasDownloadLink(): boolean { return this.token.length > 0; }

  readonly busy = signal(false);
  readonly downloaded = signal(false);
  readonly error = signal(false);
  readonly message = signal("El enlace se cerrará cuando el navegador haya recibido el archivo completo.");

  constructor() {
    this.token = authBearer(this.route);
    // Remove the bearer from address bar/history before any user interaction.
    this.location.replaceState("/auth/download-export");
    if (!this.token) {
      this.error.set(true);
      this.message.set("Abre el enlace de descarga desde tu correo. Esta dirección no contiene una autorización válida.");
    }
  }

  async download(): Promise<void> {
    if (this.busy() || this.downloaded() || !this.token) return;
    this.busy.set(true);
    this.error.set(false);
    try {
      const blob = await this.api.postBlob("/api/v1/auth/data-export/download", { token: this.token });
      if (this.destroyRef.destroyed) return;
      if (!downloadBlob(blob, `uvh-datos-${new Date().toISOString().slice(0, 10)}.json`)) {
        // The acknowledgement has not been sent, so a browser-side failure
        // leaves the bearer and private artifact available for a safe retry.
        this.error.set(true);
        this.message.set("El navegador no pudo iniciar el guardado. El enlace sigue disponible para volver a intentarlo.");
        return;
      }
      this.downloaded.set(true);
      try {
        // postBlob resolves only after the complete body is in browser memory.
        // A separate acknowledgement avoids consuming the only bearer when
        // the network is interrupted halfway through the response.
        await this.api.post("/api/v1/auth/data-export/download/acknowledge", { token: this.token });
        if (!this.destroyRef.destroyed) this.message.set("El archivo se ha recibido y el enlace ha quedado invalidado.");
      } catch {
        if (!this.destroyRef.destroyed) {
          this.message.set("El archivo se ha recibido. No se pudo confirmar el cierre del enlace; caducará automáticamente.");
        }
      }
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      this.error.set(true);
      this.message.set(error instanceof ApiRequestError ? error.message : "No se pudo descargar el archivo.");
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }
}
