import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import type { AnalyticsOverview } from "../../core/models";
import { ChartsComponent } from "./charts.component";

function fixtureOverview(days: number): AnalyticsOverview {
  const series = Array.from({ length: days }, (_, index) => ({
    day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    clicks: 50 + index % 40, visitors: 20,
  }));
  const clicks = series.reduce((sum, row) => sum + row.clicks, 0);
  const items = () => days ? Array.from({ length: 8 }, (_, index) => ({
    key: `Categoría ${index + 1}`, value: Math.floor(clicks / (index + 8)),
  })) : [];
  return {
    totals: { clicks, visitors: days * 20 }, visitorMetric: "daily_pseudonyms", series, topLinks: [],
    countries: items(), devices: items(), browsers: items(), os: items(), referrers: items(), campaigns: items(),
    dimensionTotals: { countries: days ? 8 : 0, devices: days ? 8 : 0, browsers: days ? 8 : 0,
      os: days ? 8 : 0, referrers: days ? 8 : 0, campaigns: days ? 8 : 0 },
  };
}

@Component({
  selector: "app-chart-render-probe", standalone: true, imports: [ChartsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<span class="unrelated">{{ unrelated() }}</span>
    <app-charts [overview]="data()" [showBreakdowns]="show()" />
    @if (second()) { <app-charts [overview]="other()" /> }`,
})
class ChartRenderProbe {
  readonly unrelated = signal(0);
  readonly data = signal(fixtureOverview(180));
  readonly show = signal(true);
  readonly second = signal(false);
  readonly other = signal(fixtureOverview(1));
}

/** Preserve rendered attributes/geometry/text, ignoring compiler bookkeeping. */
function renderedSnapshot(element: HTMLElement): string {
  return element.innerHTML.replace(/<!--.*?-->/gs, "")
    .replace(/\s_ngcontent-[\w-]+=""/g, "");
}

describe("Charts render boundary", () => {
  for (const days of [0, 1, 180]) {
    it(`skips unrelated parent updates with an unchanged ${days}-day snapshot`, () => {
      const fixture = TestBed.createComponent(ChartRenderProbe);
      fixture.componentInstance.data.set(fixtureOverview(days));
      fixture.detectChanges();
      const debug = fixture.debugElement.query(By.directive(ChartsComponent));
      const chart = debug.componentInstance as ChartsComponent;
      const element = debug.nativeElement as HTMLElement;
      const before = renderedSnapshot(element);
      const format = spyOn(chart, "formatCount").and.callThrough();
      const date = spyOn(chart, "dayLabel").and.callThrough();
      const percentage = spyOn(chart, "pct").and.callThrough();
      for (let index = 1; index <= 40; index++) {
        fixture.componentInstance.unrelated.set(index);
        fixture.detectChanges();
      }
      const calls = { formatCount: format.calls.count(), dayLabel: date.calls.count(), pct: percentage.calls.count() };
      // The owned Karma reporter retains actual calls and DOM for a paired
      // before/after capture; this does not measure wall time or CPU.
      console.info("O101_RENDER_CAPTURE " + JSON.stringify({ days, parentUpdates: 40, calls, before, after: renderedSnapshot(element) }));
      expect(element.querySelectorAll("tbody tr").length).toBe(days);
      expect(renderedSnapshot(element)).toBe(before);
      expect(fixture.nativeElement.querySelector(".unrelated").textContent).toBe("40");
      expect(calls).toEqual({ formatCount: 0, dayLabel: 0, pct: 0 });
      fixture.destroy();
    });
  }

  it("updates totals, geometry, daily rows and bars when its parent replaces the snapshot", () => {
    const fixture = TestBed.createComponent(ChartRenderProbe);
    fixture.componentInstance.data.set(fixtureOverview(1)); fixture.detectChanges();
    const element = fixture.nativeElement.querySelector("app-charts") as HTMLElement;
    expect(element.querySelector("circle")?.getAttribute("cx")).toBe("360");
    const oldPath = element.querySelector("path")?.getAttribute("d");
    const next = fixtureOverview(3);
    next.countries = [{ key: "España", value: 10 }, { key: "Alemania", value: 20 }];
    next.dimensionTotals.countries = 2;
    fixture.componentInstance.data.set(next); fixture.detectChanges();
    expect(element.querySelector("circle")).toBeNull();
    expect(element.querySelector("path")?.getAttribute("d")).not.toBe(oldPath);
    expect(element.querySelectorAll("tbody tr").length).toBe(3);
    expect(element.querySelector(".chart-summary")?.textContent).toContain("153 clics");
    expect(element.querySelector<HTMLElement>(".breakdown .bar-fill")?.style.width).toBe("50%");
    fixture.componentInstance.data.set(fixtureOverview(0)); fixture.detectChanges();
    expect(element.querySelector("svg")).toBeNull();
    expect(element.querySelector("table")).toBeNull();
    expect(element.querySelector(".no-data")).not.toBeNull();
    expect(element.querySelector(".breakdowns-empty")?.getAttribute("role")).toBe("status");
    fixture.destroy();
  });

  it("reacts to breakdown visibility without removing the daily table", () => {
    const fixture = TestBed.createComponent(ChartRenderProbe); fixture.detectChanges();
    const element = fixture.nativeElement.querySelector("app-charts") as HTMLElement;
    expect(element.querySelectorAll(".breakdown").length).toBe(6);
    const table = element.querySelector("table");
    fixture.componentInstance.show.set(false); fixture.detectChanges();
    expect(element.querySelector(".breakdowns")).toBeNull();
    expect(element.querySelector(".chart-insights")).toBeNull();
    expect(element.querySelector("table")).toBe(table);
    fixture.componentInstance.show.set(true); fixture.detectChanges();
    expect(element.querySelectorAll(".breakdown").length).toBe(6);
    expect(element.querySelector(".chart-insights")).not.toBeNull();
    fixture.destroy();
  });

  it("keeps independent chart inputs independent on the same screen", () => {
    const fixture = TestBed.createComponent(ChartRenderProbe);
    fixture.componentInstance.data.set(fixtureOverview(3)); fixture.componentInstance.second.set(true);
    fixture.detectChanges();
    const children = fixture.debugElement.queryAll(By.directive(ChartsComponent));
    const first = children[0].nativeElement as HTMLElement;
    const before = renderedSnapshot(first);
    const format = spyOn(children[0].componentInstance as ChartsComponent, "formatCount").and.callThrough();
    fixture.componentInstance.other.set(fixtureOverview(2)); fixture.detectChanges();
    expect(renderedSnapshot(first)).toBe(before);
    expect(format).not.toHaveBeenCalled();
    expect((children[1].nativeElement as HTMLElement).querySelectorAll("tbody tr").length).toBe(2);
    fixture.destroy();
  });

  it("preserves an open native disclosure and tracked rows through parent and snapshot updates", () => {
    const fixture = TestBed.createComponent(ChartRenderProbe);
    fixture.componentInstance.data.set(fixtureOverview(3)); fixture.detectChanges();
    const element = fixture.nativeElement.querySelector("app-charts") as HTMLElement;
    const details = element.querySelector("details") as HTMLDetailsElement;
    const row = element.querySelector("tbody tr");
    const summary = details.querySelector("summary") as HTMLElement;
    summary.click();
    expect(details.open).toBeTrue();
    fixture.componentInstance.unrelated.set(1); fixture.detectChanges();
    expect(details.open).toBeTrue();
    const next = fixtureOverview(3); next.series[0] = { ...next.series[0], clicks: 99 };
    next.totals.clicks += 49;
    fixture.componentInstance.data.set(next); fixture.detectChanges();
    expect(element.querySelector("tbody tr")).toBe(row);
    expect(row?.querySelector("td")?.textContent).toBe("99");
    expect(details.open).toBeTrue();
    summary.click(); expect(details.open).toBeFalse();
    fixture.destroy();
  });
});
