import { decodeAccountDeletionConfirmation, decodePublicActionMessage } from "./public-action-response-decoders";
import { decodePublicConfig } from "./public-response-decoders";

describe("public response decoders", () => {
  const config = {
    appUrl: "https://app.example.test",
    publicHost: "example.test",
    appHost: "app.example.test",
    legalIdentity: null,
    hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001", developmentFallback: false },
  };

  it("reconstructs the public configuration projection", () => {
    expect(decodePublicConfig({ ...config, accidentalSecret: "must-not-propagate" })).toEqual(config);
  });

  it("fails closed for inconsistent captcha and unsafe app URLs", () => {
    expect(() => decodePublicConfig({ ...config, hcaptcha: { enabled: true, siteKey: null } })).toThrow();
    expect(() => decodePublicConfig({ ...config, appUrl: "javascript:alert(1)" })).toThrow();
    expect(() => decodePublicConfig({ ...config, appUrl: "https://user:password@app.example.test" })).toThrow();
  });

  it("defaults the development exception to false and rejects coercion", () => {
    const legacy = { ...config, hcaptcha: { enabled: true, siteKey: config.hcaptcha.siteKey } };
    expect(decodePublicConfig(legacy).hcaptcha.developmentFallback).toBeFalse();
    expect(() => decodePublicConfig({ ...config, hcaptcha: { ...config.hcaptcha, developmentFallback: "true" } })).toThrow();
    expect(decodePublicConfig({ ...config, hcaptcha: { enabled: false, siteKey: null, developmentFallback: true } }).hcaptcha.developmentFallback).toBeTrue();
  });

  it("accepts only a complete bounded public legal identity", () => {
    const legalIdentity = {
      name: "UVH Servicios Digitales SL",
      taxId: "B12345678",
      address: "Calle de prueba 1, Madrid",
      registry: "Registro Mercantil de Madrid, tomo 1",
      hostingProvider: "Proveedor de infraestructura SL",
      hostingRegion: "España, Unión Europea",
    };
    expect(decodePublicConfig({ ...config, legalIdentity }).legalIdentity).toEqual(legalIdentity);
    expect(() => decodePublicConfig({ ...config, legalIdentity: { ...legalIdentity, taxId: undefined } })).toThrow();
  });

  it("decodes public action results and scheduled deletion dates", () => {
    expect(decodePublicActionMessage({ ok: true, message: "Confirmed" })).toEqual({ ok: true, message: "Confirmed" });
    expect(decodeAccountDeletionConfirmation({ ok: true, executeAfter: "2026-10-01T00:00:00Z" }).ok).toBeTrue();
    expect(() => decodePublicActionMessage({ ok: false, message: "No" })).toThrow();
    expect(() => decodeAccountDeletionConfirmation({ ok: true, executeAfter: "not-a-date" })).toThrow();
  });
});
