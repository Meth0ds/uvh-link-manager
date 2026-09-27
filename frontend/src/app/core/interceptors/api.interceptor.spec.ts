import { TestBed } from "@angular/core/testing";
import { HttpErrorResponse, HttpRequest, HttpResponse } from "@angular/common/http";
import { firstValueFrom, of, throwError } from "rxjs";
import { apiInterceptor } from "./api.interceptor";
import { AuthService } from "../services/auth.service";
import { WorkspaceService } from "../services/workspace.service";

describe("apiInterceptor context isolation", () => {
  let auth: jasmine.SpyObj<AuthService>;
  let workspaces: { currentId: () => number | null };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "sessionGeneration",
      "authenticated",
      "sessionExpired",
      "requireAdminMfaReauthentication",
    ]);
    auth.sessionGeneration.and.returnValue(7);
    auth.authenticated.and.returnValue(true);
    workspaces = { currentId: () => 42 };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: WorkspaceService, useValue: workspaces },
      ],
    });
  });

  async function intercept(path: string, error?: HttpErrorResponse, method = "GET"): Promise<HttpRequest<unknown>> {
    let forwarded!: HttpRequest<unknown>;
    const request = new HttpRequest(method, path, null);
    await TestBed.runInInjectionContext(async () => {
      const result = apiInterceptor(request, (nextRequest) => {
        forwarded = nextRequest;
        return error ? throwError(() => error) : of(new HttpResponse({ status: 200 }));
      });
      if (error) await expectAsync(firstValueFrom(result)).toBeRejected();
      else await firstValueFrom(result);
    });
    return forwarded;
  }

  it("adds the workspace only to tenant-aware endpoints", async () => {
    expect((await intercept("/api/v1/links")).headers.get("X-Workspace-Id")).toBe("42");
    expect((await intercept("/api/v1/auth/me")).headers.has("X-Workspace-Id")).toBeFalse();
    expect((await intercept("/api/v1/config")).headers.has("X-Workspace-Id")).toBeFalse();
    expect((await intercept("/api/v1/admin/overview")).headers.has("X-Workspace-Id")).toBeFalse();
  });

  for (const path of ["/api/v1/tags", "/api/v1/collections", "/api/v1/link-templates", "/api/v1/analytics/export"]) {
    it(`scopes ${path} and its child routes to the selected workspace`, async () => {
      expect((await intercept(path)).headers.get("X-Workspace-Id")).toBe("42");
      expect((await intercept(`${path}/7?format=csv`)).headers.get("X-Workspace-Id")).toBe("42");
      for (const method of ["POST", "PATCH", "DELETE"]) {
        expect((await intercept(path, undefined, method)).headers.get("X-Workspace-Id")).toBe("42");
      }
    });

    it(`expires the session for ${path} failures`, async () => {
      await intercept(path, new HttpErrorResponse({ status: 401 }));
      expect(auth.sessionExpired).toHaveBeenCalledOnceWith(7);
    });

    it(`requires MFA again for ${path} when requested by the server`, async () => {
      await intercept(path, new HttpErrorResponse({ status: 403, error: { details: { reason: "mfa_reauthentication_required" } } }));
      expect(auth.requireAdminMfaReauthentication).toHaveBeenCalledOnceWith(7);
    });
  }

  it("treats account notifications as session requests without a workspace", async () => {
    expect((await intercept("/api/v1/notifications")).headers.has("X-Workspace-Id")).toBeFalse();
    await intercept("/api/v1/notifications/unread", new HttpErrorResponse({ status: 401 }));
    expect(auth.sessionExpired).toHaveBeenCalledOnceWith(7);
  });

  it("does not classify similar public names as tenant endpoints or invent a workspace", async () => {
    expect((await intercept("/api/v1/tags-public")).headers.has("X-Workspace-Id")).toBeFalse();
    workspaces.currentId = () => null;
    expect((await intercept("/api/v1/collections")).headers.has("X-Workspace-Id")).toBeFalse();
  });

  it("invalidates only a session-authenticated request and passes its generation", async () => {
    await intercept("/api/v1/links", new HttpErrorResponse({ status: 401 }));
    expect(auth.sessionExpired).toHaveBeenCalledOnceWith(7);
  });

  it("does not invalidate the live session for a public 401", async () => {
    await intercept("/api/v1/auth/login", new HttpErrorResponse({ status: 401 }));
    await intercept("/api/v1/auth/reset-password", new HttpErrorResponse({ status: 401 }));
    expect(auth.sessionExpired).not.toHaveBeenCalled();
  });

  it("does not let anonymous startup 401 announce a revoked session", async () => {
    auth.authenticated.and.returnValue(false);
    await intercept("/api/v1/auth/me", new HttpErrorResponse({ status: 401 }));
    expect(auth.sessionExpired).not.toHaveBeenCalled();
  });

  it("correlates MFA reauthentication with the originating generation", async () => {
    await intercept("/api/v1/admin/overview", new HttpErrorResponse({
      status: 403,
      error: { details: { reason: "mfa_reauthentication_required" } },
    }));
    expect(auth.requireAdminMfaReauthentication).toHaveBeenCalledOnceWith(7);
  });
});
