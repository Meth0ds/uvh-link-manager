import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA } from "@angular/material/dialog";
import QRCode from "qrcode";
import { SessionContextService } from "../../core/services/session-context.service";
import { provideHttpClient } from "@angular/common/http";
import { QrDialogComponent } from "./qr-dialog.component";
import { QrCodeService, QR_CODE_IMPORT, type QrCodeGenerator } from "../../core/services/qr-code.service";
import { QrLibraryService, type QrVariant } from "../../core/services/qr-library.service";
import { DEFAULT_QR_DESIGN } from "../../core/services/qr-design";

describe("QrDialogComponent", () => {
  let fixture: ComponentFixture<QrDialogComponent>;
  let exportQr: jasmine.Spy;
  afterEach(() => fixture?.destroy());

  async function create(importer: () => Promise<QrCodeGenerator> = () => Promise.resolve(QRCode)): Promise<QrDialogComponent> {
    await TestBed.configureTestingModule({
      imports: [QrDialogComponent],
      providers: [
        provideHttpClient(),
        { provide: MAT_DIALOG_DATA, useValue: "https://uvh.test/a?name=bad%0Aname" },
        { provide: QR_CODE_IMPORT, useValue: importer },
      ],
    }).overrideComponent(QrDialogComponent, { set: { template: "", imports: [] } }).compileComponents();
    exportQr = spyOn(TestBed.inject(QrCodeService), "export").and.resolveTo(new Blob(["fixture PNG"], { type: "image/png" }));
    spyOn(URL, "createObjectURL").and.returnValue("blob:qr-fixture");
    fixture = TestBed.createComponent(QrDialogComponent);
    return fixture.componentInstance;
  }

  it("applies the confirmed campaign design before allowing an export", async () => {
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,preview");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable(); component.campaignMode.set(true);
    component.caption.set("  Café  ");
    const variant: QrVariant = { id: 1, linkId: 1, publicId: "a".repeat(32), name: "Carta", spec: { ...DEFAULT_QR_DESIGN, frame: "caption", caption: "Café" }, version: 1, archived: false, createdAt: "2026-10-10", updatedAt: "2026-10-10" };
    await component.campaignSaved(variant);
    expect(component.caption()).toBe("Café"); expect(component.campaignReady()).toBeTrue();
    expect(new URL(component.url).searchParams.get("qr")).toBe(variant.publicId);
    expect(component.canonicalBusy()).toBeFalse();
  });

  it("retries the saved campaign logo without another campaign mutation", async () => {
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,preview");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable(); component.campaignMode.set(true);
    const library = TestBed.inject(QrLibraryService), prepared = spyOn(library, "preparedLogo").and.rejectWith(new Error("Unavailable"));
    const createVariant = spyOn(library, "createVariant"), updateVariant = spyOn(library, "updateVariant");
    const variant: QrVariant = { id: 1, linkId: 1, publicId: "a".repeat(32), name: "Carta", spec: { ...DEFAULT_QR_DESIGN, logo: { kind: "custom", assetId: 3 } }, version: 1, archived: false, createdAt: "2026-10-10", updatedAt: "2026-10-10" };
    await component.campaignSaved(variant); expect(component.dataUrl()).toBeNull();
    prepared.and.resolveTo({ canvas: document.createElement("canvas"), preview: "", name: "Logo" });
    await component.retryPreview();
    expect(prepared).toHaveBeenCalledTimes(2); expect(component.customLogo()).not.toBeNull();
    expect(component.campaignReady()).toBeTrue(); expect(component.error()).toBeNull();
    expect(createVariant).not.toHaveBeenCalled(); expect(updateVariant).not.toHaveBeenCalled();
  });

  it("leaves the spinner state and exposes a controlled error when generation fails", async () => {
    const generator = spyOn(QRCode, "toDataURL") as jasmine.Spy;
    generator.and.rejectWith(new Error("Fixture: QR capacity"));
    const component = await create();
    await fixture.whenStable();

    expect(component.dataUrl()).toBeNull();
    expect(component.error()).toContain("No se pudo generar");
  });

  it("does not update signals after the dialog has been destroyed", async () => {
    let resolve!: (value: string) => void;
    let rendering!: () => void;
    const started = new Promise<void>(done => rendering = done);
    const generator = spyOn(QRCode, "toDataURL") as jasmine.Spy;
    generator.and.callFake(() => { rendering(); return new Promise<string>(done => resolve = done); });
    const component = await create();
    await started;
    fixture.destroy();
    resolve("data:image/png;base64,fixture");
    await Promise.resolve();

    expect(component.dataUrl()).toBeNull();
    expect(component.error()).toBeNull();
  });

  it("sanitizes the untrusted URL suffix used as a download filename", async () => {
    const generator = spyOn(QRCode, "toDataURL") as jasmine.Spy;
    generator.and.resolveTo("data:image/png;base64,fixture");
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    const component = await create();
    await fixture.whenStable();

    await component.download();

    const anchor = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^uvh-[A-Za-z0-9._-]+\.png$/);
    expect(anchor.download).not.toContain("%0A");
  });

  it("leaves loading and keeps download unavailable after a library import failure", async () => {
    const importer = jasmine.createSpy("importer").and.callFake(() => Promise.reject(new Error("Fixture chunk")));
    const component = await create(importer);
    await fixture.whenStable();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(component.dataUrl()).toBeNull();
    expect(component.error()).toContain("No se pudo generar");
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    component.download();
    expect(click).not.toHaveBeenCalled();
  });

  it("does not start rendering after a closed dialog's pending import settles", async () => {
    let loaded!: (value: QrCodeGenerator) => void;
    const importer = jasmine.createSpy("importer").and.returnValue(new Promise<QrCodeGenerator>(done => loaded = done));
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,fixture");
    const component = await create(importer);
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(1);
    fixture.destroy(); loaded({ toDataURL: render } as QrCodeGenerator);
    await new Promise<void>(done => setTimeout(done, 0));
    expect(render).not.toHaveBeenCalled();
    expect(component.dataUrl()).toBeNull();
    expect(component.error()).toBeNull();
  });

  it("generates a separate 2048px download only on demand and keeps its 480px preview", async () => {
    const render = jasmine.createSpy("render").and.callFake((_text: string, options: { width: number }) =>
      Promise.resolve(`data:image/png;base64,fixture-${options.width}`));
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.calls.mostRecent().args[1].width).toBe(480);
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(render).toHaveBeenCalledTimes(1);
    expect(exportQr).toHaveBeenCalledOnceWith(component.url, component.design(), "png", jasmine.objectContaining({ pixels: 2048 }));
    expect((click.calls.mostRecent().object as HTMLAnchorElement).href).toBe("blob:qr-fixture");
    expect(component.dataUrl()).toBe("data:image/png;base64,fixture-480");
  });

  it("does not duplicate a pending export or initiate a download after closure", async () => {
    let resolve!: (value: Blob) => void;
    const pending = new Promise<Blob>(done => resolve = done);
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,preview");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    exportQr.and.returnValue(pending);
    const first = component.download(), second = component.download();
    component.selectDownloadSize(512);
    component.setIncludeLogo(false);
    component.selectQuietZone(8);
    component.resetOptions();
    expect(component.downloadSize()).toBe(2048);
    expect(component.includeLogo()).toBeTrue();
    expect(component.quietZone()).toBe(4);
    await Promise.resolve();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1); expect(exportQr).toHaveBeenCalledTimes(1);
    fixture.destroy();
    resolve(new Blob(["export"], { type: "image/png" }));
    await Promise.all([first, second]);
    expect(click).not.toHaveBeenCalled();
    expect(component.error()).toBeNull();
    expect(component.dataUrl()).toBe("data:image/png;base64,preview");
  });

  it("exports the chosen resolution without regenerating the preview or accepting unsupported sizes", async () => {
    const render = jasmine.createSpy("render").and.callFake((_text: string, options: { width: number }) =>
      Promise.resolve(`data:image/png;base64,fixture-${options.width}`));
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    for (const size of [512, 1024, 4096]) {
      const calls = render.calls.count();
      component.selectDownloadSize(size);
      component.selectDownloadSize(-1);
      component.selectDownloadSize(65536);
      expect(component.downloadSize()).toBe(size);
      expect(render.calls.count()).toBe(calls);
      await component.download();
      expect(exportQr.calls.mostRecent().args).toEqual([component.url, component.design(), "png", jasmine.objectContaining({ pixels: size })]);
      expect((click.calls.mostRecent().object as HTMLAnchorElement).href).toBe("blob:qr-fixture");
      expect(render.calls.count()).toBe(calls);
      expect(component.dataUrl()).toBe("data:image/png;base64,fixture-480");
    }
  });

  it("uses the selected plain-QR options in both preview and export and restores safe logo defaults", async () => {
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,fixture");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    component.selectCorrectionLevel("L");
    expect(component.correctionLevel()).toBe("H");
    component.setIncludeLogo(false);
    component.selectCorrectionLevel("L");
    component.selectCorrectionLevel("invalid");
    await component.selectQuietZone(8);
    component.selectQuietZone(0);
    component.selectDownloadSize(1024);
    await fixture.whenStable();
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 480, includeLogo: false, errorCorrectionLevel: "L", margin: 8, design: component.design() }]);
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(click).toHaveBeenCalledTimes(1);
    expect(exportQr.calls.mostRecent().args).toEqual([component.url, component.design(), "png", jasmine.objectContaining({ pixels: 1024 })]);
    component.setIncludeLogo(true);
    expect(component.correctionLevel()).toBe("H");
    await component.resetOptions();
    await fixture.whenStable();
    expect(component.isDefault()).toBeTrue();
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 480, includeLogo: true, errorCorrectionLevel: "H", margin: 4, design: component.design() }]);
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`ignores a stale preview ${outcome} after newer options have rendered`, async () => {
      let resolve!: (value: string) => void, reject!: (reason: Error) => void;
      const pending = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
      const render = jasmine.createSpy("render").and.callFake((_text: string, options: { margin: number }) =>
        options.margin === 6 ? pending : Promise.resolve(`data:image/png;base64,margin-${options.margin}`));
      const component = await create(() => Promise.resolve({ toDataURL: render }));
      await fixture.whenStable();
      const click = spyOn(HTMLAnchorElement.prototype, "click");
      component.selectQuietZone(6);
      await Promise.resolve();
      expect(component.previewBusy()).toBeTrue();
      await component.download();
      expect(click).not.toHaveBeenCalled();
      component.selectQuietZone(8);
      await Promise.resolve(); await Promise.resolve();
      expect(component.dataUrl()).toBe("data:image/png;base64,margin-8");
      expect(component.previewBusy()).toBeFalse();
      if (outcome === "success") resolve("data:image/png;base64,margin-6");
      else reject(new Error("Stale fixture preview"));
      await Promise.resolve(); await Promise.resolve();
      expect(component.dataUrl()).toBe("data:image/png;base64,margin-8");
      expect(component.error()).toBeNull();
      expect(component.previewBusy()).toBeFalse();
    });
  }

  it("removes an obsolete preview on current generation failure and retries the selected options explicitly", async () => {
    let attempts = 0;
    const render = jasmine.createSpy("render").and.callFake((_text: string, options: { margin: number }) =>
      options.margin === 8 && ++attempts === 1 ? Promise.reject(new Error("Fixture preview")) : Promise.resolve("data:image/png;base64,fixture"));
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    await component.selectQuietZone(8);
    await fixture.whenStable();
    expect(component.dataUrl()).toBeNull();
    expect(component.error()).toContain("No se pudo generar");
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(click).not.toHaveBeenCalled();
    await component.retryPreview();
    await fixture.whenStable();
    expect(component.error()).toBeNull();
    expect(component.dataUrl()).toContain("data:image/png");
    expect(component.quietZone()).toBe(8);
  });

  it("keeps a valid preview after export failure and retries only on a new download action", async () => {
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,preview");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    exportQr.and.rejectWith(new Error("Fixture export"));
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(component.dataUrl()).toBe("data:image/png;base64,preview");
    expect(component.error()).toContain("PNG");
    expect(click).not.toHaveBeenCalled();
    expect(exportQr).toHaveBeenCalledTimes(1);
    exportQr.and.resolveTo(new Blob(["PNG"]));
    await component.download();
    expect(exportQr).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(component.error()).toBeNull();
  });
  it("cancels a pending PNG export without downloading a late result", async () => {
    const component = await create(); await fixture.whenStable();
    let resolve!: (value: Blob) => void;
    exportQr.and.returnValue(new Promise<Blob>(done => resolve = done));
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    const pending = component.download(); await Promise.resolve(); await Promise.resolve();
    component.cancelExport(); resolve(new Blob(["late PNG"])); await pending;
    expect(click).not.toHaveBeenCalled(); expect(component.downloadBusy()).toBeFalse();
    expect(component.confirmation()).toContain("cancelada");
  });

  async function logoFile(): Promise<File> {
    const canvas = document.createElement("canvas");
    canvas.width = 120; canvas.height = 60;
    canvas.getContext("2d")!.fillRect(0, 0, 120, 60);
    const blob = await new Promise<Blob>(done => canvas.toBlob(blob => done(blob!), "image/png"));
    return new File([blob], "brand.png", { type: "image/png" });
  }

  function upload(component: QrDialogComponent, file: File): Promise<void> {
    return component.uploadLogo({ target: { files: [file], value: "fixture" } } as unknown as Event);
  }

  it("requires an actual custom logo and exports the same normalized canvas used in preview", async () => {
    const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,fixture");
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    await component.selectLogoSource("custom");
    expect(component.dataUrl()).toBeNull(); expect(component.needsCustomLogo()).toBeTrue();
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download(); expect(click).not.toHaveBeenCalled();
    await upload(component, await logoFile());
    expect(component.needsCustomLogo()).toBeFalse();
    const canvas = component.customLogo()!.canvas;
    expect(render.calls.mostRecent().args[1].customLogo).toBe(canvas);
    await component.download();
    expect(exportQr.calls.mostRecent().args[1]).toEqual(component.design());
    expect(exportQr.calls.mostRecent().args[3]).toEqual(jasmine.objectContaining({ pixels: 2048, logo: jasmine.objectContaining({ width: canvas.width, height: canvas.height, png: jasmine.any(Uint8Array) }) }));
    expect(click).toHaveBeenCalledTimes(1);
    await component.setIncludeLogo(false);
    expect(render.calls.mostRecent().args[1].customLogo).toBeUndefined();
    await component.resetOptions();
    expect(component.customLogo()).toBeNull(); expect(component.logoSource()).toBe("uvh"); expect(component.isDefault()).toBeTrue();
  });

  it("keeps a previously valid custom logo when replacement is invalid", async () => {
    const component = await create(); await fixture.whenStable();
    await component.selectLogoSource("custom");
    await upload(component, await logoFile());
    const logo = component.customLogo(), preview = component.dataUrl();
    await upload(component, new File(["<svg/>"], "fake.png", { type: "image/png" }));
    expect(component.customLogo()).toBe(logo); expect(component.dataUrl()).toBe(preview);
    expect(component.logoError()).toContain("PNG o JPG"); expect(component.logoBusy()).toBeFalse();
    await component.removeCustomLogo(); expect(component.dataUrl()).toBeNull(); expect(component.logoError()).toBeNull();
  });

  for (const action of ["replace", "reset", "switch", "remove", "close"] as const) {
    it(`ignores a pending logo read after ${action} and blocks download during preparation`, async () => {
      const component = await create(); await fixture.whenStable();
      await component.selectLogoSource("custom");
      const file = await logoFile();
      let resolve!: (bytes: ArrayBuffer) => void;
      const bytes = await file.arrayBuffer();
      spyOn(file, "arrayBuffer").and.returnValue(new Promise<ArrayBuffer>(done => resolve = done));
      const pending = upload(component, file);
      expect(component.logoBusy()).toBeTrue();
      const click = spyOn(HTMLAnchorElement.prototype, "click");
      await component.download(); expect(click).not.toHaveBeenCalled();
      if (action === "replace") await upload(component, await logoFile());
      if (action === "reset") await component.resetOptions();
      if (action === "switch") await component.selectLogoSource("uvh");
      if (action === "remove") await component.removeCustomLogo();
      if (action === "close") fixture.destroy();
      const current = component.customLogo(), preview = component.dataUrl();
      resolve(bytes); await pending;
      expect(component.customLogo()).toBe(current); expect(component.dataUrl()).toBe(preview); expect(component.logoError()).toBeNull();
    });
  }

  it("invalidates a late vector result as soon as the session changes", async () => {
    const component = await create(() => Promise.resolve({ toDataURL: () => Promise.resolve("data:image/png;base64,preview") }));
    await fixture.whenStable(); component.format.set("svg");
    let resolve!: (value: Blob) => void;
    const exportSpy = exportQr.and.returnValue(new Promise<Blob>(done => resolve = done));
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    const pending = component.downloadVectorOrPrint(); await Promise.resolve(); await Promise.resolve();
    expect(exportSpy).toHaveBeenCalled(); TestBed.inject(SessionContextService).advance();
    resolve(new Blob(["<svg/>"], { type: "image/svg+xml" })); await pending;
    expect(click).not.toHaveBeenCalled();
  });

});
