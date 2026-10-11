import { decodeLinkName } from "./link-name-decoder";

describe("Internal link names", () => {
  it("accepts absent legacy names and explicit null", () => { expect(decodeLinkName(undefined)).toBeNull(); expect(decodeLinkName(null)).toBeNull(); });
  it("counts Unicode characters and treats markup only as text", () => {
    expect(decodeLinkName("é".repeat(120))).toBe("é".repeat(120));
    expect(decodeLinkName("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
    for (const value of ["é".repeat(121), 42, "hidden\u202e", "line\nline", "", "   name   "]) expect(() => decodeLinkName(value)).toThrow();
  });
});
