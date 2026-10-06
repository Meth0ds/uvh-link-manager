import { decodeBulkActionResponse } from "./scale-response-decoders";

describe("Bulk domain response contract", () => {
  it("accepts the successful set-domain response returned by the bulk controller", () => {
    const response = { ok: true, action: "set-domain", applied: 1 } as const;
    expect(decodeBulkActionResponse(response)).toEqual(response);
  });

  it("preserves the existing bulk action contracts", () => {
    for (const action of ["pause", "activate", "archive", "trash", "restore", "tag", "untag", "move"] as const) {
      expect(decodeBulkActionResponse({ ok: true, action, applied: 0 })).toEqual({ ok: true, action, applied: 0 });
    }
  });

  it("continues to reject unknown actions and invalid counts", () => {
    for (const response of [
      { ok: true, action: "unknown", applied: 1 },
      { ok: true, action: "move", applied: -1 },
      { ok: true, action: "move", applied: 1.5 },
      { ok: true, action: "move", applied: "1" },
    ]) expect(() => decodeBulkActionResponse(response)).toThrow();
  });
});
