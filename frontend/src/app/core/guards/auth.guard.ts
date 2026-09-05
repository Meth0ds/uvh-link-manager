import { inject } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";
import { AuthService } from "../services/auth.service";

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.loaded()) {
    await auth.init();
  }
  if (auth.authenticated()) {
    return true;
  }
  const returnTo = safeReturnTo(state.url);
  return router.createUrlTree(["/auth"], { queryParams: { returnTo } });
};

export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.init();
  if (auth.user()?.isAdmin !== true) return router.createUrlTree(["/forbidden"]);
  try {
    const status = await auth.mfaSessionStatus();
    if (!status.enabled) return router.createUrlTree(["/forbidden"]);
    if (status.fresh) return true;
    return router.createUrlTree(["/auth/reauthenticate"], {
      queryParams: { returnTo: safeReturnTo(state.url) },
    });
  } catch {
    // The backend remains the source of truth and fails every admin endpoint
    // closed. Keep navigation closed too when freshness cannot be established.
    return router.createUrlTree(["/forbidden"]);
  }
};

/** Never allow a guard to turn a URL query parameter into an open redirect. */
export function safeReturnTo(value: string): string {
  if (
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    value.length <= 1024
  ) {
    return value;
  }
  return "/app";
}
