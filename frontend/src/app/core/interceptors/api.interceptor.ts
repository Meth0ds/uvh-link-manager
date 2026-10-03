import { inject } from "@angular/core";
import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { catchError, from, throwError } from "rxjs";
import { WorkspaceService } from "../services/workspace.service";
import { AuthService } from "../services/auth.service";
import { apiPathname, isWorkspaceScopedPath } from "../api-request-scope";


const SESSIONLESS_AUTH_PATHS = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/change-registration-email",
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/verify",
  "/api/v1/auth/mfa/recovery",
  "/api/v1/auth/verify-email",
  "/api/v1/auth/confirm-email-change",
  "/api/v1/auth/account-deletion/confirm",
  "/api/v1/auth/account-deletion/cancel",
  "/api/v1/auth/resend-verification",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/auth/security-incident/revoke",
  "/api/v1/auth/account-recovery/request",
  "/api/v1/auth/account-recovery/confirm",
  "/api/v1/auth/account-recovery/complete",
]);


function usesSession(path: string): boolean {
  if (SESSIONLESS_AUTH_PATHS.has(path)) return false;
  if (path.startsWith("/api/v1/auth/")) return true;
  if (isWorkspaceScopedPath(path)) return true;
  if (/^\/api\/v1\/(?:workspaces|admin|notifications)(?:\/|$)/.test(path)) return true;
  return path === "/api/v1/link-intents/claim" || path === "/api/v1/link-intents/complete";
}

/** Read only the bounded machine discriminator for a private artifact error. */
async function blobSessionConflict(blob: Blob): Promise<boolean> {
  if (blob.size > 4_096) return false;
  try {
    const body: unknown = JSON.parse(await blob.text());
    return typeof body === "object" && body !== null
      && "reason" in body && body.reason === "session_context_changed";
  } catch {
    return false;
  }
}

/**
 * Adds cross-origin credentials (cookies: uvh_session/uvh_csrf) and the
 * X-Workspace-Id header to every API request. Public requests (no selected
 * workspace) are left without the workspace header.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const path = apiPathname(req.url);
  const workspace = inject(WorkspaceService).currentId();
  const auth = inject(AuthService);
  const generation = auth.sessionGeneration();
  const startedAuthenticated = auth.authenticated();
  const sessionRequest = usesSession(path);
  const account = auth.user()?.id;
  const headers: Record<string, string> = isWorkspaceScopedPath(path)
    && Number.isSafeInteger(workspace) && (workspace as number) > 0
    ? { "X-Workspace-Id": String(workspace) }
    : {};
  if (sessionRequest && Number.isSafeInteger(account) && (account as number) > 0) {
    headers["X-Uvh-Account-Id"] = String(account);
  }
  const reconcileConflict = (): void => {
    if (auth.user()?.id === account) auth.sessionContextChanged(generation);
  };

  return next(req.clone({ withCredentials: true, setHeaders: headers })).pipe(
    catchError((error: unknown) => {
      // A session can be revoked from another browser or by an administrator.
      // Fail closed as soon as the next API request receives 401 instead of
      // leaving the shell looking authenticated until a manual refresh.
      if (error instanceof HttpErrorResponse && error.status === 401 && sessionRequest && startedAuthenticated) {
        auth.sessionExpired(generation);
      }
      if (
        error instanceof HttpErrorResponse
        && error.status === 403
        && sessionRequest
        && startedAuthenticated
        && error.error?.details?.reason === "mfa_reauthentication_required"
      ) {
        auth.requireAdminMfaReauthentication(generation);
      }
      if (error instanceof HttpErrorResponse && error.status === 409 && sessionRequest && startedAuthenticated) {
        if (error.error instanceof Blob) {
          // Blob.text() is asynchronous; retain the originating context while
          // decoding so a late artifact error cannot clear a newer login.
          return from(blobSessionConflict(error.error).then((conflict) => {
            if (conflict) reconcileConflict();
            throw error;
          }));
        }
        if (error.error?.reason === "session_context_changed") reconcileConflict();
      }
      return throwError(() => error);
    }),
  );
};
