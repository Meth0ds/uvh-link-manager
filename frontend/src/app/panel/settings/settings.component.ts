import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatRadioModule } from "@angular/material/radio";
import { MatDividerModule } from "@angular/material/divider";
import QRCode from "qrcode";
import { AuthService } from "../../core/services/auth.service";
import { ThemeService, type ThemePreference } from "../../core/services/theme.service";
import { ApiRequestError } from "../../core/services/api.service";
import type { Session } from "../../core/models";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatRadioModule,
    MatDividerModule,
  ],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.scss",
})
export class SettingsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private theme = inject(ThemeService);
  private snackbar = inject(MatSnackBar);

  readonly user = this.auth.user;

  // ---------------- Profile ----------------
  readonly profileBusy = signal(false);
  profileForm = this.fb.nonNullable.group({
    name: [this.user()?.name ?? "", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  // ---------------- Password ----------------
  readonly passwordBusy = signal(false);
  readonly hidePassword = signal(true);
  passwordForm = this.fb.nonNullable.group(
    {
      current: ["", [Validators.required]],
      next: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
      confirm: ["", [Validators.required]],
    },
    { validators: (g) => (g.get("next")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  // ---------------- Sessions ----------------
  readonly sessions = signal<Session[]>([]);
  readonly sessionsLoading = signal(true);

  // ---------------- MFA ----------------
  readonly mfaBusy = signal(false);
  readonly mfaSecret = signal<string | null>(null);
  readonly mfaUri = signal<string | null>(null);
  readonly mfaQr = signal<string | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  mfaPasswordForm = this.fb.nonNullable.group({
    password: ["", [Validators.required]],
  });
  mfaCodeForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  // ---------------- Appearance ----------------
  readonly themePref = this.theme.preference;
  readonly themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" },
    { value: "system", label: "Seguir sistema" },
  ];

  constructor() {
    void this.loadSessions();
  }

  private toast(err: unknown, ok: string): void {
    if (err instanceof ApiRequestError) {
      this.snackbar.open(err.message, "Cerrar", { duration: 4000 });
    } else {
      this.snackbar.open(ok, "Cerrar", { duration: 2500 });
    }
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.profileBusy()) return;
    this.profileBusy.set(true);
    try {
      await this.auth.updateProfile(this.profileForm.controls.name.value.trim());
      this.snackbar.open("Perfil actualizado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.profileBusy.set(false);
    }
  }

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid || this.passwordBusy()) return;
    this.passwordBusy.set(true);
    try {
      await this.auth.changePassword(
        this.passwordForm.controls.current.value,
        this.passwordForm.controls.next.value,
      );
      this.passwordForm.reset();
      this.snackbar.open("Contraseña actualizada", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.passwordBusy.set(false);
    }
  }

  async loadSessions(): Promise<void> {
    this.sessionsLoading.set(true);
    try {
      this.sessions.set(await this.auth.listSessions());
    } catch {
      this.sessions.set([]);
    } finally {
      this.sessionsLoading.set(false);
    }
  }

  async revokeSession(id: string): Promise<void> {
    try {
      await this.auth.revokeSession(id);
      this.snackbar.open("Sesión revocada", "Cerrar", { duration: 2500 });
      void this.loadSessions();
    } catch (err) {
      this.toast(err, "");
    }
  }

  async startMfaSetup(): Promise<void> {
    if (this.mfaPasswordForm.invalid || this.mfaBusy()) return;
    this.mfaBusy.set(true);
    try {
      const { secret, uri } = await this.auth.mfaSetup(this.mfaPasswordForm.controls.password.value);
      this.mfaSecret.set(secret);
      this.mfaUri.set(uri);
      this.mfaQr.set(await QRCode.toDataURL(uri, { width: 240, margin: 1 }));
      this.mfaCodeForm.reset();
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async enableMfa(): Promise<void> {
    if (this.mfaCodeForm.invalid || this.mfaBusy()) return;
    this.mfaBusy.set(true);
    try {
      const { recoveryCodes } = await this.auth.mfaEnable(this.mfaCodeForm.controls.code.value);
      this.recoveryCodes.set(recoveryCodes);
      this.snackbar.open("MFA activado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async disableMfa(): Promise<void> {
    if (this.mfaPasswordForm.invalid || this.mfaBusy()) return;
    if (!confirm("¿Desactivar la verificación en dos pasos?")) return;
    this.mfaBusy.set(true);
    try {
      await this.auth.mfaDisable(this.mfaPasswordForm.controls.password.value);
      this.mfaSecret.set(null);
      this.mfaUri.set(null);
      this.mfaQr.set(null);
      this.recoveryCodes.set([]);
      this.mfaPasswordForm.reset();
      this.snackbar.open("MFA desactivado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.toast(err, "");
    } finally {
      this.mfaBusy.set(false);
    }
  }

  cancelMfaSetup(): void {
    this.mfaSecret.set(null);
    this.mfaUri.set(null);
    this.mfaQr.set(null);
    this.mfaPasswordForm.reset();
    this.mfaCodeForm.reset();
  }

  setTheme(pref: ThemePreference): void {
    this.theme.set(pref);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
