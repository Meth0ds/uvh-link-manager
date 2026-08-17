import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { ApiService, ApiRequestError } from "../core/services/api.service";

@Component({
  selector: "app-forgot-password",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  templateUrl: "./forgot-password.component.html",
  styles: [
    `
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--uvh-surface); }
      .card { width: 100%; max-width: 420px; background: #fff; border: 1px solid var(--uvh-border); border-radius: 18px; box-shadow: 0 24px 70px rgba(7,17,31,.1); padding: 32px 28px; }
      h2 { font-size: 21px; font-weight: 800; margin: 0 0 6px; }
      .sub { color: var(--uvh-muted); font-size: 14.5px; line-height: 1.6; margin: 0 0 18px; }
      .form { display: flex; flex-direction: column; gap: 4px; }
      .alert { border-radius: 10px; padding: 11px 14px; font-size: 14px; margin-bottom: 12px; }
      .alert.error { background: rgba(220,38,38,.08); border: 1px solid rgba(220,38,38,.25); color: #b91c1c; }
      .alert.ok { background: rgba(0,169,157,.1); border: 1px solid rgba(0,169,157,.3); color: #00796b; }
      .submit { width: 100%; height: 46px; font-weight: 700; border-radius: 10px; }
      .back { display: inline-flex; margin-top: 14px; color: var(--uvh-muted); font-size: 13px; font-weight: 600; }
    `,
  ],
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);

  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post("/api/v1/auth/forgot-password", { email: this.form.controls.email.value.toLowerCase() });
      this.sent.set(true);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo enviar el correo");
    } finally {
      this.busy.set(false);
    }
  }
}
