import { Component, inject, signal, ChangeDetectionStrategy } from "@angular/core";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { AuthShellComponent } from "./auth-shell.component";
import { ApiService, ApiRequestError } from "../core/services/api.service";

@Component({
  selector: "app-reset-password",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card">
        <h2>Nueva contraseña</h2>
        <p class="sub">Elige una contraseña nueva para tu cuenta.</p>

        <form class="form" [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline">
            <mat-label>Nueva contraseña</mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" />
            <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar' : 'Ocultar'">
              <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            <mat-hint>Mínimo 10 caracteres</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Confirmar contraseña</mat-label>
            <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" />
          </mat-form-field>

          @if (error()) {
            <div class="alert error">{{ error() }}</div>
          }
          @if (done()) {
            <div class="alert ok">Contraseña actualizada. Ya puedes iniciar sesión.</div>
          }

          <button mat-flat-button color="primary" type="submit" class="submit" [disabled]="form.invalid || busy() || done()">
            Guardar contraseña
          </button>
        </form>

        @if (done()) {
          <a class="back" routerLink="/auth">Ir a iniciar sesión</a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class ResetPasswordComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);
  readonly hide = signal(true);

  form = this.fb.nonNullable.group(
    {
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
      confirm: ["", [Validators.required]],
    },
    { validators: (g) => (g.get("password")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const token = this.route.snapshot.queryParamMap.get("token") ?? "";
      await this.api.post("/api/v1/auth/reset-password", { token, password: this.form.value.password });
      this.done.set(true);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo restablecer la contraseña");
    } finally {
      this.busy.set(false);
    }
  }
}
