import { inject } from "@angular/core";
import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { catchError, throwError } from "rxjs";
import { WorkspaceService } from "../services/workspace.service";
import { AuthService } from "../services/auth.service";

/**
 * Adds cross-origin credentials (cookies: uvh_session/uvh_csrf) and the
 * X-Workspace-Id header to every API request. Public requests (no selected
 * workspace) are left without the workspace header.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const workspace = inject(WorkspaceService).currentId();
  const auth = inject(AuthService);
  const headers: Record<string, string> = Number.isSafeInteger(workspace) && (workspace as number) > 0
    ? { "X-Workspace-Id": String(workspace) }
    : {};

  return next(req.clone({ withCredentials: true, setHeaders: headers })).pipe(
    catchError((error: unknown) => {
      // A session can be revoked from another browser or by an administrator.
      // Fail closed as soon as the next API request receives 401 instead of
      // leaving the shell looking authenticated until a manual refresh.
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.sessionExpired();
      }
      return throwError(() => error);
    }),
  );
};
