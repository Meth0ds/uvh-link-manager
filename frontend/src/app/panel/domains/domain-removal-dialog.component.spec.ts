import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import type { DomainDto, LinkDto } from "../../core/models";
import type { DomainDeletionPreview, DomainReassignmentPreview } from "../../core/domain-management";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { DomainRemovalDialogComponent } from "./domain-removal-dialog.component";

const link = { id: 11, alias: "promo", name: null, shortUrl: "https://source.example.test/promo", domainId: 7, state: "active" } as LinkDto;
const reviewed: DomainReassignmentPreview = {
  domainId: 7, targetDomainId: 8, canApply: true,
  links: [{ linkId: 11, version: 1, alias: "promo", oldUrl: link.shortUrl, newUrl: "https://target.example.test/promo", state: "active", inTrash: false, deletedAt: null, purgeAt: null, conflict: null }],
};

describe("DomainRemovalDialogComponent", () => {
  let fixture: ComponentFixture<DomainRemovalDialogComponent>;
  let component: DomainRemovalDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let ref: { close: jasmine.Spy; disableClose: boolean };
  let impact: DomainDeletionPreview;
  const workspace = signal(1);
  const role = signal("owner");
  const generation = signal(0);

  beforeEach(async () => {
    workspace.set(1); role.set("owner"); generation.set(0);
    impact = { domainId: 7, domain: "source.example.test", isDefault: false, liveLinks: 1, trashedLinks: 0, blockedLinks: 0, totalLinks: 1, canDelete: false };
    ref = { close: jasmine.createSpy("close"), disableClose: false };
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.callFake(((path: string) => Promise.resolve(path.endsWith("deletion-preview") ? impact
      : path === "/api/v1/domains" ? { domains: [{ id: 7, servingReady: true }, { id: 8, domain: "target.example.test", servingReady: true }] as DomainDto[] }
        : path.endsWith("trash") ? { links: [{ link: { ...link, state: "deleted" }, previousState: "paused", purgeAt: "2026-10-31T00:00:00Z" }], total: 1 }
          : { links: [link], total: 1 })) as never);
    api.post.and.resolveTo(reviewed as never);
    api.delete.and.resolveTo({ ok: true } as never);
    await TestBed.configureTestingModule({
      imports: [DomainRemovalDialogComponent],
      providers: [provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { domainId: 7, domain: "source.example.test", workspaceId: 1 } },
        { provide: MatDialogRef, useValue: ref }, { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
        { provide: SessionContextService, useValue: { generation, user: signal(null) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DomainRemovalDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  async function selectAndReview(): Promise<void> {
    component.startManaging(); await fixture.whenStable();
    component.toggle(component.rows()[0], true); component.changeTarget(8);
    await component.review();
  }

  it("loads current impact without mutating or preselecting links or a target", () => {
    expect(component.impact()?.totalLinks).toBe(1);
    expect(component.selected().size).toBe(0); expect(component.targetId()).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
  });

  it("requires explicit selection and target before a server review", async () => {
    await component.review(); expect(api.post).not.toHaveBeenCalled();
    await selectAndReview();
    expect(api.post).toHaveBeenCalledWith("/api/v1/domains/7/reassignment-preview", { linkIds: [11], targetDomainId: 8 }, jasmine.any(Function));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("invalidates the reviewed result when the target changes", async () => {
    await selectAndReview(); expect(component.preview()).not.toBeNull();
    component.changeTarget(null); expect(component.preview()).toBeNull();
    await component.apply(); expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("sends expected versions and refreshes impact without automatically deleting", async () => {
    await selectAndReview();
    api.post.and.resolveTo({ ok: true, applied: 1, domainId: 7, targetDomainId: 8, linkIds: [11] } as never);
    impact = { ...impact, liveLinks: 0, totalLinks: 0, canDelete: true };
    await component.apply();
    expect(api.post).toHaveBeenCalledWith("/api/v1/domains/7/reassign", { linkIds: [11], targetDomainId: 8, expectedVersions: [{ id: 11, version: 1 }] }, jasmine.any(Function), jasmine.objectContaining({ "Idempotency-Key": jasmine.any(String) }));
    expect(component.impact()?.canDelete).toBeTrue(); expect(component.selected().size).toBe(0);
    expect(api.delete).not.toHaveBeenCalled(); expect(ref.close).not.toHaveBeenCalled();
  });

  it("freezes uncertain outcomes and retries the exact body and idempotency key", async () => {
    await selectAndReview(); api.post.calls.reset();
    api.post.and.rejectWith(new ApiRequestError("Conexión perdida", 0));
    await component.apply();
    const first = api.post.calls.mostRecent().args;
    expect(component.uncertain()).toBeTrue(); expect(ref.disableClose).toBeFalse();
    component.changeTarget(null);
    expect(component.targetId()).toBe(8);
    api.post.and.resolveTo({ ok: true, applied: 1, domainId: 7, targetDomainId: 8, linkIds: [11] } as never);
    await component.apply();
    const retry = api.post.calls.mostRecent().args;
    expect(retry[1]).toEqual(first[1]); expect(retry[3]).toEqual(first[3]);
    expect(component.uncertain()).toBeFalse(); expect(ref.disableClose).toBeFalse();
  });

  it("preserves selection and requests a new review after a conflict", async () => {
    await selectAndReview(); api.post.and.rejectWith(new ApiRequestError("Un enlace cambió", 409));
    await component.apply();
    expect(component.preview()).toBeNull(); expect(component.selected().has(11)).toBeTrue();
    expect(component.error()).toBe("Un enlace cambió"); expect(api.delete).not.toHaveBeenCalled();
  });

  it("allows closing after an uncertain result without issuing another mutation", async () => {
    await selectAndReview(); api.post.and.rejectWith(new ApiRequestError("Sin conexión", 0));
    await component.apply(); const calls = api.post.calls.count();
    component.close();
    expect(ref.close).toHaveBeenCalledWith({ deleted: false, changed: false });
    expect(api.post.calls.count()).toBe(calls);
  });

  it("keeps trash candidates deleted and queries only the source domain", async () => {
    component.startManaging(); await fixture.whenStable(); component.changeTab(1); await fixture.whenStable();
    expect(api.get).toHaveBeenCalledWith("/api/v1/links/trash", jasmine.objectContaining({ domainId: 7 }), jasmine.any(Function), jasmine.any(Object));
    expect(component.rows()[0].link.state).toBe("deleted"); expect(component.rows()[0].purgeAt).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("requires a separate explicit confirmation to delete an empty domain", async () => {
    impact = { ...impact, liveLinks: 0, totalLinks: 0, canDelete: true }; await component.reload();
    await component.remove(); expect(api.delete).not.toHaveBeenCalled();
    component.deleteConfirmation.set(true); await component.remove();
    expect(api.delete).toHaveBeenCalledWith("/api/v1/domains/7", undefined, jasmine.any(Function));
    expect(ref.close).toHaveBeenCalledWith({ deleted: true, changed: true });
  });

  it("refreshes blockers when a new link races with deletion", async () => {
    component.impact.set({ ...impact, liveLinks: 0, totalLinks: 0, canDelete: true });
    component.deleteConfirmation.set(true); api.delete.and.rejectWith(new ApiRequestError("Dominio en uso", 409));
    await component.remove();
    expect(component.impact()?.canDelete).toBeFalse(); expect(component.deleteConfirmation()).toBeFalse();
    expect(ref.close).not.toHaveBeenCalled();
  });

  it("does not permit deletion after a failed impact refresh", async () => {
    api.get.and.rejectWith(new Error("network")); await component.reload();
    component.deleteConfirmation.set(true); await component.remove();
    expect(component.impact()).toBeNull(); expect(api.delete).not.toHaveBeenCalled();
  });

  for (const change of ["workspace", "role", "session"] as const) {
    it(`closes and ignores a late review after a ${change} change`, async () => {
      component.startManaging(); await fixture.whenStable(); component.toggle(component.rows()[0], true); component.changeTarget(8);
      let resolve!: (value: DomainReassignmentPreview) => void;
      api.post.and.returnValue(new Promise((done) => { resolve = done; }) as never);
      const pending = component.review();
      if (change === "workspace") workspace.set(2);
      else if (change === "role") role.set("editor");
      else generation.set(1);
      fixture.detectChanges(); resolve(reviewed); await pending;
      expect(ref.close).toHaveBeenCalled(); expect(component.preview()).toBeNull();
      await component.apply(); expect(api.post).toHaveBeenCalledTimes(1);
    });
  }
});
