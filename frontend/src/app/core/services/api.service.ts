import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse, HttpParams } from "@angular/common/http";
import { catchError, firstValueFrom, map, Observable, throwError, timeout, TimeoutError } from "rxjs";
import type { ApiError } from "../models";
import { retryAfterSeconds } from "./retry-after";

const CSRF_COOKIES = ["__Host-uvh_csrf", "uvh_csrf"] as const;

/** Value the API sends as `reason` when it rejects the double-submit token. */
const CSRF_REJECTED = "csrf_rejected";

/** Runtime contract applied before an HTTP value reaches application state. */
export type ApiDecoder<T> = (value: unknown) => T;

export interface ApiReadOptions {
  /** Abort only idempotent reads whose view/context is no longer current. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const READ_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 45_000;
const ARTIFACT_TIMEOUT_MS = 120_000;

/** Keep promise and observable reads under the same finite timeout policy. */
function boundedTimeout(requested: number | undefined, fallback: number): number {
  const value = requested ?? fallback;
  return Number.isFinite(value) ? Math.max(1_000, Math.min(ARTIFACT_TIMEOUT_MS, value)) : fallback;
}

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;
  readonly retryAfterSeconds?: number;
  /** Machine-readable discriminator the server sent, when it sent one. */
  readonly reason?: string;

  constructor(message: string, status: number, details?: unknown, retryAfterSeconds?: number, reason?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
    this.reason = reason;
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
    return this.fetchCsrf();
  }

