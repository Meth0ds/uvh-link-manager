import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse, HttpParams } from "@angular/common/http";
import { firstValueFrom, type Observable } from "rxjs";
import { WorkspaceService } from "./workspace.service";
import type { ApiError } from "../models";

const CSRF_COOKIE = "uvh_csrf";

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private http = inject(HttpClient);
  private workspaces = inject(WorkspaceService);

  private csrfToken(): string | null {
    return readCookie(CSRF_COOKIE);
  }

  private headers(needsCsrf: boolean): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const ws = this.workspaces.currentId();
    if (ws != null) h["X-Workspace-Id"] = String(ws);
    if (needsCsrf) {
      const csrf = this.csrfToken();
      if (csrf) h["X-CSRF-Token"] = csrf;
    }
    return h;
  }

  private errorOf(err: HttpErrorResponse): ApiRequestError {
    const body = err.error as ApiError | undefined;
    return new ApiRequestError(body?.error ?? "Error del servidor", err.status, body?.details);
  }

  /** GET (safe — no CSRF header required). */
  get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return firstValueFrom(this.http.get<T>(path, { headers: this.headers(false), params: hp }));
  }

  /** POST (mutation — requires CSRF). */
  post<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(path, body ?? {}, { headers: this.headers(true) }));
  }

  /** PATCH (mutation — requires CSRF). */
  patch<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(path, body ?? {}, { headers: this.headers(true) }));
  }

  /** DELETE (mutation — requires CSRF). */
  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(path, { headers: this.headers(true) }));
  }

  /** Raw observable for callers that need streaming/loading states. */
  get$<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Observable<T> {
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return this.http.get<T>(path, { headers: this.headers(false), params: hp });
  }
}

export { ApiRequestError as ApiError };
