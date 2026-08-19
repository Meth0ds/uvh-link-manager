import { Component, ChangeDetectionStrategy, effect, inject } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AuthService } from "./core/services/auth.service";

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
    effect(() => {
      const invalidated = this.auth.sessionInvalidated();
      const authenticated = this.auth.authenticated();

      if (invalidated && this.hadAuthenticatedSession && this.router.url.startsWith("/app")) {
        void this.router.navigate(["/auth"], { queryParams: { reason: "session-expired" } });
      }
      this.hadAuthenticatedSession = authenticated;
    });
  }
}