  /**
   * Fetch the bootstrap token, coalescing concurrent calls.
   *
   * Unlike {@link ensureCsrf} this never short-circuits on a cookie that already
   * exists, which is what makes it usable to replace a token the server just
   * rejected: the endpoint always mints a new one.
   */
  private fetchCsrf(): Promise<void> {
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

  /**
   * Repeat one mutation once when the API rejected its CSRF token.
   *
   * The retry is deliberately single: a mutation is not idempotent, so a second
   * attempt could apply its effect twice. Any other rejection (authorization,
   * conflict, validation) is never repeated — 403 carries all of them, which is
   * why the decision reads the `reason` the middleware sends instead of the
   * status alone.
   */
  private async retryOnRejectedCsrf<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof ApiRequestError) || err.reason !== CSRF_REJECTED) throw err;
      try {
        await this.fetchCsrf();
        return await attempt();
      } catch (retryErr) {
        // The fresh token was rejected too: retrying again would only repeat a
        // write the server keeps refusing, so say what the user must do instead.
        throw retryErr instanceof ApiRequestError && retryErr.reason === CSRF_REJECTED
          ? new ApiRequestError("No se pudo confirmar la protección de la sesión. Recarga la página e inténtalo de nuevo.", 403)
          : retryErr;
      }
    }
  }

  /** One CSRF-protected mutation, re-issued once if its token is rejected. */
  private async mutate<T>(build: () => Observable<T>, decoder?: ApiDecoder<T>): Promise<T> {
    await this.ensureCsrf();
    return this.retryOnRejectedCsrf(() => this.request(build(), decoder, "mutation"));
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
    const serverMessage = typeof body?.error === "string" ? body.error.trim() : "";
    // Only our own JSON error envelope carries a server-written message. A proxy
    // can answer with HTML, an empty body, or — for a blob request — a Blob, and
    // collapsing every one of those into a generic sentence hid the status that
    // says which of them actually happened.
    const message = serverMessage !== ""
      ? serverMessage
      : err.status === 0
        ? "No se pudo conectar con el servidor"
        : `El servidor devolvió un error inesperado (HTTP ${err.status}). Reinténtalo en unos segundos.`;
    return new ApiRequestError(
      message,
      err.status,
      body?.details,
      retryAfterSeconds(err.headers.get("Retry-After")),
      body?.reason,
    );
  }

  private decodeResponse<T>(value: unknown, decoder?: ApiDecoder<T>): T {
    if (!decoder) return value as T;
    try {
      return decoder(value);
    } catch (error) {
      if (error instanceof ApiRequestError) throw error;
      // Do not attach the untrusted body or decoder details: either may contain
      // secrets and neither is useful to the end user.
      throw new ApiRequestError("El servidor devolvió una respuesta no válida", 502);
    }
  }

  private request<T>(
    source: Observable<T>,
    decoder?: ApiDecoder<T>,
    policy: "read" | "mutation" = "read",
    options?: ApiReadOptions,
  ): Promise<T> {
    const defaultTimeout = policy === "read" ? READ_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
    const timeoutMs = boundedTimeout(options?.timeoutMs, defaultTimeout);
    const cancellable = options?.signal ? this.cancelOnAbort(source, options.signal) : source;
    return firstValueFrom(cancellable.pipe(timeout({ first: timeoutMs })))
      .then((value) => this.decodeResponse(value, decoder)).catch((err: unknown) => {
      if (err instanceof TimeoutError) {
        const message = policy === "mutation"
          ? "No se pudo confirmar el resultado a tiempo. Comprueba el estado antes de reintentar."
          : "La lectura tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.";
        throw new ApiRequestError(message, 0, { reason: "timeout" });
      }
      throw err instanceof HttpErrorResponse ? this.errorOf(err) : err;
    });
  }

  private cancelOnAbort<T>(source: Observable<T>, signal: AbortSignal): Observable<T> {
    return new Observable<T>((subscriber) => {
      if (signal.aborted) {
        subscriber.error(new ApiRequestError("Lectura cancelada", 0, { reason: "cancelled" }));
        return;
      }
      const abort = () => subscriber.error(new ApiRequestError("Lectura cancelada", 0, { reason: "cancelled" }));
      signal.addEventListener("abort", abort, { once: true });
      const subscription = source.subscribe(subscriber);
      return () => {
        signal.removeEventListener("abort", abort);
        subscription.unsubscribe();
      };
    });
  }

  /** GET (safe — no CSRF header required). */
  get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, decoder?: ApiDecoder<T>, options?: ApiReadOptions): Promise<T> {
    this.assertApiPath(path);
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return this.request(this.http.get<T>(path, { headers: this.headers(false), params: hp }), decoder, "read", options);
  }

  /** POST (mutation — requires CSRF). `extraHeaders` carries e.g. an Idempotency-Key. */
  async post<T>(path: string, body?: unknown, decoder?: ApiDecoder<T>, extraHeaders?: Record<string, string>): Promise<T> {
    this.assertApiPath(path);
    return this.mutate(() => this.http.post<T>(path, body ?? {}, {
      headers: { ...this.headers(true), ...extraHeaders },
    }), decoder);
  }

  /** POST returning a private binary artifact while preserving JSON errors. */
  async postBlob(path: string, body?: unknown): Promise<Blob> {
    this.assertApiPath(path);
    await this.ensureCsrf();
    return this.retryOnRejectedCsrf(() => this.artifactRequest(this.http.post(path, body ?? {}, {
      headers: this.headers(true),
      responseType: "blob",
    })));
  }

  /** GET returning a private binary artifact (exports) while preserving JSON errors. */
  getBlob(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<Blob> {
    this.assertApiPath(path);
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    return this.artifactRequest(this.http.get(path, { headers: this.headers(false), params: hp, responseType: "blob" }));
  }

  /** One artifact request, translating a JSON error envelope returned as a Blob. */
  private async artifactRequest(source: Observable<Blob>): Promise<Blob> {
    try {
      return await firstValueFrom(source.pipe(timeout({ first: ARTIFACT_TIMEOUT_MS })));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
        try {
          const parsed = JSON.parse(await error.error.text()) as ApiError;
          throw new ApiRequestError(
            typeof parsed.error === "string" ? parsed.error : "Error del servidor",
            error.status,
            parsed.details,
            retryAfterSeconds(error.headers.get("Retry-After")),
            parsed.reason,
          );
        } catch (parsedError) {
          if (parsedError instanceof ApiRequestError) throw parsedError;
        }
      }
      if (error instanceof TimeoutError) {
        throw new ApiRequestError("La descarga no respondió a tiempo. Comprueba su estado antes de solicitar otra.", 0, { reason: "timeout" });
      }
      throw error instanceof HttpErrorResponse ? this.errorOf(error) : error;
    }
  }

  /** PATCH (mutation — requires CSRF). */
  async patch<T>(path: string, body?: unknown, decoder?: ApiDecoder<T>): Promise<T> {
    this.assertApiPath(path);
    return this.mutate(() => this.http.patch<T>(path, body ?? {}, { headers: this.headers(true) }), decoder);
  }

  /** DELETE (mutation — requires CSRF). */
  async delete<T>(path: string, body?: unknown, decoder?: ApiDecoder<T>): Promise<T> {
    this.assertApiPath(path);
    return this.mutate(() => this.http.delete<T>(path, { headers: this.headers(true), body }), decoder);
  }

  /** Raw observable for callers that need streaming/loading states. */
  get$<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, decoder?: ApiDecoder<T>, options?: ApiReadOptions): Observable<T> {
    this.assertApiPath(path);
    let hp = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") hp = hp.set(k, String(v));
      }
    }
    const source = this.http.get<T>(path, { headers: this.headers(false), params: hp });
    const cancellable = options?.signal ? this.cancelOnAbort(source, options.signal) : source;
    const timeoutMs = boundedTimeout(options?.timeoutMs, READ_TIMEOUT_MS);
    return cancellable.pipe(
      timeout({ first: timeoutMs }),
      map((value) => this.decodeResponse(value, decoder)),
      catchError((err: unknown) => throwError(() => err instanceof TimeoutError
        ? new ApiRequestError("La lectura tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.", 0, { reason: "timeout" })
        : err instanceof HttpErrorResponse ? this.errorOf(err) : err)),
    );
  }
}

export { ApiRequestError as ApiError };
