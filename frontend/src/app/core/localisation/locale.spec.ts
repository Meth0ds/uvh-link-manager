import { localeHref, localePath, RELEASED_LANGUAGES, routePath } from "./locale";
import { LocaleUrlSerializer } from "./locale-url-serializer";

describe("locale paths", () => {
  it("maps only known pages and retains opaque query/fragment data", () => {
    expect(localePath("/help", "es")).toBe("/es/ayuda");
    expect(localePath("/es/legal/privacidad", "en")).toBe("/en/legal/privacy");
    expect(localePath("/en/auth/verify-email#token=Opaque_Value-1", "es")).toBe("/es/auth/verify-email#token=Opaque_Value-1");
    expect(localePath("/app/links/17?q=a%20b", "en")).toBe("/en/app/links/17?q=a%20b");
    expect(localePath("/#features", "en")).toBe("/en/#features");
    expect(routePath("/es/help", "es")).toBe("/ayuda");
  });
  it("releases French together with the compiled production bundles", () => {
    expect(RELEASED_LANGUAGES).toEqual(["es", "en", "fr"]);
  });
  it("translates French routes from the same manifest without a second table", () => {
    expect(routePath("/fr/aide", "en")).toBe("/help");
    expect(localePath("/fr/aide", "es")).toBe("/es/ayuda");
    expect(localePath("/fr/help", "fr")).toBe("/fr/aide");
    expect(localePath("/en/legal/terms", "fr")).toBe("/fr/legal/conditions");
    expect(localePath("/aide", "fr")).toBe("/fr/aide");
    expect(localePath("/fr/legal/versions/2026-10-09/fr/terms.html", "en")).toBe("/fr/legal/versions/2026-10-09/fr/terms.html");
  });
  it("leaves aliases, native routes, assets, historical documents and remote URLs intact", () => {
    for (const path of ["/summer", "/r/summer", "/a/summer", "/api/v1/links", "/visitor-assets/puzzle.v1.mjs", "/legal/versions/2026-10-09/terminos.html", "https://other.test/help", "//other.test/app", "#section"]) {
      expect(localePath(path, "en")).toBe(path);
    }
  });
  it("localises absolute UI links only on trusted origins", () => {
    const origins = ["https://app.uvh.es", "https://uvh.es"];
    expect(localeHref("https://app.uvh.es/auth#token=Opaque_1", origins, "en")).toBe("https://app.uvh.es/en/auth#token=Opaque_1");
    for (const url of ["https://app.uvh.es.evil.test/auth", "https://other.test/help", "https://user@app.uvh.es/auth", "https://uvh.es/alias", "//app.uvh.es/auth"]) {
      expect(localeHref(url, origins, "en")).toBe(url);
    }
  });
  it("normalises router links and imperative public navigation through the same map", () => {
    const serializer = new LocaleUrlSerializer();
    expect(serializer.serialize(serializer.parse("/help?search=a%20b#section"))).toBe("/ayuda?search=a%20b#section");
    expect(serializer.serialize(serializer.parse("/auth/verify-email#token=Opaque_1"))).toBe("/auth/verify-email#token=Opaque_1");
  });
});
