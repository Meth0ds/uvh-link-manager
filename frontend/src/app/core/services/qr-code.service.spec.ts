import { TestBed } from "@angular/core/testing";
import { QR_CODE_IMPORT, QrCodeService, type QrCodeGenerator } from "./qr-code.service";

describe("QR library loading", () => {
  it("does not fetch code on injection and coalesces concurrent and later consumers", async () => {
    let resolve!: (value: QrCodeGenerator) => void;
    const importer = jasmine.createSpy("importer").and.returnValue(new Promise<QrCodeGenerator>(done => resolve = done));
    const generator = { toDataURL: jasmine.createSpy("render") } as QrCodeGenerator;
    TestBed.configureTestingModule({ providers: [{ provide: QR_CODE_IMPORT, useValue: importer }] });
    const service = TestBed.inject(QrCodeService);
    expect(importer).not.toHaveBeenCalled();
    const first = service.load(), second = service.load();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(1);
    resolve(generator);
    expect(await first).toBe(generator);
    expect(await service.load()).toBe(generator);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("releases a rejected attempt for a future explicit load without automatically retrying", async () => {
    const error = new Error("Fixture chunk failure");
    const generator = { toDataURL: jasmine.createSpy("render") } as QrCodeGenerator;
    const importer = jasmine.createSpy("importer").and.returnValues(Promise.reject(error), Promise.resolve(generator));
    TestBed.configureTestingModule({ providers: [{ provide: QR_CODE_IMPORT, useValue: importer }] });
    const service = TestBed.inject(QrCodeService);
    const first = service.load(), second = service.load();
    await expectAsync(first).toBeRejectedWith(error);
    await expectAsync(second).toBeRejectedWith(error);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(await service.load()).toBe(generator);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous loader error into the same controlled rejection boundary", async () => {
    const importer = jasmine.createSpy("importer").and.throwError("Fixture loader");
    TestBed.configureTestingModule({ providers: [{ provide: QR_CODE_IMPORT, useValue: importer }] });
    await expectAsync(TestBed.inject(QrCodeService).load()).toBeRejectedWithError("Fixture loader");
  });

  it("loads the production module and renders a PNG with the requested dimensions", async () => {
    const generator = await TestBed.inject(QrCodeService).load();
    const data = await generator.toDataURL("https://uvh.test/fixture", { width: 240, margin: 1 });
    expect(data).toMatch(/^data:image\/png;base64,/);
    const bytes = Uint8Array.from(atob(data.split(",")[1]), char => char.charCodeAt(0));
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = new DataView(bytes.buffer);
    expect(dimensions.getUint32(16)).toBe(240);
    expect(dimensions.getUint32(20)).toBe(240);
  });
});
