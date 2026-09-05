import { Component, ChangeDetectionStrategy, effect, inject } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AuthService } from "./core/services/auth.service";
import { safeReturnTo } from "./core/guards/auth.guard";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<router-outlet />`,
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private hadAuthenticatedSession = false;

  constructor() {
    // Session discovery is intentionally non-blocking. Public routes should
    // remain usable when the API is slow or temporarily unavailable; guards
    // still await the same coalesced init() promise before entering /app.
    void this.auth.init();

    effect(() => {
      const invalidated = this.auth.sessionInvalidated();
      const authenticated = this.auth.authenticated();
      const needsAdminMfa = this.auth.adminMfaReauthenticationRequired();

      if (invalidated && this.hadAuthenticatedSession && this.router.url.startsWith("/app")) {
        void this.router.navigate(["/auth"], { queryParams: { reason: "session-expired" } });
      } else if (needsAdminMfa && this.router.url.startsWith("/app/admin")) {
        void this.router.navigate(["/auth/reauthenticate"], {
          queryParams: { returnTo: safeReturnTo(this.router.url) },
        });
      }
      this.hadAuthenticatedSession = authenticated;
    });
  }
}
