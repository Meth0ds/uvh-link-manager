import { decodeAccountDeletionConfirmation, decodePublicActionMessage } from "./public-action-response-decoders";
import { decodePublicConfig } from "./public-response-decoders";

describe("public response decoders", () => {
  const config = {
    appUrl: "https://app.example.test",
    publicHost: "example.test",
    appHost: "app.example.test",
    hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001" },
  };

  it("reconstructs the public configuration projection", () => {
    expect(decodePublicConfig({ ...config, accidentalSecret: "must-not-propagate" })).toEqual(config);
  });

  it("fails closed for inconsistent captcha and unsafe app URLs", () => {
    expect(() => decodePublicConfig({ ...config, hcaptcha: { enabled: true, siteKey: null } })).toThrow();
    expect(() => decodePublicConfig({ ...config, appUrl: "javascript:alert(1)" })).toThrow();
    expect(() => decodePublicConfig({ ...config, appUrl: "https://user:password@app.example.test" })).toThrow();
  });

  it("decodes public action results and scheduled deletion dates", () => {
    expect(decodePublicActionMessage({ ok: true, message: "Confirmed" })).toEqual({ ok: true, message: "Confirmed" });
    expect(decodeAccountDeletionConfirmation({ ok: true, executeAfter: "2026-10-01T00:00:00Z" }).ok).toBeTrue();
    expect(() => decodePublicActionMessage({ ok: false, message: "No" })).toThrow();
    expect(() => decodeAccountDeletionConfirmation({ ok: true, executeAfter: "not-a-date" })).toThrow();
  });
});

