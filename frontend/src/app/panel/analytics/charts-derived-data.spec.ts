import { TestBed } from "@angular/core/testing";
import { ChartsComponent } from "./charts.component";
import type { AnalyticsOverview } from "../../core/models";

const overview = (): AnalyticsOverview => ({
  totals: { clicks: 12, visitors: 4 }, visitorMetric: "daily_pseudonyms", series: [], topLinks: [],
  countries: [{ key: "España", value: 12 }, { key: "Alemania", value: 0 }],
  devices: [{ key: "Móvil", value: 5 }], browsers: [{ key: "Firefox", value: 8 }],
  os: [{ key: "Linux", value: 9 }], referrers: [{ key: "example.test", value: 3 }], campaigns: [{ key: "campaña", value: 7 }],
  dimensionTotals: { countries: 2, devices: 1, browsers: 1, os: 1, referrers: 1, campaigns: 1 },
});

describe("Charts derived data", () => {
  it("does not rescan the same snapshot for every bar and repeated render", () => {
    const fixture = TestBed.createComponent(ChartsComponent), data = overview();
    let maximumReads = 0;
    data.countries = [{ key: "España", get value() { maximumReads++; return 12; } }];
    fixture.componentRef.setInput("overview", data);
    expect(fixture.componentInstance.breakdown("countries").max).toBe(12);
    const readsAfterFirstDerivation = maximumReads;
    for (let i = 0; i < 50; i++) expect(fixture.componentInstance.breakdown("countries").max).toBe(12);
    expect(maximumReads).toBe(readsAfterFirstDerivation);
    fixture.destroy();
  });

  it("keeps every dimension, zero bar and fresh input correct in the rendered chart", () => {
    const fixture = TestBed.createComponent(ChartsComponent), data = overview();
    fixture.componentRef.setInput("overview", data); fixture.detectChanges();
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(".breakdown h3")).map(el => el.textContent)).toEqual([
      "Países", "Dispositivos", "Navegadores", "Sistemas", "Referentes", "Campañas",
    ]);
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.breakdown .bar-row:nth-child(2) .bar-fill')?.style.width).toBe("0%");
    for (const key of fixture.componentInstance.breakdownKeys) expect(fixture.componentInstance.breakdown(key).items).toBe(data[key]);
    const next = { ...data, countries: [{ key: "España", value: 3 }, { key: "Alemania", value: 6 }] };
    fixture.componentRef.setInput("overview", next); fixture.detectChanges();
    expect(fixture.componentInstance.breakdown("countries").max).toBe(6);
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.breakdown .bar-fill')?.style.width).toBe("50%");
    fixture.componentRef.setInput("showBreakdowns", false); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.breakdowns')).toBeNull();
    fixture.destroy();
  });
});
