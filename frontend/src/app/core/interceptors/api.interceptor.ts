import { inject } from "@angular/core";
import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { catchError, throwError } from "rxjs";
import { WorkspaceService } from "../services/workspace.service";
import { AuthService } from "../services/auth.service";

const WORKSPACE_SCOPED = /^\/api\/v1\/(?:links|domains|tokens|webhooks)(?:\/|$)|^\/api\/v1\/analytics\/overview(?:\/|$)/;
const SESSIONLESS_AUTH_PATHS = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/change-registration-email",
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/verify",
  "/api/v1/auth/mfa/recovery",
  "/api/v1/auth/verify-email",
  "/api/v1/auth/confirm-email-change",
  "/api/v1/auth/data-export/confirm",
  "/api/v1/auth/data-export/download",
  "/api/v1/auth/data-export/download/acknowledge",
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

function pathOf(url: string): string {
  try {
    return new URL(url, "https://uvh.invalid").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

function usesSession(path: string): boolean {
  if (SESSIONLESS_AUTH_PATHS.has(path)) return false;
  if (path.startsWith("/api/v1/auth/")) return true;
  if (/^\/api\/v1\/(?:links|workspaces|domains|tokens|webhooks|admin)(?:\/|$)/.test(path)) return true;
  if (path === "/api/v1/analytics/overview" || path.startsWith("/api/v1/analytics/overview/")) return true;
  return path === "/api/v1/link-intents/claim" || path === "/api/v1/link-intents/complete";
}

/**
 * Adds cross-origin credentials (cookies: uvh_session/uvh_csrf) and the
 * X-Workspace-Id header to every API request. Public requests (no selected
 * workspace) are left without the workspace header.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const path = pathOf(req.url);
  const workspace = inject(WorkspaceService).currentId();
  const auth = inject(AuthService);
  const generation = auth.sessionGeneration();
  const startedAuthenticated = auth.authenticated();
  const sessionRequest = usesSession(path);
  const headers: Record<string, string> = WORKSPACE_SCOPED.test(path)
    && Number.isSafeInteger(workspace) && (workspace as number) > 0
    ? { "X-Workspace-Id": String(workspace) }
    : {};

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
      return throwError(() => error);
    }),
  );
};
