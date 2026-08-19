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

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) await auth.init();
  return auth.user()?.isAdmin === true ? true : router.createUrlTree(["/forbidden"]);
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
