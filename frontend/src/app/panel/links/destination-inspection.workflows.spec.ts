import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import type { DestinationInspection } from "../../core/link-workflows";
import type { LinkDto } from "../../core/models";
import { DestinationInspectionService } from "../../core/services/destination-inspection.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { DestinationInspectionComponent } from "./destination-inspection.component";

describe("DestinationInspectionComponent stale results", () => {
  let fixture: ComponentFixture<DestinationInspectionComponent>, component: DestinationInspectionComponent;
  let service: jasmine.SpyObj<DestinationInspectionService>;
  const context = signal("workspace:1"), enabled = signal(true);
  const inspection = (iconUrl: string | null = null): DestinationInspection => ({ id: "2e13970a-5757-4a20-9345-08b42985e6ec", status: "ready", result: { version: 1, status: "reachable", httpStatus: 200, title: "Destino", domain: "example.test", iconUrl, checkedAt: "2026-10-11T10:00:00Z", reason: null } });
  const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

  beforeEach(async () => {
    context.set("workspace:1"); enabled.set(true); service = jasmine.createSpyObj<DestinationInspectionService>("Inspection", ["inspect", "icon"]);
    await TestBed.configureTestingModule({ imports: [DestinationInspectionComponent], providers: [
      { provide: DestinationInspectionService, useValue: service }, { provide: LinkWorkflowService, useValue: { context, enabled } },
    ] }).overrideComponent(DestinationInspectionComponent, { set: { template: "", imports: [] } }).compileComponents();
    fixture = TestBed.createComponent(DestinationInspectionComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput("url", "https://example.test/article"); fixture.autoDetectChanges(); await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());

  it("consults only after an explicit action and uses the link revision for health checks", async () => {
    expect(service.inspect).not.toHaveBeenCalled(); service.inspect.and.resolveTo(inspection());
    fixture.componentRef.setInput("link", { id: 7, version: 4, destination: "https://example.test" } as LinkDto); await component.check();
    expect(service.inspect).toHaveBeenCalledOnceWith({ linkId: 7, linkVersion: 4 }, jasmine.any(AbortSignal));
  });

  it("drops an old URL response before reactive cleanup and does not load its icon", async () => {
    fixture.componentRef.setInput("preview", true); const response = deferred<DestinationInspection>(); service.inspect.and.returnValue(response.promise);
    const pending = component.check(); fixture.componentRef.setInput("url", "https://different.test"); response.resolve(inspection("/api/v1/destination-inspections/fixture/icon")); await pending; await fixture.whenStable();
    expect(component.result()).toBeNull(); expect(service.icon).not.toHaveBeenCalled(); expect(component.error()).toBeNull();
  });

  for (const cause of ["context", "disable", "destroy"] as const) {
    it(`ignores a late inspection failure after ${cause}`, async () => {
      const response = deferred<DestinationInspection>(); service.inspect.and.returnValue(response.promise); const pending = component.check();
      if (cause === "context") context.set("workspace:2"); if (cause === "disable") enabled.set(false); if (cause === "destroy") fixture.destroy();
      response.reject(new Error("Old request failed")); await pending;
      expect(component.error()).toBeNull(); expect(component.result()).toBeNull();
    });
  }

  it("does not create a blob URL for an icon received after the destination changed", async () => {
    fixture.componentRef.setInput("preview", true); service.inspect.and.resolveTo(inspection("/api/v1/destination-inspections/fixture/icon"));
    const icon = deferred<Blob>(); service.icon.and.returnValue(icon.promise); const create = spyOn(URL, "createObjectURL");
    const pending = component.check(); await Promise.resolve(); fixture.componentRef.setInput("url", "https://different.test");
    icon.resolve(new Blob(["PNG"], { type: "image/png" })); await pending;
    expect(create).not.toHaveBeenCalled(); expect(component.icon()).toBeNull();
  });

  it("releases a same-origin icon when refreshing and on destruction", async () => {
    fixture.componentRef.setInput("preview", true); service.inspect.and.resolveTo(inspection("/api/v1/destination-inspections/fixture/icon"));
    service.icon.and.resolveTo(new Blob(["PNG"], { type: "image/png" })); spyOn(URL, "createObjectURL").and.returnValues("blob:first", "blob:second"); const revoke = spyOn(URL, "revokeObjectURL");
    await component.check(); expect(component.icon()).toBe("blob:first"); await component.check(); expect(revoke).toHaveBeenCalledWith("blob:first");
    fixture.destroy(); expect(revoke).toHaveBeenCalledWith("blob:second");
  });

  it("keeps text results when the icon fails and refuses unsafe preview URLs", async () => {
    fixture.componentRef.setInput("preview", true); service.inspect.and.resolveTo(inspection("/api/v1/destination-inspections/fixture/icon")); service.icon.and.rejectWith(new Error("Not found"));
    await component.check(); expect(component.result()?.status).toBe("reachable"); expect(component.error()).toBeNull();
    for (const url of ["javascript:alert(1)", "https://user:secret@example.test", "not a URL"]) { fixture.componentRef.setInput("url", url); expect(component.validUrl()).toBeFalse(); }
  });
});
