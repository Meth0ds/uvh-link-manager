import { TestBed } from "@angular/core/testing";
import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { firstValueFrom, of, throwError } from "rxjs";
import { ApiRequestError, ApiService } from "./api.service";

describe("ApiService retry advice", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let api: ApiService;

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    api = TestBed.inject(ApiService);
  });

  function rateLimited(error: unknown = { error: "Espera", details: { reason: "limited" } }): HttpErrorResponse {
    return new HttpErrorResponse({ status: 429, error, headers: new HttpHeaders({ "Retry-After": "60" }) });
  }

  it("preserves advice, status and details in promise requests", async () => {
    http.get.and.returnValue(throwError(() => rateLimited()));
    await expectAsync(api.get("/api/v1/example")).toBeRejectedWith(jasmine.objectContaining({
      name: "ApiRequestError", status: 429, message: "Espera", retryAfterSeconds: 60, details: { reason: "limited" },
    }));
  });

  it("preserves advice in observable requests", async () => {
    http.get.and.returnValue(throwError(() => rateLimited()));
    await expectAsync(firstValueFrom(api.get$("/api/v1/example"))).toBeRejectedWith(
      jasmine.objectContaining({ retryAfterSeconds: 60, status: 429 }),
    );
  });

  it("preserves advice when an artifact request receives a JSON blob error", async () => {
    // No cookie writes, network, CSRF request or binary download in this fixture.
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    http.post.and.returnValue(throwError(() => rateLimited(new Blob(['{"error":"Espera"}']))));
    await expectAsync(api.postBlob("/api/v1/example")).toBeRejectedWith(
      jasmine.objectContaining({ message: "Espera", retryAfterSeconds: 60, status: 429 }),
    );
  });

  it("keeps connection failures usable without inventing retry advice", async () => {
    http.get.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await expectAsync(api.get("/api/v1/example")).toBeRejectedWith(
      new ApiRequestError("No se pudo conectar con el servidor", 0),
    );
  });

  it("rejects an invalid decoded response without exposing its body or decoder error", async () => {
    http.get.and.returnValue(of({ accessToken: "must-not-leak" }));
    const decoder = (): never => { throw new Error("decoder detail must-not-leak"); };

    await expectAsync(api.get("/api/v1/auth/me", undefined, decoder)).toBeRejectedWith(
      new ApiRequestError("El servidor devolvió una respuesta no válida", 502),
    );
  });

  it("publishes only the value returned by a runtime decoder", async () => {
    http.get.and.returnValue(of({ id: 7, ignored: "server-only" }));
    const value = await api.get("/api/v1/example", undefined, (source) => ({
      id: (source as { id: number }).id,
    }));

    expect(value).toEqual({ id: 7 });
  });
});
