import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import { LinkWorkflowService } from "./link-workflow.service";

describe("LinkWorkflowService capability ownership", () => {
  let api: jasmine.SpyObj<ApiService>, service: LinkWorkflowService, workspaces: WorkspaceService;
  const user = signal<{ id: number; name: string } | null>({ id: 1, name: "Ana" });
  const generation = signal(0);
  const capabilities = { enabled: true, ruleSimulator: true, linkHistory: true, linkHistoryRestore: true, reminderHours: 24, reminderClickRatio: 0.9, maxSavedFilters: 50 };
  const flush = () => new Promise<void>(done => setTimeout(done, 0));
  beforeEach(async () => {
    user.set({ id: 1, name: "Ana" }); generation.set(0);
    api = jasmine.createSpyObj<ApiService>("API", ["get"]); api.get.and.resolveTo(capabilities as never);
    TestBed.configureTestingModule({ providers: [WorkspaceService,
      { provide: ApiService, useValue: api }, { provide: AuthService, useValue: { user, sessionGeneration: generation } },
    ] });
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, name: "Uno", slug: "uno", createdAt: "2026-10-10T00:00:00Z", role: "owner" }, { id: 2, name: "Dos", slug: "dos", createdAt: "2026-10-10T00:00:00Z", role: "viewer" }]); workspaces.select(1);
    service = TestBed.inject(LinkWorkflowService); await flush();
  });
  it("keeps capabilities and makes no request when only the profile name changes", async () => {
    expect(service.enabled()).toBeTrue(); api.get.calls.reset();
    user.set({ id: 1, name: "Otro nombre" }); await flush();
    expect(api.get).not.toHaveBeenCalled(); expect(service.enabled()).toBeTrue();
  });
  it("withdraws capabilities immediately across a workspace ABA transition", async () => {
    workspaces.select(2); workspaces.select(1);
    expect(service.enabled()).toBeFalse(); await flush();
    expect(service.enabled()).toBeTrue(); expect(api.get).toHaveBeenCalledTimes(2);
  });
  it("rejects an old capability result after the session changes before effects run", async () => {
    let resolve!: (value: typeof capabilities) => void;
    api.get.and.returnValue(new Promise<typeof capabilities>(done => resolve = done) as never);
    generation.update(value => value + 1); await flush();
    generation.update(value => value + 1); resolve(capabilities);
    await Promise.resolve(); expect(service.enabled()).toBeFalse();
  });
  it("does not query capabilities after logout even with a retained workspace", async () => {
    api.get.calls.reset(); user.set(null); await flush();
    expect(service.enabled()).toBeFalse(); expect(api.get).not.toHaveBeenCalled();
  });
});
