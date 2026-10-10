import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QrDesignPickerComponent } from "./qr-design-picker.component";
import { QrCampaignSaveComponent } from "./qr-campaign-save.component";
import { QrLibraryService, type SavedQrDesign, type QrVariant } from "../../core/services/qr-library.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { DEFAULT_QR_DESIGN } from "../../core/services/qr-design";

// Simulate uncertain responses and changed authority at the UI boundary. The
// backend suite separately checks reservations, files and transaction locks.
describe("QR persistence ownership and retry intents", () => {
  let library: jasmine.SpyObj<QrLibraryService>;
  const role = signal("owner"), workspace = signal(1), generation = signal(0);
  const row = (): SavedQrDesign => ({ id: 9, name: "Carta", spec: { ...DEFAULT_QR_DESIGN }, version: 1, createdAt: "2026-10-10", updatedAt: "2026-10-10" });

  beforeEach(async () => {
    role.set("owner"); workspace.set(1); generation.set(0);
    library = jasmine.createSpyObj<QrLibraryService>("QrLibrary", ["list", "create", "update", "delete", "upload", "preparedLogo", "createVariant", "updateVariant"]);
    library.list.and.resolveTo([row()]);
    await TestBed.configureTestingModule({
      imports: [QrDesignPickerComponent, QrCampaignSaveComponent],
      providers: [
        { provide: QrLibraryService, useValue: library },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role, selectionGeneration: generation } },
        { provide: SessionContextService, useValue: { user: signal({ id: 1 }), generation: signal(0) } },
      ],
    }).overrideComponent(QrDesignPickerComponent, { set: { template: "", imports: [] } })
      .overrideComponent(QrCampaignSaveComponent, { set: { template: "", imports: [] } }).compileComponents();
  });

  function picker() {
    const fixture = TestBed.createComponent(QrDesignPickerComponent);
    fixture.componentRef.setInput("spec", { ...DEFAULT_QR_DESIGN });
    fixture.componentInstance.name.set("Carta"); fixture.detectChanges();
    return fixture;
  }

  it("reuses an uncertain creation key and applies only the confirmed result", async () => {
    const fixture = picker(), component = fixture.componentInstance, applied = jasmine.createSpy("applied");
    component.applied.subscribe(applied);
    library.create.and.rejectWith(new Error("Network response lost"));
    await component.save(false);
    const key = library.create.calls.mostRecent().args[2];
    expect(applied).not.toHaveBeenCalled();
    library.create.and.resolveTo(row()); await component.save(false);
    expect(library.create.calls.mostRecent().args[2]).toBe(key);
    expect(applied).toHaveBeenCalledTimes(1); expect(component.selected()?.id).toBe(9);
    fixture.destroy();
  });

  it("treats a replacement file as new input even if its metadata matches", async () => {
    const fixture = picker(), component = fixture.componentInstance;
    fixture.componentRef.setInput("spec", { ...DEFAULT_QR_DESIGN, logo: { kind: "custom", assetId: null } });
    fixture.componentRef.setInput("logo", { canvas: document.createElement("canvas"), preview: "", name: "Logo" });
    const file = new File(["a"], "logo.png", { lastModified: 1 });
    fixture.componentRef.setInput("file", file); fixture.detectChanges();
    library.upload.and.rejectWith(new Error("Network unavailable"));
    await component.save(false); const key = library.upload.calls.mostRecent().args[1];
    await component.save(false); expect(library.upload.calls.mostRecent().args[1]).toBe(key);
    fixture.componentRef.setInput("file", new File(["b"], "logo.png", { lastModified: 1 }));
    fixture.detectChanges(); await component.save(false);
    expect(library.upload.calls.mostRecent().args[1]).not.toBe(key);
    expect(library.create).not.toHaveBeenCalled(); fixture.destroy();
  });

  it("lets readers apply a design while denying all design mutations", async () => {
    role.set("viewer"); const fixture = picker(), component = fixture.componentInstance;
    const applied = jasmine.createSpy("applied"); component.applied.subscribe(applied);
    await component.load(); await component.apply(9);
    await component.save(false); await component.duplicate(); await component.remove();
    expect(applied).toHaveBeenCalledOnceWith({ spec: row().spec, logo: null });
    expect(library.create).not.toHaveBeenCalled(); expect(library.update).not.toHaveBeenCalled(); expect(library.delete).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it("discards a late library response even after returning to the same workspace", async () => {
    const fixture = picker(), component = fixture.componentInstance;
    let resolve!: (rows: SavedQrDesign[]) => void;
    library.list.and.returnValue(new Promise<SavedQrDesign[]>(done => resolve = done));
    const pending = component.load();
    workspace.set(2); generation.set(1); fixture.detectChanges();
    workspace.set(1); generation.set(2); fixture.detectChanges();
    resolve([row()]); await pending;
    expect(component.designs()).toEqual([]); fixture.destroy();
  });

  it("does not publish a late campaign response after permissions change", async () => {
    const fixture = TestBed.createComponent(QrCampaignSaveComponent), component = fixture.componentInstance;
    fixture.componentRef.setInput("spec", { ...DEFAULT_QR_DESIGN }); fixture.componentRef.setInput("linkId", 1);
    component.name.set("Mostrador"); fixture.detectChanges();
    const saved = jasmine.createSpy("saved"); component.saved.subscribe(saved);
    let resolve!: (variant: QrVariant) => void;
    library.createVariant.and.returnValue(new Promise<QrVariant>(done => resolve = done));
    const pending = component.save(); await Promise.resolve();
    role.set("viewer"); fixture.detectChanges();
    resolve({ ...row(), linkId: 1, publicId: "a".repeat(32), archived: false }); await pending;
    expect(saved).not.toHaveBeenCalled(); fixture.destroy();
  });

  it("exposes and retries a failed initial private logo without saving again", async () => {
    library.preparedLogo.and.rejectWith(new Error("Private image temporarily unavailable"));
    const fixture = picker(), component = fixture.componentInstance, applied = jasmine.createSpy("applied");
    component.applied.subscribe(applied);
    fixture.componentRef.setInput("initial", { ...DEFAULT_QR_DESIGN, logo: { kind: "custom", assetId: 3 } });
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.open()).toBeTrue(); expect(component.initialPending()).toBeTrue();
    expect(applied).not.toHaveBeenCalled();
    const logo = { canvas: document.createElement("canvas"), preview: "", name: "Normalized logo" };
    library.preparedLogo.and.resolveTo(logo); await component.retryError();
    expect(applied).toHaveBeenCalledOnceWith({ spec: jasmine.objectContaining({ logo: { kind: "custom", assetId: 3 } }), logo });
    expect(component.initialPending()).toBeFalse(); expect(library.create).not.toHaveBeenCalled();
    expect(library.update).not.toHaveBeenCalled(); fixture.destroy();
  });

  it("retries the normalized image after a confirmed save without duplicating the design", async () => {
    const saved = { ...row(), spec: { ...DEFAULT_QR_DESIGN, logo: { kind: "custom" as const, assetId: 3 } } };
    library.create.and.resolveTo(saved); library.preparedLogo.and.rejectWith(new Error("Unavailable"));
    const fixture = picker(), component = fixture.componentInstance, applied = jasmine.createSpy("applied");
    component.applied.subscribe(applied); await component.save(false);
    expect(applied).not.toHaveBeenCalled(); expect(component.retryApplyId()).toBe(9);
    const logo = { canvas: document.createElement("canvas"), preview: "", name: "Normalized logo" };
    library.preparedLogo.and.resolveTo(logo); await component.retryError();
    expect(library.create).toHaveBeenCalledTimes(1); expect(applied).toHaveBeenCalledOnceWith({ spec: saved.spec, logo });
    fixture.destroy();
  });

  it("requires explicit selection of a newer saved version instead of advancing the edit version silently", async () => {
    const fixture = picker(), component = fixture.componentInstance;
    await component.load(); await component.apply(9);
    library.list.and.resolveTo([{ ...row(), name: "Updated by a teammate", version: 2 }]);
    await component.load();
    expect(component.selected()).toBeNull(); expect(component.selectionId()).toBeNull();
    expect(component.message()).toContain("cambió"); expect(component.spec()).toEqual(DEFAULT_QR_DESIGN);
    await component.apply(9); expect(component.selected()?.version).toBe(2); fixture.destroy();
  });
});
