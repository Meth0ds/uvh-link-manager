import {
  decodeBulkActionResponse,
  decodeCollectionDeleteResponse,
  decodeCollectionsResponse,
  decodeImportReport,
  decodeTagMergeResponse,
  decodeTagRenameResponse,
  decodeTagsResponse,
  decodeTemplateResponse,
  decodeTemplatesResponse,
} from "./scale-response-decoders";

describe("scale response decoders", () => {
  it("decodes tags with live counts and refuses duplicated names", () => {
    const decoded = decodeTagsResponse({
      tags: [
        { id: 1, name: "prensa", links: 3 },
        { id: 2, name: "2026", links: 0 },
      ],
    });
    expect(decoded.tags).toEqual([
      { id: 1, name: "prensa", links: 3 },
      { id: 2, name: "2026", links: 0 },
    ]);
    expect(() => decodeTagsResponse({
      tags: [
        { id: 1, name: "Prensa", links: 1 },
        { id: 2, name: "prensa", links: 1 },
      ],
    })).toThrow();
    expect(() => decodeTagsResponse({ tags: [{ id: 1, name: "", links: 0 }] })).toThrow();
  });

  it("decodes rename and merge results", () => {
    expect(decodeTagRenameResponse({ ok: true, id: 4, name: "Prensa 2026" }))
      .toEqual({ ok: true, id: 4, name: "Prensa 2026" });
    expect(decodeTagMergeResponse({ ok: true, id: 4, name: "Prensa 2026", moved: 2 }))
      .toEqual({ ok: true, id: 4, name: "Prensa 2026", moved: 2 });
    expect(() => decodeTagRenameResponse({ ok: true, id: 4 })).toThrow();
  });

  it("decodes collections and their delete result", () => {
    const decoded = decodeCollectionsResponse({
      collections: [{ id: 1, name: "Campaña navidad", links: 5 }],
    });
    expect(decoded.collections).toEqual([{ id: 1, name: "Campaña navidad", links: 5 }]);
    expect(decodeCollectionDeleteResponse({ ok: true, moved: 2 })).toEqual({ ok: true, moved: 2 });
    expect(() => decodeCollectionsResponse({ collections: [{ id: 1, name: "x", links: -1 }] })).toThrow();
  });

  it("decodes templates keeping the snake_case link-create contract", () => {
    const decoded = decodeTemplatesResponse({
      templates: [{
        id: 1,
        name: "Oferta",
        payload: {
          destination: "https://example.test/oferta",
          fallback_destination: null,
          notes: "Equipo",
          tags: ["prensa"],
          utm: { source: "newsletter", medium: null, campaign: null, term: null, content: null },
          max_clicks: 10,
          single_use: true,
          scheduled_at: null,
          expires_at: "2026-12-31T23:59:00Z",
          collection_id: 3,
          unknown_future_key: "ignored",
        },
        createdAt: "2026-09-26T10:00:00Z",
      }],
    });
    expect(decoded.templates[0].payload).toEqual({
      destination: "https://example.test/oferta",
      fallback_destination: null,
      notes: "Equipo",
      tags: ["prensa"],
      utm: { source: "newsletter", medium: null, campaign: null, term: null, content: null },
      max_clicks: 10,
      single_use: true,
      scheduled_at: null,
      expires_at: "2026-12-31T23:59:00Z",
      collection_id: 3,
    });
    // A payload that would poison the create form is refused as a whole.
    expect(() => decodeTemplateResponse({
      template: { id: 1, name: "Mala", payload: { destination: "javascript:alert(1)" }, createdAt: "2026-09-26T10:00:00Z" },
    })).toThrow();
  });

  it("decodes bulk results and import reports", () => {
    expect(decodeBulkActionResponse({ ok: true, action: "trash", applied: 4 }))
      .toEqual({ ok: true, action: "trash", applied: 4 });
    expect(() => decodeBulkActionResponse({ ok: true, action: "drop_table", applied: 1 })).toThrow();

    const report = decodeImportReport({
      dryRun: true,
      valid: 8,
      created: 0,
      errors: [{ row: 3, error: "Alias inválido" }, { row: 4, error: "Destino obligatorio" }],
      truncated: false,
    });
    expect(report.errors).toEqual([
      { row: 3, error: "Alias inválido" },
      { row: 4, error: "Destino obligatorio" },
    ]);
    expect(report.valid).toBe(8);
    expect(() => decodeImportReport({
      dryRun: false,
      valid: 1,
      created: 1,
      errors: Array.from({ length: 101 }, (_, i) => ({ row: i + 2, error: "x" })),
      truncated: true,
    })).toThrow();
  });
});
