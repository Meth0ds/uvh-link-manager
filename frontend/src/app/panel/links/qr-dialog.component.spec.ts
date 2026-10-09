import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA } from "@angular/material/dialog";
import QRCode from "qrcode";
import { QrDialogComponent } from "./qr-dialog.component";
import { QR_CODE_IMPORT, type QrCodeGenerator } from "../../core/services/qr-code.service";

describe("QrDialogComponent", () => {
  let fixture: ComponentFixture<QrDialogComponent>;
  afterEach(() => fixture?.destroy());

  async function create(importer: () => Promise<QrCodeGenerator> = () => Promise.resolve(QRCode)): Promise<QrDialogComponent> {
    await TestBed.configureTestingModule({
      imports: [QrDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: "https://uvh.test/a?name=bad%0Aname" },
        { provide: QR_CODE_IMPORT, useValue: importer },
      ],
    }).overrideComponent(QrDialogComponent, { set: { template: "", imports: [] } }).compileComponents();
    fixture = TestBed.createComponent(QrDialogComponent);
    return fixture.componentInstance;
  }

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
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 2048, includeLogo: true, errorCorrectionLevel: "H", margin: 4 }]);
    expect((click.calls.mostRecent().object as HTMLAnchorElement).href).toBe("data:image/png;base64,fixture-2048");
    expect(component.dataUrl()).toBe("data:image/png;base64,fixture-480");
  });

  it("does not duplicate a pending export or initiate a download after closure", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => resolve = done);
    const render = jasmine.createSpy("render").and.callFake((_text: string, options: { width: number }) => {
      if (options.width === 2048) return pending;
      return Promise.resolve("data:image/png;base64,preview");
    });
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    const click = spyOn(HTMLAnchorElement.prototype, "click");
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
    expect(render).toHaveBeenCalledTimes(2);
    fixture.destroy();
    resolve("data:image/png;base64,export");
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
      expect(render.calls.mostRecent().args).toEqual([component.url, { width: size, includeLogo: true, errorCorrectionLevel: "H", margin: 4 }]);
      expect((click.calls.mostRecent().object as HTMLAnchorElement).href).toBe(`data:image/png;base64,fixture-${size}`);
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
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 480, includeLogo: false, errorCorrectionLevel: "L", margin: 8 }]);
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(click).toHaveBeenCalledTimes(1);
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 1024, includeLogo: false, errorCorrectionLevel: "L", margin: 8 }]);
    component.setIncludeLogo(true);
    expect(component.correctionLevel()).toBe("H");
    await component.resetOptions();
    await fixture.whenStable();
    expect(component.isDefault()).toBeTrue();
    expect(render.calls.mostRecent().args).toEqual([component.url, { width: 480, includeLogo: true, errorCorrectionLevel: "H", margin: 4 }]);
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
    let attempts = 0;
    const render = jasmine.createSpy("render").and.callFake((_text: string, options: { width: number }) => {
      if (options.width === 480) return Promise.resolve("data:image/png;base64,preview");
      return ++attempts === 1 ? Promise.reject(new Error("Fixture export")) : Promise.resolve("data:image/png;base64,export");
    });
    const component = await create(() => Promise.resolve({ toDataURL: render }));
    await fixture.whenStable();
    const click = spyOn(HTMLAnchorElement.prototype, "click");
    await component.download();
    expect(component.dataUrl()).toBe("data:image/png;base64,preview");
    expect(component.error()).toContain("PNG");
    expect(click).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(2);
    await component.download();
    expect(render).toHaveBeenCalledTimes(3);
    expect(click).toHaveBeenCalledTimes(1);
    expect(component.error()).toBeNull();
  });
});
