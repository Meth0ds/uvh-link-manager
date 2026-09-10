import { Component, EventEmitter, Input, Output } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormControl } from "@angular/forms";
import { provideRouter } from "@angular/router";

import { HCaptchaWidgetComponent } from "../auth/hcaptcha-widget.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { normalizeReportReference, ReportComponent, reportReferenceValidator } from "./report.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

@Component({ selector: "app-hcaptcha-widget", standalone: true, template: "" })
class FakeHCaptchaWidgetComponent {
  @Input() siteKey = "";
  @Output() readonly tokenChange = new EventEmitter<string>();

  reset(): void {
    this.tokenChange.emit("");
  }
}

describe("abuse report reference", () => {
  it("normalizes aliases and short URLs without visiting their destination", () => {
    expect(normalizeReportReference("  Campana_24  ")).toBe("campana_24");
    expect(normalizeReportReference("go.example.test/incident-42")).toBe("https://go.example.test/incident-42");
  });

  it("accepts supported default, legacy and custom-domain references", () => {
    const accepted = [
      "incident-42",
      "https://uvh.es/incident-42?campaign=mail#source",
      "https://uvh.es/r/incident-42",
      "go.example.test/incident-42",
    ];

    for (const value of accepted) {
      expect(reportReferenceValidator(new FormControl(value, { nonNullable: true }))).withContext(value).toBeNull();
    }
  });

  it("rejects credentials, unsupported schemes and ambiguous paths", () => {
    const rejected = [
      "javascript:alert(1)",
      "https://user:secret@uvh.es/incident-42",
      "https://uvh.es/path/with/too-many-segments",
      "https://uvh.es/",
    ];

    for (const value of rejected) {
      expect(reportReferenceValidator(new FormControl(value, { nonNullable: true }))).withContext(value).toEqual({ reportReference: true });
    }
  });
});

describe("ReportComponent", () => {
  let fixture: ComponentFixture<ReportComponent>;
  let component: ReportComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({
      hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000002" },
    });
    api.post.and.resolveTo({ ok: true });

    await TestBed.configureTestingModule({
      imports: [ReportComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    })
      .overrideComponent(ReportComponent, {
        remove: { imports: [HCaptchaWidgetComponent] },
        add: { imports: [FakeHCaptchaWidgetComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ReportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("sends the normalized public contract and clears the form", async () => {
    component.form.setValue({
      link: "go.example.test/incident-42",
      reason: "Malware o software malicioso",
      details: "El enlace inicia una descarga inesperada. ",
      email: "reporter@example.test",
    });
    component.onCaptchaToken("report-captcha-token");

    await component.submit();

    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/report", {
      reportedUrl: "https://go.example.test/incident-42",
      reason: "Malware o software malicioso",
      details: "El enlace inicia una descarga inesperada.",
      email: "reporter@example.test",
      captchaToken: "report-captcha-token",
    });
    expect(component.done()).toBeTrue();
    expect(component.form.controls.link.value).toBe("");
  });

  it("exposes API errors without losing the submitted values", async () => {
    api.post.and.rejectWith(new ApiRequestError("Enlace no encontrado", 404));
    component.form.setValue({
      link: "missing-link",
      reason: "Otro",
      details: "",
      email: "",
    });
    component.onCaptchaToken("report-captcha-token");

    await component.submit();

    expect(component.error()).toBe("Enlace no encontrado");
    expect(component.done()).toBeFalse();
    expect(component.form.controls.link.value).toBe("missing-link");
    expect(component.busy()).toBeFalse();
    expect(component.captchaToken()).toBe("");
  });

  it("does not submit until hCaptcha has produced a token", async () => {
    component.form.setValue({
      link: "incident-42",
      reason: "Otro",
      details: "",
      email: "",
    });

    await component.submit();

    expect(api.post).not.toHaveBeenCalled();
    expect(component.error()).toContain("comprobación antiabuso");
  });

  it("focuses the missing link without sending an incomplete report", async () => {
    await component.submit();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[formControlName="link"]'));
    expect(component.form.controls.link.touched).toBeTrue();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("explains the selected reason without inviting unsafe investigation", () => {
    component.form.controls.reason.setValue("Malware o software malicioso");
    expect(component.selectedReasonHint).toContain("No descargues nada");
    component.form.controls.reason.setValue("__proto__");
    expect(component.selectedReasonHint).toContain("Si no estás seguro");
  });

  it("keeps context and contact email genuinely optional", async () => {
    component.form.setValue({ link: "incident-42", reason: "Otro", details: "", email: "" });
    component.onCaptchaToken("report-captcha-token");
    await component.submit();
    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/report", jasmine.objectContaining({ details: undefined, email: "", captchaToken: "report-captcha-token" }));
  });

  it("keeps the newest hCaptcha configuration", async () => {
    component.hcaptchaSiteKey.set("");
    const older = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    const newer = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    api.get.and.returnValues(older.promise, newer.promise);

    const first = component.loadCaptchaConfiguration();
    const second = component.loadCaptchaConfiguration();
    newer.resolve({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000002" } });
    await second;
    older.resolve({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000003" } });
    await first;

    expect(component.hcaptchaSiteKey()).toBe("10000000-ffff-ffff-ffff-000000000002");
  });

  it("does not reset or mark a destroyed report view as completed", async () => {
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    component.form.setValue({ link: "safe-alias", reason: "Otro", details: "", email: "" });
    component.onCaptchaToken("captcha-token");

    const submission = component.submit();
    fixture.destroy();
    response.resolve({});
    await submission;

    expect(component.done()).toBeFalse();
    expect(component.form.controls.link.value).toBe("safe-alias");
  });
});
