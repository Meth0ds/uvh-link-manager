import { defaultExpiredPage } from "../../core/link-workflows";
import { TestBed } from "@angular/core/testing";
import { ExpiredPageEditorComponent, validExpiredPage } from "./expired-page-editor.component";

describe("Expired page drafts", () => {
  it("validates retained settings even when customization is disabled", () => {
    const spec = defaultExpiredPage();
    expect(validExpiredPage(spec)).toBeTrue();
    spec.expired.title = "";
    expect(validExpiredPage(spec)).toBeFalse();
  });

  it("allows multiline messages but requires a complete optional button", () => {
    const spec = defaultExpiredPage(); spec.enabled = true;
    spec.expired.message = "Volvemos pronto.\nGracias por tu interés.";
    expect(validExpiredPage(spec)).toBeTrue();
    spec.expired.buttonLabel = "Visitar nuestra web";
    expect(validExpiredPage(spec)).toBeFalse();
    spec.expired.buttonUrl = "https://example.org/";
    expect(validExpiredPage(spec)).toBeTrue();
  });

  it("explicitly resets an invalid draft without enabling the public page", () => {
    const component = TestBed.runInInjectionContext(() => new ExpiredPageEditorComponent());
    component.change("title", "");
    expect(component.valid()).toBeFalse();
    component.reset();
    expect(component.spec()).toEqual(defaultExpiredPage());
    expect(component.valid()).toBeTrue();
  });
});
