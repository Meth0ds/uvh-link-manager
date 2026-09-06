import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA } from "@angular/material/dialog";
import QRCode from "qrcode";
import { QrDialogComponent } from "./qr-dialog.component";

describe("QrDialogComponent", () => {
  let fixture: ComponentFixture<QrDialogComponent>;

  async function create(): Promise<QrDialogComponent> {
    await TestBed.configureTestingModule({
      imports: [QrDialogComponent],
      providers: [{ provide: MAT_DIALOG_DATA, useValue: "https://uvh.test/a?name=bad%0Aname" }],
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
    const generator = spyOn(QRCode, "toDataURL") as jasmine.Spy;
    generator.and.returnValue(new Promise<string>((done) => { resolve = done; }));
    const component = await create();
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

    component.download();

    const anchor = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^uvh-[A-Za-z0-9._-]+\.png$/);
    expect(anchor.download).not.toContain("%0A");
  });
});
