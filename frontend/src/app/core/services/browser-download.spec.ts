import { fakeAsync, tick } from "@angular/core/testing";
import { downloadBlob } from "./browser-download";

describe("downloadBlob", () => {
  it("does not revoke the object URL before the browser consumes the click", fakeAsync(() => {
    const create = spyOn(URL, "createObjectURL").and.returnValue("blob:fixture");
    const revoke = spyOn(URL, "revokeObjectURL");
    const click = spyOn(HTMLAnchorElement.prototype, "click");

    expect(downloadBlob(new Blob(["safe"]), "export.json")).toBeTrue();
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    tick(1_000);
    expect(revoke).toHaveBeenCalledOnceWith("blob:fixture");
  }));

  it("revokes immediately and reports failure when the click is rejected", () => {
    spyOn(URL, "createObjectURL").and.returnValue("blob:fixture");
    const revoke = spyOn(URL, "revokeObjectURL");
    spyOn(HTMLAnchorElement.prototype, "click").and.throwError("Fixture: blocked");

    expect(downloadBlob(new Blob(["safe"]), "export.json")).toBeFalse();
    expect(revoke).toHaveBeenCalledOnceWith("blob:fixture");
  });

  it("removes control characters and path separators from suggested filenames", () => {
    spyOn(URL, "createObjectURL").and.returnValue("blob:fixture");
    spyOn(URL, "revokeObjectURL");
    const click = spyOn(HTMLAnchorElement.prototype, "click");

    expect(downloadBlob(new Blob(), "../bad\nname.json")).toBeTrue();
    const anchor = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(anchor.download).toBe("..-bad-name.json");
  });
});
