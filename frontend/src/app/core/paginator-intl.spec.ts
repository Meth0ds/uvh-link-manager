import { SpanishPaginatorIntl } from "./paginator-intl";

describe("SpanishPaginatorIntl", () => {
  const intl = new SpanishPaginatorIntl();

  it("translates every label Material owns", () => {
    expect(intl.itemsPerPageLabel).toBe("Elementos por página:");
    expect(intl.nextPageLabel).toBe("Página siguiente");
    expect(intl.previousPageLabel).toBe("Página anterior");
    expect(intl.firstPageLabel).toBe("Primera página");
    expect(intl.lastPageLabel).toBe("Última página");
  });

  it("writes the visible range in Spanish", () => {
    expect(intl.getRangeLabel(0, 50, 37)).toBe("1 – 37 de 37");
    expect(intl.getRangeLabel(1, 10, 25)).toBe("11 – 20 de 25");
    expect(intl.getRangeLabel(2, 10, 25)).toBe("21 – 25 de 25");
  });

  it("describes an empty result without dividing by the page size", () => {
    expect(intl.getRangeLabel(0, 10, 0)).toBe("0 de 0");
    expect(intl.getRangeLabel(0, 0, 25)).toBe("0 de 25");
  });
});
