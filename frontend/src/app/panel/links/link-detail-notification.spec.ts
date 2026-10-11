import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { LinkDetailComponent } from "./link-detail.component";

describe("Link detail notification workspace selection", () => {
  let harness: RouterTestingHarness, workspaces: WorkspaceService, reads: number[];
  beforeEach(async () => {
    reads = [];
    const api = jasmine.createSpyObj<ApiService>("API", ["get"]);
    api.get.and.callFake(() => { reads.push(workspaces.currentId()!); return Promise.reject(new Error("Fixture stops at authorized read")); });
    await TestBed.configureTestingModule({ providers: [WorkspaceService,
      provideRouter([{ path: "links/:id", component: LinkDetailComponent }]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: signal({ id: 1 }), sessionGeneration: () => 0 } },
      { provide: LinkWorkflowService, useValue: { enabled: () => false, context: () => "disabled" } },
    ] }).overrideComponent(LinkDetailComponent, { set: { template: "", imports: [] } }).compileComponents();
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, name: "Uno", slug: "uno", createdAt: "2026-10-10T00:00:00Z", role: "owner" }, { id: 2, name: "Dos", slug: "dos", createdAt: "2026-10-10T00:00:00Z", role: "viewer" }]); workspaces.select(2);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => harness.fixture.destroy());
  it("selects only an authenticated membership before requesting a notification link", async () => {
    await harness.navigateByUrl("/links/7?workspaceId=1", LinkDetailComponent); await harness.fixture.whenStable();
    expect(workspaces.currentId()).toBe(1); expect(reads).toEqual([1]);
    workspaces.select(2); harness.detectChanges(); await harness.fixture.whenStable();
    expect(workspaces.currentId()).toBe(2); expect(reads).toEqual([1, 2]);
  });
  for (const invalid of ["999", "0", "1.5", "malformed"]) {
    it(`does not send a request for an unauthorized notification workspace ${invalid}`, async () => {
      const component = await harness.navigateByUrl(`/links/7?workspaceId=${invalid}`, LinkDetailComponent); await harness.fixture.whenStable();
      expect(workspaces.currentId()).toBe(2); expect(reads).toEqual([]);
      expect(component.error()).toContain("No tienes acceso"); expect(component.loading()).toBeFalse();
    });
  }
});
