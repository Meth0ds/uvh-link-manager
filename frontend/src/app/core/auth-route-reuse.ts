import { BaseRouteReuseStrategy, type ActivatedRouteSnapshot } from "@angular/router";

/** Snapshot authority and credentials belong to one navigation, never the next. */
export class AuthRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    return future.routeConfig?.data?.["renewAuthContext"] === true
      ? false
      : super.shouldReuseRoute(future, current);
  }
}
