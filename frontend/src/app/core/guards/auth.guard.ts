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
  const returnTo = state.url && state.url !== "/" ? state.url : "/app";
  return router.createUrlTree(["/auth"], { queryParams: { returnTo } });
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  if (!auth.loaded()) await auth.init();
  return auth.user()?.isAdmin === true;
};
