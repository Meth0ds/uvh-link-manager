import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { PublicStatusComponent } from "./public-status.component";
import { ApiService } from "../core/services/api.service";
import type { PublicStatusSnapshot } from "../core/models";

describe("PublicStatusComponent presentation", () => {
  let fixture: ComponentFixture<PublicStatusComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const healthy: PublicStatusSnapshot = { overall: "operational", generatedAt: "2026-09-13T12:00:00Z", stale: false, source: "external_monitor", components: [
    { id: "links", label: "Enlaces", status: "operational" }, { id: "panel", label: "Panel", status: "operational" }, { id: "webhooks", label: "Webhooks", status: "operational" },
  ], incidents: [] };
  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo(healthy);
    await TestBed.configureTestingModule({ imports: [PublicStatusComponent], providers: [provideRouter([]), { provide: ApiService, useValue: api }] }).compileComponents();
    fixture = TestBed.createComponent(PublicStatusComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it("shows the source timestamp and the three components without implying continuous polling", () => {
    expect(fixture.nativeElement.querySelectorAll(".component-grid article").length).toBe(3);
    expect(fixture.nativeElement.querySelector(".state-card time").getAttribute("datetime")).toBe(healthy.generatedAt);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it("does not paint a stale healthy snapshot as operational", () => {
    fixture.componentInstance.snapshot.set({ ...healthy, stale: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".unknown h2").textContent).toContain("Estado desconocido");
    expect(fixture.nativeElement.querySelector(".components")).toBeNull();
  });
  it("renders canonical unknown without empty component or incident regions", () => {
    fixture.componentInstance.snapshot.set({ overall: "unknown", generatedAt: null, stale: true, source: "external_monitor_unavailable", components: [], incidents: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".unknown")).not.toBeNull();
    expect(fixture.nativeElement.querySelector(".incidents")).toBeNull();
  });
  it("replaces a previous healthy measurement with unknown after a failed refresh", async () => {
    api.get.and.rejectWith(new Error("offline"));
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
    expect(fixture.componentInstance.snapshot()).toBeNull();
    expect(fixture.nativeElement.querySelector(".unknown")).not.toBeNull();
  });
  it("labels the previous measurement while a refresh is pending", () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".refresh-note").textContent).toContain("medición anterior");
    expect(fixture.nativeElement.querySelector(".page-heading button").disabled).toBeTrue();
  });
});
