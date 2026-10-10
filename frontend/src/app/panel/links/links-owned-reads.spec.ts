import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { of } from "rxjs";
import { LinksComponent } from "./links.component";
import { ApiService, type ApiReadOptions } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { PendingLinkIntentService } from "../../core/services/pending-link-intent.service";
import type { CollectionDto, DomainDto, Workspace } from "../../core/models";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("LinksComponent auxiliary read ownership", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let workspaces: WorkspaceService;
  let domainReads: ReturnType<typeof deferred<{ domains: DomainDto[] }>>[];
  let collectionReads: ReturnType<typeof deferred<{ collections: CollectionDto[] }>>[];
  let stored: string | null;
  const domains = (id: number): { domains: DomainDto[] } => ({ domains: [{ id, domain: `go${id}.test` } as DomainDto] });
  const collections = (id: number): { collections: CollectionDto[] } => ({ collections: [{ id, name: `Campaign ${id}`, links: 0 }] });

  beforeEach(async () => {
    stored = localStorage.getItem("uvh.workspaceId");
    localStorage.removeItem("uvh.workspaceId");
    domainReads = [];
    collectionReads = [];
    api = jasmine.createSpyObj<ApiService>("api", ["get", "post", "delete", "getBlob"]);
    api.get.and.callFake(((path: string) => {
      if (path === "/api/v1/domains") return domainReads.shift()?.promise ?? Promise.resolve(domains(7));
      if (path === "/api/v1/collections") return collectionReads.shift()?.promise ?? Promise.resolve(collections(7));
      return Promise.resolve({ links: [], total: 0, page: 1, perPage: 20 });
    }) as typeof api.get);
    await TestBed.configureTestingModule({
      imports: [LinksComponent],
      providers: [
        provideRouter([]), WorkspaceService,
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
      ],
    }).overrideComponent(LinksComponent, { set: { template: "", imports: [] } }).compileComponents();
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, name: "A", role: "owner" }, { id: 2, name: "B", role: "owner" }] as Workspace[]);
  });

  afterEach(() => {
    fixture?.destroy();
    if (stored === null) localStorage.removeItem("uvh.workspaceId");
    else localStorage.setItem("uvh.workspaceId", stored);
  });

  async function settle(): Promise<void> {
    // Background promises are not registered as Angular pending tasks. Drain
    // their microtasks before treating a completed read as a new action.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  async function mount(): Promise<void> {
    fixture = TestBed.createComponent(LinksComponent);
    fixture.detectChanges();
    await settle();
  }

  function reads(path: string) { return api.get.calls.all().filter(call => call.args[0] === path); }
  function readSignal(path: string, index = 0): AbortSignal | undefined {
    return (reads(path)[index].args[3] as ApiReadOptions | undefined)?.signal;
  }

  for (const outcome of ["response", "error"] as const) {
    it(`cancels old domain options and ignores a late ${outcome} after switching workspace`, async () => {
      const old = deferred<{ domains: DomainDto[] }>();
      domainReads.push(old);
      await mount();
      workspaces.select(2);
      fixture.detectChanges();
      await settle();
      expect(readSignal("/api/v1/domains")?.aborted).toBeTrue();
      if (outcome === "response") old.resolve(domains(1));
      else old.reject(new Error("old offline"));
      await settle();
      expect(fixture.componentInstance.domainOptions().map(d => d.id)).toEqual([7]);
    });
  }

  it("clears collections and cancels the old read when no workspace remains", async () => {
    await mount();
    const component = fixture.componentInstance;
    component.openBulkPanel("move");
    await settle();
    expect(component.collections().map(c => c.id)).toEqual([7]);
    component.openBulkPanel("move");
    const old = deferred<{ collections: CollectionDto[] }>();
    collectionReads.push(old);
    component.openBulkPanel("move");
    workspaces.select(null);
    fixture.detectChanges();
    old.resolve(collections(1));
    await settle();
    expect(readSignal("/api/v1/collections", 1)?.aborted).toBeTrue();
    expect(component.collections()).toEqual([]);
    expect(component.domainOptions()).toEqual([]);
  });

  it("invalidates reads through A to B to A even before a render observes B", async () => {
    const old = deferred<{ domains: DomainDto[] }>();
    domainReads.push(old);
    await mount();
    workspaces.select(2);
    workspaces.select(1);
    fixture.detectChanges();
    old.resolve(domains(1));
    await settle();
    expect(readSignal("/api/v1/domains")?.aborted).toBeTrue();
    expect(fixture.componentInstance.domainOptions().map(d => d.id)).toEqual([7]);
    expect(reads("/api/v1/domains").length).toBe(2);
  });

  it("does not reuse options from a prior session in the same workspace", async () => {
    const old = deferred<{ domains: DomainDto[] }>();
    domainReads.push(old);
    await mount();
    TestBed.inject(SessionContextService).advance();
    fixture.detectChanges();
    old.resolve(domains(1));
    await settle();
    expect(readSignal("/api/v1/domains")?.aborted).toBeTrue();
    expect(fixture.componentInstance.domainOptions().map(d => d.id)).toEqual([7]);
  });

  it("cancels both auxiliary reads on destroy and ignores later values", async () => {
    const domain = deferred<{ domains: DomainDto[] }>();
    const collection = deferred<{ collections: CollectionDto[] }>();
    domainReads.push(domain);
    collectionReads.push(collection);
    await mount();
    const component = fixture.componentInstance;
    component.openBulkPanel("move");
    fixture.destroy();
    domain.resolve(domains(1));
    collection.resolve(collections(1));
    await Promise.all([domain.promise, collection.promise]);
    expect(readSignal("/api/v1/domains")?.aborted).toBeTrue();
    expect(readSignal("/api/v1/collections")?.aborted).toBeTrue();
    expect(component.domainOptions()).toEqual([]);
    expect(component.collections()).toEqual([]);
  });

  it("coalesces overlapping collection reads and refreshes after they finish", async () => {
    await mount();
    const pending = deferred<{ collections: CollectionDto[] }>();
    collectionReads.push(pending);
    const component = fixture.componentInstance;
    component.openBulkPanel("move");
    component.openBulkPanel("move");
    component.openBulkPanel("move");
    expect(reads("/api/v1/collections").length).toBe(1);
    pending.resolve(collections(1));
    await settle();
    expect(component.collections().map(c => c.id)).toEqual([1]);
    component.openBulkPanel("move");
    component.openBulkPanel("move");
    await settle();
    expect(reads("/api/v1/collections").length).toBe(2);
    expect(component.collections().map(c => c.id)).toEqual([7]);
  });
});
