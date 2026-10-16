import { decodeDomainDeletionPreview, decodeDomainReassignmentPreview, decodeDomainReassignmentResult } from "./domain-management-decoders";

function impact() { return { domainId: 7, domain: "go.example.test", isDefault: false, liveLinks: 1, trashedLinks: 1, blockedLinks: 0, totalLinks: 2, canDelete: false }; }
function preview() {
  return { domainId: 7, targetDomainId: null, canApply: true, links: [
    { linkId: 11, version: 2, alias: "promo", oldUrl: "https://go.example.test/promo", newUrl: "https://uvh.es/promo", state: "deleted", inTrash: true, deletedAt: "2026-10-01T10:00:00Z", purgeAt: "2026-10-31T10:00:00Z", conflict: null },
  ] };
}

describe("Domain management response contracts", () => {
  it("accepts consistent impact and rejects misleading deletion eligibility", () => {
    expect(decodeDomainDeletionPreview(impact(), 7).totalLinks).toBe(2);
    for (const change of [{ domainId: 8 }, { totalLinks: 0 }, { canDelete: true }, { blockedLinks: 3 }, { liveLinks: "1" }]) {
      expect(() => decodeDomainDeletionPreview({ ...impact(), ...change }, 7)).toThrow();
    }
  });

  it("accepts a scoped review with trash retention", () => {
    expect(decodeDomainReassignmentPreview(preview(), 7, null, [11]).links[0].inTrash).toBeTrue();
  });

  it("rejects another source, target, selection or duplicate row", () => {
    for (const change of [{ domainId: 8 }, { targetDomainId: 9 }, { links: [] }, { links: [preview().links[0], preview().links[0]] }]) {
      expect(() => decodeDomainReassignmentPreview({ ...preview(), ...change }, 7, null, [11])).toThrow();
    }
  });

  it("rejects unsafe URLs, inconsistent state, purge dates and conflict flags", () => {
    for (const change of [{ newUrl: "javascript:alert(1)" }, { oldUrl: "https://secret@example.com/x" }, { inTrash: false }, { state: "active" }, { purgeAt: null }, { deletedAt: "broken" }, { purgeAt: "2026-09-01T00:00:00Z" }, { conflict: "alias_conflict" }, { version: 0 }]) {
      expect(() => decodeDomainReassignmentPreview({ ...preview(), links: [{ ...preview().links[0], ...change }] }, 7, null, [11])).toThrow();
    }
  });

  it("requires an exact acknowledgement of the reviewed selection", () => {
    const reviewed = decodeDomainReassignmentPreview(preview(), 7, null, [11]);
    const ack = { ok: true, applied: 1, domainId: 7, targetDomainId: null, linkIds: [11] };
    expect(decodeDomainReassignmentResult(ack, reviewed).applied).toBe(1);
    for (const change of [{ ok: false }, { applied: 2 }, { linkIds: [12] }, { targetDomainId: 8 }]) {
      expect(() => decodeDomainReassignmentResult({ ...ack, ...change }, reviewed)).toThrow();
    }
  });
});
