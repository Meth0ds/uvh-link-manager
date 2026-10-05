import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError } from "./api.service";
import { AuthService } from "./auth.service";
import { decodeMfaSetup } from "./auth-response-decoders";

// Public RFC fixture, matched against the actual pure PHP emitter in O34.
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const other = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const uri = (account = "user@example.test", key = secret): string => `otpauth://totp/${encodeURIComponent(`UVH:${account}`)}?secret=${key}&issuer=UVH&algorithm=SHA1&digits=6&period=30`;
const valid = { secret, uri: uri() };
function parameter(name: string, value?: string): string {
  const parsed = new URL(valid.uri);
  if (value === undefined) parsed.searchParams.delete(name);
  else parsed.searchParams.set(name, value);
  return parsed.href;
}

const rejected: { name: string; payload: unknown }[] = [
  { name: "different manual and QR keys", payload: { secret, uri: uri("user@example.test", other) } },
  { name: "short coherent key", payload: { secret: "BASE32", uri: uri("user@example.test", "BASE32") } },
  { name: "long coherent key", payload: { secret: secret + secret, uri: uri("user@example.test", secret + secret) } },
  { name: "non Base32 coherent key", payload: { secret: secret.replace("O", "0"), uri: uri("user@example.test", secret.replace("O", "0")) } },
  { name: "lowercase coherent key", payload: { secret: secret.toLowerCase(), uri: uri("user@example.test", secret.toLowerCase()) } },
  { name: "missing manual key", payload: { uri: valid.uri } },
  { name: "manual key array", payload: { secret: [secret], uri: valid.uri } },
  { name: "URI object", payload: { secret, uri: { value: valid.uri } } },
  { name: "scheme HTTPS", payload: { secret, uri: valid.uri.replace("otpauth:", "https:") } },
  { name: "unlabelled account", payload: { secret, uri: uri("") } },
  { name: "wrong label issuer", payload: { secret, uri: valid.uri.replace("UVH%3A", "Other%3A") } },
  { name: "unlabelled path", payload: { secret, uri: valid.uri.replace("UVH%3Auser%40example.test", "") } },
  { name: "second raw path segment", payload: { secret, uri: valid.uri.replace("UVH%3A", "wrong/UVH%3A") } },
  { name: "normalized traversal path", payload: { secret, uri: valid.uri.replace("UVH%3A", "wrong/../UVH%3A") } },
  { name: "malformed escaped label", payload: { secret, uri: valid.uri.replace("UVH%3Auser%40example.test", "UVH%3A%FF") } },
  { name: "decoded control in label", payload: { secret, uri: valid.uri.replace("user%40", "user%00%40") } },
  { name: "raw label whitespace", payload: { secret, uri: valid.uri.replace("user%40", "user %40") } },
  { name: "raw URI control", payload: { secret, uri: valid.uri.replace("issuer", "is\nsuer") } },
  { name: "URI fragment", payload: { secret, uri: valid.uri + "#preview-only" } },
  { name: "empty URI fragment", payload: { secret, uri: valid.uri + "#" } },
  { name: "port", payload: { secret, uri: valid.uri.replace("totp/", "totp:443/") } },
  { name: "user info", payload: { secret, uri: valid.uri.replace("totp/", "user@totp/") } },
  { name: "wrong authority", payload: { secret, uri: valid.uri.replace("totp/", "hotp/") } },
  { name: "unknown QR parameter", payload: { secret, uri: valid.uri + "&image=https%3A%2F%2Fexample.test%2Fimage" } },
  { name: "empty QR parameter", payload: { secret, uri: valid.uri + "&extra=" } },
  { name: "null payload", payload: null },
];
for (const name of ["secret", "issuer", "algorithm", "digits", "period"]) {
  rejected.push({ name: `missing ${name}`, payload: { secret, uri: parameter(name) } });
  rejected.push({ name: `duplicate ${name}`, payload: { secret, uri: valid.uri + `&${name}=different` } });
}
for (const [name, value] of [["issuer", "Other"], ["algorithm", "SHA256"], ["digits", "8"], ["period", "60"]]) {
  rejected.push({ name: `incompatible ${name}`, payload: { secret, uri: parameter(name, value) } });
}

describe("MFA setup instructions match the UVH emitter", () => {
  for (const account of ["user@example.test", "ops+one/#tag@example.test", "málaga@example.test"]) {
    it(`preserves the emitter payload for ${account}`, () => {
      const payload = { secret, uri: uri(account) };
      expect(decodeMfaSetup(payload)).toEqual(payload);
    });
  }
  it("allows query reordering without rewriting the original QR payload", () => {
    const payload = { secret, uri: `otpauth://totp/UVH%3Auser%40example.test?period=30&digits=6&issuer=UVH&algorithm=SHA1&secret=${secret}` };
    expect(decodeMfaSetup(payload)).toEqual(payload);
  });
  it("allows an equivalent escaped query key without allowing duplicates", () => {
    const payload = { secret, uri: valid.uri.replace("?secret=", "?%73ecret=") };
    expect(decodeMfaSetup(payload)).toEqual(payload);
    expect(() => decodeMfaSetup({ secret, uri: payload.uri + `&secret=${other}` })).toThrow();
  });
  for (const test of rejected) {
    it(`rejects ${test.name} before presenting configuration instructions`, () => {
      expect(() => decodeMfaSetup(test.payload)).toThrow();
    });
  }
});

describe("MFA setup transport rejects unconfirmed instructions", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  for (const replacement of [false, true]) {
    it(`rejects inconsistent ${replacement ? "replacement" : "initial"} instructions without claiming a confirmed write`, fakeAsync(() => {
      const user: AuthUser = { id: 1, email: "user@example.test", name: "Fixture", isAdmin: false, emailVerified: true, mfaEnabled: replacement, recoveryCodesRemaining: replacement ? 10 : 0 };
      auth.user.set(user);
      let error: unknown;
      let result: unknown;
      void auth.mfaSetup("fixture", replacement ? "123456" : undefined).then((value) => { result = value; }, (reason: unknown) => { error = reason; });
      flushMicrotasks();
      const request = http.expectOne("/api/v1/auth/mfa/setup");
      expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
      request.flush({ secret, uri: uri("user@example.test", other) });
      flushMicrotasks();
      expect(result).toBeUndefined();
      expect(error).toEqual(jasmine.any(ApiRequestError));
      expect((error as ApiRequestError).status).toBe(502);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(other);
      expect(auth.user()).toEqual(user);
      expect(auth.userRefreshRequired()).toBe(replacement);
      expect(auth.userMutationUnconfirmed()).toBe(replacement);
      expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse();
      http.expectNone((r) => r.method === "POST");
      http.expectNone("/api/v1/auth/me");
    }));
  }
});
