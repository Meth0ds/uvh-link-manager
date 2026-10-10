import { csvFileCanFit, csvTextWithinLimit, MAX_CSV_IMPORT_BYTES } from "./csv-import-limits";

describe("CSV import memory and UTF-8 limits", () => {
  const cap = MAX_CSV_IMPORT_BYTES;

  for (const size of [cap - 1, cap, cap + 1, cap + 2, cap + 3]) {
    it(`allows ${size} raw bytes for bounded decoding including a possible BOM`, () => {
      expect(csvFileCanFit(size)).toBeTrue();
    });
  }

  for (const size of [cap + 4, 1024 ** 3]) {
    it(`rejects ${size} raw bytes without allocating a decoded copy`, () => {
      expect(csvFileCanFit(size)).toBeFalse();
    });
  }

  for (const payload of ["a".repeat(cap), "é".repeat(cap / 2), "€".repeat(Math.floor(cap / 3)) + "a", "😀".repeat(cap / 4)]) {
    it(`accepts the exact UTF-8 limit for ${payload.codePointAt(0)}`, () => {
      expect(new TextEncoder().encode(payload).byteLength).toBe(cap);
      expect(csvTextWithinLimit(payload)).toBeTrue();
      expect(csvTextWithinLimit(payload + "a")).toBeFalse();
    });
  }

  it("uses raw UTF-8 byte size for pasted BOM, CRLF and malformed surrogate replacement", () => {
    const samples = ["\ufeff" + "a".repeat(cap - 3), "\r\n".repeat(cap / 2), "\ud800".repeat(Math.floor(cap / 3)) + "a"];
    for (const payload of samples) {
      expect(new TextEncoder().encode(payload).byteLength).toBe(cap);
      expect(csvTextWithinLimit(payload)).toBeTrue();
      expect(csvTextWithinLimit(payload + "a")).toBeFalse();
    }
  });

  it("avoids encoding clearly small or clearly excessive strings", () => {
    const encode = spyOn(TextEncoder.prototype, "encode").and.callThrough();
    expect(csvTextWithinLimit("€".repeat(Math.floor(cap / 3)))).toBeTrue();
    expect(csvTextWithinLimit("a".repeat(cap + 1))).toBeFalse();
    expect(encode).not.toHaveBeenCalled();
  });

  it("bounds the only encoded allocation to three times the character cap", () => {
    const encode = spyOn(TextEncoder.prototype, "encode").and.callThrough();
    expect(csvTextWithinLimit("€".repeat(cap))).toBeFalse();
    expect(encode).toHaveBeenCalledOnceWith("€".repeat(cap));
    expect(encode.calls.mostRecent().returnValue.byteLength).toBe(cap * 3);
  });
});
