import { Component, EventEmitter, Input, Output } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { HCaptchaWidgetComponent } from "../auth/hcaptcha-widget.component";
import { ApiService } from "../core/services/api.service";
import { ReportComponent } from "./report.component";
@Component({ selector: "app-hcaptcha-widget", standalone: true, template: "" })
class TestCaptcha { @Input() siteKey = ""; @Output() readonly tokenChange = new EventEmitter<string>(); reset(): void { this.tokenChange.emit(""); } }
describe("Report interaction ownership", () => {
  let fixture: ComponentFixture<ReportComponent>, component: ReportComponent, host: HTMLElement, api: jasmine.SpyObj<ApiService>;
  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]); api.get.and.resolveTo({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000002" } });
    await TestBed.configureTestingModule({ imports: [ReportComponent], providers: [provideRouter([]), { provide: ApiService, useValue: api }] })
      .overrideComponent(ReportComponent, { remove: { imports: [HCaptchaWidgetComponent] }, add: { imports: [TestCaptcha] } }).compileComponents();
    fixture = TestBed.createComponent(ReportComponent); component = fixture.componentInstance; host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    component.form.setValue({ link: "incident-42", reason: "Otro", details: "Contexto inicial", email: "" }); component.onCaptchaToken("synthetic-token"); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it("locks admitted values while waiting and restores them on failure without duplicate commands", async () => {
    let reject!: (error: Error) => void; api.post.and.returnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const pending = component.submit(); fixture.detectChanges(); expect(component.form.disabled).toBeTrue(); expect(host.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    await component.submit(); expect(api.post).toHaveBeenCalledTimes(1); reject(new Error("Synthetic report failure")); await pending; fixture.detectChanges();
    expect(component.form.enabled).toBeTrue(); expect(component.form.getRawValue().details).toBe("Contexto inicial"); expect(component.captchaToken()).toBe(""); expect(component.done()).toBeFalse(); expect(api.post).toHaveBeenCalledTimes(1);
  });
  it("shows a dedicated focused receipt and starts another report only when requested", async () => {
    api.post.and.resolveTo({ ok: true }); await component.submit(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const receipt = host.querySelector<HTMLElement>(".report-receipt"); expect(receipt).not.toBeNull(); if (!receipt) return;
    expect(document.activeElement).toBe(receipt); expect(host.querySelector('[formControlName="link"]')).toBeNull();
    const next = receipt.querySelector<HTMLButtonElement>(".report-another"); expect(next).not.toBeNull(); if (!next) return;
    next.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.done()).toBeFalse(); expect(component.form.getRawValue().link).toBe(""); expect(document.activeElement).toBe(host.querySelector('[formControlName="link"]')); expect(api.post).toHaveBeenCalledTimes(1);
  });
  it("places the form before the process explanation in the DOM", () => {
    const form = host.querySelector(".report-card")!, process = host.querySelector(".report-process")!;
    expect(form.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
