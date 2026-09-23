import { dateTimeLabel, dateTimeMediumLabel } from "./date-time-label";

describe("dateTimeLabel", () => {
  it("prints the ISO 8601 the API shapes itself", () => {
    const label = dateTimeLabel("2026-09-21T21:58:25Z");

    expect(label).not.toBe("—");
    expect(label).toContain("2026");
  });

  it("prints PostgreSQL's own timestamp, whose offset carries no minutes", () => {
    // The raw rows the console reads hand this shape over, and every engine
    // refuses it unless the space and the short offset are normalised.
    const label = dateTimeLabel("2026-09-21 23:38:16+00");

    expect(label).not.toBe("—");
    expect(label).toContain("2026");
  });

  it("keeps a full offset intact", () => {
    expect(dateTimeLabel("2026-09-21T23:38:16+00:00")).not.toBe("—");
    expect(dateTimeLabel("2026-09-21T23:38:16-05:00")).not.toBe("—");
  });

  it("says nothing rather than inventing a moment it cannot read", () => {
    expect(dateTimeLabel("no es una fecha")).toBe("—");
    expect(dateTimeLabel("")).toBe("—");
  });
});

describe("dateTimeMediumLabel", () => {
  it("prints the reading the account and security screens use", () => {
    const label = dateTimeMediumLabel("2026-09-21T23:38:16Z");

    // El mes se escribe con letra y sin segundos: es la lectura propia de esas
    // pantallas, distinta de la numérica de la consola.
    expect(label).toContain("sept");
    expect(label).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("reads PostgreSQL's own timestamp the same as the ISO one", () => {
    expect(dateTimeMediumLabel("2026-09-21 23:38:16+00")).toBe(dateTimeMediumLabel("2026-09-21T23:38:16+00:00"));
  });

  it("uses the caller's text for a gap, because the date does not decide it", () => {
    expect(dateTimeMediumLabel(null, "Sin registro disponible")).toBe("Sin registro disponible");
    expect(dateTimeMediumLabel("", "Todavía no disponible")).toBe("Todavía no disponible");
    expect(dateTimeMediumLabel(null)).toBe("—");
  });
});
