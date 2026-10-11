import { TestBed } from "@angular/core/testing";
import { QR_SHARE_PLATFORM, QrShareService, type QrSharePlatform } from "./qr-share.service";

describe("QrShareService", () => {
  let nativeShare: jasmine.Spy, canShare: jasmine.Spy, platform: QrSharePlatform, service: QrShareService;
  const png = () => new Blob(["PNG fixture"], { type: "image/png" });

  beforeEach(() => {
    nativeShare = jasmine.createSpy("nativeShare").and.resolveTo(undefined);
    canShare = jasmine.createSpy("canShare").and.returnValue(true);
    platform = { secureContext: () => true, canShare, share: nativeShare };
    TestBed.configureTestingModule({ providers: [{ provide: QR_SHARE_PLATFORM, useValue: platform }] });
    service = TestBed.inject(QrShareService);
  });

  it("passes the existing PNG synchronously to native share without a URL or application promise", async () => {
    const file = service.file(png());
    const operation = service.share(file);
    expect(nativeShare).toHaveBeenCalledOnceWith({ files: [file], title: "Código QR de UVH" });
    expect(file.name).toBe("uvh-qr.png"); expect(file.type).toBe("image/png");
    expect(await file.text()).toBe("PNG fixture");
    expect(await operation).toBe("shared");
  });

  it("requires a secure context and the file-sharing capabilities", async () => {
    const file = service.file(png());
    platform.secureContext = () => false;
    expect(service.unavailableReason()).toContain("segura");
    expect(await service.share(file)).toBe("unsupported");
    platform.secureContext = () => true; delete platform.canShare;
    expect(service.unavailableReason()).toContain("archivos");
    expect(await service.share(file)).toBe("unsupported");
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it("checks capability for the actual file and controls capability exceptions", async () => {
    const file = service.file(png());
    canShare.and.returnValue(false);
    expect(await service.share(file)).toBe("unsupported");
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    canShare.and.throwError("Unsupported payload");
    expect(await service.share(file)).toBe("unsupported");
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it("rejects empty or non-PNG payloads", () => {
    expect(() => service.file(new Blob([], { type: "image/png" }))).toThrowError(/PNG válida/);
    expect(() => service.file(new Blob(["<svg/>"], { type: "image/svg+xml" }))).toThrowError(/PNG válida/);
  });

  for (const [name, outcome] of [["AbortError", "cancelled"], ["NotAllowedError", "denied"], ["SecurityError", "denied"], ["DataError", "failed"]] as const) {
    it(`handles ${name} without a rejected share promise`, async () => {
      nativeShare.and.rejectWith(new DOMException("Native fixture", name));
      expect(await service.share(service.file(png()))).toBe(outcome);
    });
  }

  it("handles a synchronous native failure", async () => {
    nativeShare.and.throwError(new DOMException("Activation unavailable", "NotAllowedError"));
    expect(await service.share(service.file(png()))).toBe("denied");
  });
});
