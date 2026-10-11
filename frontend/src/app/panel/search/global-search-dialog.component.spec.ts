import { signal } from "@angular/core";
import { TestBed, fakeAsync, tick, flushMicrotasks, type ComponentFixture } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { GlobalSearchService, type GlobalSearchResponse } from "../../core/services/global-search.service";
import { GlobalSearchDialogComponent } from "./global-search-dialog.component";

describe("Global search dialog interactions", () => {
  let fixture: ComponentFixture<GlobalSearchDialogComponent>, component: GlobalSearchDialogComponent;
  let context: ReturnType<typeof signal<string>>, search: jasmine.Spy, close: jasmine.Spy;
  const empty: GlobalSearchResponse = { version: 1, links: [], domains: [], moreLinks: false, moreDomains: false };
  beforeEach(async () => {
    context = signal("workspace-a"); search = jasmine.createSpy("search").and.resolveTo(empty); close = jasmine.createSpy("close");
    await TestBed.configureTestingModule({ imports: [GlobalSearchDialogComponent], providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: GlobalSearchService, useValue: { context, search, canCreate: () => false,
        navigation: () => [{ label: "Trabajo", items: [{ label: "Enlaces", path: "/app/links", icon: "link" }] }],
        workspaces: { currentId: () => 1, list: () => [{ id: 1, name: "Workspace A", role: "viewer" }, { id: 2, name: "Workspace B", role: "editor" }] } } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(GlobalSearchDialogComponent); component = fixture.componentInstance; fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  const key = (key: string) => { const input = fixture.nativeElement.querySelector("input") as HTMLInputElement; input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); fixture.detectChanges(); };

  it("debounces, consolidates keystrokes and does not fetch one-character searches", fakeAsync(() => {
    component.onQuery("c"); tick(200); expect(search).not.toHaveBeenCalled();
    component.onQuery("🍽"); tick(200); fixture.detectChanges(); expect(search).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain("No encontramos");
    component.onQuery("ca"); tick(100); component.onQuery("carta"); tick(179); expect(search).not.toHaveBeenCalled(); tick(1); flushMicrotasks();
    expect(search).toHaveBeenCalledOnceWith("carta", jasmine.any(AbortSignal)); expect(component.busy()).toBeFalse();
  }));
  it("ignores a late result after a newer query and closes on a security context change", fakeAsync(() => {
    let resolve!: (value: GlobalSearchResponse) => void;
    search.and.returnValue(new Promise<GlobalSearchResponse>(done => resolve = done));
    component.onQuery("carta"); tick(180); component.onQuery("nuevo");
    resolve({ ...empty, links: [{ id: 7, name: "Old secret", shortUrl: "https://uvh.test/old", state: "active" }] }); flushMicrotasks();
    expect(component.results().links).toEqual([]);
    context.set("workspace-b"); fixture.detectChanges(); expect(close).toHaveBeenCalledWith();
  }));
  it("lets a reader choose QR, then Escape returns before closing", () => {
    expect(component.options().some(option => option.action.kind === "create")).toBeFalse();
    component.choose(component.options().findIndex(option => option.action.kind === "choose-qr")); fixture.detectChanges(); expect(component.qrMode()).toBeTrue();
    key("Escape"); expect(component.qrMode()).toBeFalse(); expect(close).not.toHaveBeenCalled();
    key("Escape"); expect(close).toHaveBeenCalledWith();
  });
  it("supports keyboard selection and returns only an explicit workspace action", () => {
    key("ArrowDown"); key("Enter"); expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ context: "workspace-a", action: { kind: "navigate", path: "/app/links" } }));
    component.onQuery("Workspace B"); fixture.detectChanges();
    component.choose(component.options().findIndex(option => option.action.kind === "workspace"));
    expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ action: { kind: "workspace", id: 2 } }));
  });
  it("renders hostile names as text and shows retry after failure", fakeAsync(() => {
    search.and.resolveTo({ ...empty, links: [{ id: 7, name: "<img src=x onerror=alert(1)>", shortUrl: "https://uvh.test/menu", state: "active" }] });
    component.onQuery("img"); tick(180); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("img")).toBeNull(); expect(fixture.nativeElement.textContent).toContain("<img src=x onerror=alert(1)>");
    search.and.rejectWith(new Error("Network failed")); component.onQuery("other"); tick(180); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain("Network failed");
  }));
});
