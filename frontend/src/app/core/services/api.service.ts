import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse, HttpParams } from "@angular/common/http";
import { catchError, firstValueFrom, throwError, type Observable } from "rxjs";
import type { ApiError } from "../models";
import { retryAfterSeconds } from "./retry-after";

const CSRF_COOKIES = ["__Host-uvh_csrf", "uvh_csrf"] as const;

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, details?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function readCookie(name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private http = inject(HttpClient);
  private csrfRequest?: Promise<void>;

  private csrfToken(): string | null {
    for (const name of CSRF_COOKIES) {
      const token = readCookie(name);
      if (token) return token;
    }
    return null;
  }

  /** Ensure the CSRF cookie exists before a mutation, coalescing concurrent calls. */
  private ensureCsrf(): Promise<void> {
    if (this.csrfToken()) return Promise.resolve();
    if (this.csrfRequest) return this.csrfRequest;

    this.csrfRequest = this.request(this.http.get<{ csrfToken: string }>("/api/v1/csrf"))
      .then(() => {
        if (!this.csrfToken()) throw new ApiRequestError("No se pudo establecer la protección CSRF", 0);
      })
      .catch((err) => {
        throw err instanceof ApiRequestError ? err : new ApiRequestError("No se pudo establecer la protección CSRF", 0);
      })
      .finally(() => {
        this.csrfRequest = undefined;
      });
    return this.csrfRequest;
  }

  private assertApiPath(path: string): void {
    if (!path.startsWith("/api/") || path.startsWith("//") || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new ApiRequestError("Ruta API no permitida", 0);
    }
  }

  private headers(needsCsrf: boolean): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (needsCsrf) {
      const csrf = this.csrfToken();
      if (csrf) h["X-CSRF-Token"] = csrf;
    }
    return h;
  }

  private errorOf(err: HttpErrorResponse): ApiRequestError {
    const body = err.error as ApiError | undefined;
    const message = typeof body?.error === "string"
      ? body.error
      : err.status === 0
        ? "No se pudo conectar con el servidor"
        : "Error del servidor";
    return new ApiRequestError(message, err.status, body?.details, retryAfterSeconds(err.headers.get("Retry-After")));
  }

  private request<T>(source: Observable<T>): Promise<T> {
    return firstValueFrom(source).catch((err: unknown) => {
      throw err instanceof HttpErrorResponse ? this.errorOf(err) : err;
    });
  }

  /** GET (safe — no CSRF header required). */
  get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    this.assertApiPath(path);
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return this.request(this.http.get<T>(path, { headers: this.headers(false), params: hp }));
  }

  /** POST (mutation — requires CSRF). */
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.assertApiPath(path);
    await this.ensureCsrf();
    return this.request(this.http.post<T>(path, body ?? {}, { headers: this.headers(true) }));
  }

  /** POST returning a private binary artifact while preserving JSON errors. */
  async postBlob(path: string, body?: unknown): Promise<Blob> {
    this.assertApiPath(path);
    await this.ensureCsrf();
    try {
      return await firstValueFrom(this.http.post(path, body ?? {}, {
        headers: this.headers(true),
        responseType: "blob",
      }));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
        try {
          const parsed = JSON.parse(await error.error.text()) as ApiError;
          throw new ApiRequestError(
            typeof parsed.error === "string" ? parsed.error : "Error del servidor",
            error.status,
            parsed.details,
            retryAfterSeconds(error.headers.get("Retry-After")),
          );
        } catch (parsedError) {
          if (parsedError instanceof ApiRequestError) throw parsedError;
        }
      }
      throw error instanceof HttpErrorResponse ? this.errorOf(error) : error;
    }
  }

  /** PATCH (mutation — requires CSRF). */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    this.assertApiPath(path);
    await this.ensureCsrf();
    return this.request(this.http.patch<T>(path, body ?? {}, { headers: this.headers(true) }));
  }

  /** DELETE (mutation — requires CSRF). */
  async delete<T>(path: string, body?: unknown): Promise<T> {
    this.assertApiPath(path);
    await this.ensureCsrf();
    return this.request(this.http.delete<T>(path, { headers: this.headers(true), body }));
  }

  /** Raw observable for callers that need streaming/loading states. */
  get$<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Observable<T> {
    this.assertApiPath(path);
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return this.http.get<T>(path, { headers: this.headers(false), params: hp }).pipe(
      catchError((err: unknown) => throwError(() => err instanceof HttpErrorResponse ? this.errorOf(err) : err)),
    );
  }
}

export { ApiRequestError as ApiError };
