import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { ApiService, ApiRequestError } from "../core/services/api.service";

@Component({
  selector: "app-reset-password",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <div class="wrap">
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

          <div class="alert error" *ngIf="error()">{{ error() }}</div>
          <div class="alert ok" *ngIf="done()">Contraseña actualizada. Ya puedes iniciar sesión.</div>

          <button mat-flat-button color="primary" type="submit" class="submit" [disabled]="form.invalid || busy() || done()">
            Guardar contraseña
          </button>
        </form>

        <a class="back" routerLink="/auth" *ngIf="done()">Ir a iniciar sesión</a>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--uvh-surface); }
      .card { width: 100%; max-width: 420px; background: #fff; border: 1px solid var(--uvh-border); border-radius: 18px; box-shadow: 0 24px 70px rgba(7,17,31,.1); padding: 32px 28px; }
      h2 { font-size: 21px; font-weight: 800; margin: 0 0 6px; }
      .sub { color: var(--uvh-muted); font-size: 14.5px; margin: 0 0 18px; }
      .form { display: flex; flex-direction: column; gap: 4px; }
      .alert { border-radius: 10px; padding: 11px 14px; font-size: 14px; margin-bottom: 12px; }
      .alert.error { background: rgba(220,38,38,.08); border: 1px solid rgba(220,38,38,.25); color: #b91c1c; }
      .alert.ok { background: rgba(0,169,157,.1); border: 1px solid rgba(0,169,157,.3); color: #00796b; }
      .submit { width: 100%; height: 46px; font-weight: 700; border-radius: 10px; }
      .back { display: inline-flex; margin-top: 14px; color: var(--uvh-muted); font-size: 13px; font-weight: 600; }
    `,
  ],
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
