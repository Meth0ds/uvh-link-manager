import {
  decodeAppOpening,
  decodeAppProfileResponse,
  recommendedLinkUrl,
} from "./app-opening";

describe("App opening contracts", () => {
  it("keeps old links compatible and prefers an explicit sharing address", () => {
    expect(recommendedLinkUrl({ shortUrl: "https://uvh.es/old" })).toBe(
      "https://uvh.es/old",
    );
    expect(
      recommendedLinkUrl({
        shortUrl: "https://example.org/old",
        shareUrl: "https://example.org/a/old",
      }),
    ).toBe("https://example.org/a/old");
    expect(decodeAppOpening(null)).toBeNull();
    expect(() =>
      decodeAppOpening({
        version: 1,
        kind: "native",
        profileId: "------------------------------------",
        route: "/productos/1",
      }),
    ).toThrow();
  });
  it("rejects untrusted schemes, provider hosts and native routes", () => {
    for (const url of [
      "intent://x",
      "https://evil.test/track/x",
      "https://user@open.spotify.com/track/x",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        decodeAppOpening({
          version: 1,
          kind: "provider",
          provider: "spotify",
          url,
        }),
      ).toThrow();
    }
    for (const route of [
      "//evil.test",
      "/products/../admin",
      "/products/%2e%2e",
      "/products/1?admin=true",
    ]) {
      expect(() =>
        decodeAppOpening({
          version: 1,
          kind: "native",
          profileId: "aaaa1111-1111-4111-8111-111111111111",
          route,
        }),
      ).toThrow();
    }
  });
  it("decodes bounded profile data and refuses unsupported versions", () => {
    const profile = {
      id: "aaaa1111-1111-4111-8111-111111111111",
      version: 1,
      name: "Mi app",
      enabled: true,
      iosAppId: "ABCDE12345.es.empresa.app",
      androidPackage: null,
      androidFingerprints: [],
      routePrefixes: ["/productos/"],
    };
    expect(
      decodeAppProfileResponse({ profile, domainReady: true }).profile?.name,
    ).toBe("Mi app");
    expect(() =>
      decodeAppProfileResponse({
        profile: { ...profile, routePrefixes: Array(21).fill("/productos/") },
        domainReady: true,
      }),
    ).toThrow();
    expect(() =>
      decodeAppOpening({
        version: 2,
        kind: "provider",
        provider: "spotify",
        url: "https://open.spotify.com/track/x",
      }),
    ).toThrow();
  });
});
