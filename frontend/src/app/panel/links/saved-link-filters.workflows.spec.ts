import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { emptyLinkFilter, type SavedLinkFilter } from "../../core/link-workflows";
import { ApiService } from "../../core/services/api.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { ActionDialogService } from "../action-dialog.service";
import { SavedLinkFiltersComponent } from "./saved-link-filters.component";

describe("SavedLinkFiltersComponent owned decisions", () => {
  let fixture: ComponentFixture<SavedLinkFiltersComponent>, component: SavedLinkFiltersComponent;
  let api: jasmine.SpyObj<ApiService>, actions: jasmine.SpyObj<ActionDialogService>, currentContext: string;
  const enabled = signal(true);
  const filter = (changes: Partial<SavedLinkFilter> = {}): SavedLinkFilter => ({ id: 4, name: "Navidad", version: 3, spec: { ...emptyLinkFilter(), q: "navidad" }, valid: true, invalidReferences: [], ...changes });
  const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => resolve = done); return { promise, resolve }; };

  beforeEach(async () => {
    currentContext = "workspace:1:user:1"; enabled.set(true);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    api.get.and.resolveTo({ filters: [filter()] } as never);
    actions = jasmine.createSpyObj<ActionDialogService>("Actions", ["prompt", "confirm"]);
    await TestBed.configureTestingModule({ imports: [SavedLinkFiltersComponent], providers: [
      { provide: ApiService, useValue: api }, { provide: ActionDialogService, useValue: actions },
      { provide: LinkWorkflowService, useValue: { context: () => currentContext, enabled, capabilities: () => ({ maxSavedFilters: 50 }) } },
    ] }).overrideComponent(SavedLinkFiltersComponent, { set: { template: "", imports: [] } }).compileComponents();
    fixture = TestBed.createComponent(SavedLinkFiltersComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput("spec", emptyLinkFilter()); fixture.autoDetectChanges(); await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());

  it("never applies a filter with deleted references and keeps it selected for repair", async () => {
    const invalid = filter({ valid: false, invalidReferences: ["Dominio eliminado"] });
    api.get.and.resolveTo({ filters: [invalid] } as never); const applied = jasmine.createSpy("applied"); component.filterApplied.subscribe(applied);
    await component.choose(invalid.id);
    expect(applied).not.toHaveBeenCalled(); expect(component.selectedId()).toBe(invalid.id);
    expect(component.error()).toContain("referencias");
  });

  it("applies a fresh clone only after revalidating the saved filter", async () => {
    const saved = filter(), applied = jasmine.createSpy("applied"); api.get.and.resolveTo({ filters: [saved] } as never);
    component.filterApplied.subscribe(applied); await component.choose(saved.id);
    const value = applied.calls.mostRecent().args[0] as { spec: typeof saved.spec; id: number };
    expect(value).toEqual({ spec: saved.spec, id: saved.id }); expect(value.spec).not.toBe(saved.spec);
    value.spec.q = "changed outside"; expect(component.selected()?.spec.q).toBe("navidad");
  });

  it("drops a delayed save prompt when workspace changes before its effect runs", async () => {
    const prompt = deferred<string | null>(); actions.prompt.and.returnValue(prompt.promise);
    const pending = component.save(false); currentContext = "workspace:2:user:1"; prompt.resolve("Mis favoritos"); await pending;
    expect(api.post).not.toHaveBeenCalled(); expect(component.confirmation()).toBeNull();
  });

  for (const action of ["rename", "remove"] as const) {
    it(`drops a delayed ${action} decision when workspace changes`, async () => {
      const decision = deferred<string | boolean | null>(); actions.prompt.and.returnValue(decision.promise as Promise<string | null>); actions.confirm.and.returnValue(decision.promise as Promise<boolean>);
      const pending = action === "rename" ? component.rename(filter()) : component.remove(filter());
      currentContext = "workspace:2:user:1"; decision.resolve(action === "rename" ? "Otro nombre" : true); await pending;
      expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
    });
  }

  it("ignores late list results even before the context effect runs", async () => {
    const response = deferred<{ filters: SavedLinkFilter[] }>(); api.get.and.returnValue(response.promise as never);
    const pending = component.reload(); currentContext = "workspace:2:user:1"; response.resolve({ filters: [filter({ id: 99 })] }); await pending;
    expect(component.filters().some(value => value.id === 99)).toBeFalse();
  });

  it("saves the reviewed snapshot and updates explicitly with its revision", async () => {
    const prompt = deferred<string | null>(); actions.prompt.and.returnValue(prompt.promise);
    const original = { ...emptyLinkFilter(), q: "antes" }; fixture.componentRef.setInput("spec", original);
    api.post.and.resolveTo({ filter: filter({ name: "Guardado", spec: original }) } as never);
    const pending = component.save(false); fixture.componentRef.setInput("spec", { ...original, q: "después" }); prompt.resolve("Guardado"); await pending;
    expect(api.post.calls.mostRecent().args[1]).toEqual({ name: "Guardado", spec: original });
    expect(component.modified()).toBeTrue(); api.patch.and.resolveTo({ filter: filter({ version: 4, spec: { ...original, q: "después" } }) } as never);
    await component.save(true);
    expect(api.patch.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ version: 3, spec: { ...original, q: "después" } }));
  });

  it("does not publish a late mutation result in another workspace", async () => {
    component.selectedId.set(4); const response = deferred<{ filter: SavedLinkFilter }>(); api.patch.and.returnValue(response.promise as never);
    const pending = component.save(true); currentContext = "workspace:2:user:1"; response.resolve({ filter: filter({ name: "Wrong workspace" }) }); await pending;
    expect(component.filters().some(value => value.name === "Wrong workspace")).toBeFalse(); expect(component.confirmation()).toBeNull();
  });
});
