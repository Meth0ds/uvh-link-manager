import { ComponentFixture, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";

import type { LinkDto } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { LinkDialogComponent } from "./link-dialog.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

describe("LinkDialogComponent form and async safety", () => {
  let api: jasmine.SpyObj<ApiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<LinkDialogComponent>>;
  let fixture: ComponentFixture<LinkDialogComponent>;
  let component: LinkDialogComponent;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.resolveTo({ domains: [] } as never);
    api.post.and.resolveTo({ link: {} as LinkDto } as never);
    dialogRef = jasmine.createSpyObj<MatDialogRef<LinkDialogComponent>>("MatDialogRef", ["close"]);

    TestBed.configureTestingModule({
      imports: [LinkDialogComponent],
      providers: [
        FormBuilder,
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { mode: "create" } },
      ],
    });
    fixture = TestBed.createComponent(LinkDialogComponent);
    component = fixture.componentInstance;
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    if (!fixture.componentRef.hostView.destroyed) fixture.destroy();
  });

  it("rejects invalid local dates and non-increasing lifecycle windows", async () => {
    component.form.controls.destination.setValue("https://example.test");
    component.form.controls.scheduledAt.setValue("2026-02-30T10:00");
    expect(component.form.controls.scheduledAt.hasError("localDateTime")).toBeTrue();

    component.form.controls.scheduledAt.setValue("2026-09-05T12:00");
    component.form.controls.expiresAt.setValue("2026-09-05T12:00");
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();

    await component.save();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("blocks malformed conditional rules but permits an empty destination as deletion", async () => {
    component.form.controls.destination.setValue("https://example.test");
    const rule = component.ruleForms[0];
    rule.patchValue({ country: "ESP", timeFrom: "25:00", destination: "javascript:alert(1)" });
    expect(component.rules.invalid).toBeTrue();

    await component.save();
    expect(api.post).not.toHaveBeenCalled();

    rule.reset({
      priority: 0, country: "ESP", language: "", device: "", os: "", timeFrom: "25:00", timeTo: "",
      referrer: "", campaign: "", destination: "",
    });
    expect(component.rules.invalid).toBeTrue();
    expect(component.hasInvalidRules).toBeFalse();
    await component.save();

    const payload = api.post.calls.mostRecent().args[1] as { rules: unknown[] };
    expect(payload.rules).toEqual([]);
  });

  it("enforces the server limits and case-insensitive tag identity", () => {
    const chipInput = { clear: jasmine.createSpy("clear") };
    component.addTag({ value: "Campaign", chipInput });
    component.addTag({ value: "campaign", chipInput });
    for (let index = 0; index < 25; index += 1) {
      component.addTag({ value: `tag-${index}`, chipInput });
      component.addRule();
    }

    expect(component.tags().length).toBe(20);
    expect(component.tags().filter((tag) => tag.toLowerCase() === "campaign").length).toBe(1);
    expect(component.rules.length).toBe(20);
  });

  it("does not close a destroyed dialog when a save finishes late", async () => {
    const response = deferred<{ link: LinkDto }>();
    api.post.and.returnValue(response.promise);
    component.form.controls.destination.setValue("https://example.test");

    const saving = component.save();
    fixture.destroy();
    response.resolve({ link: {} as LinkDto });
    await saving;

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("does not send a deferred alias check after destruction", fakeAsync(() => {
    component.form.controls.alias.setValue("safe-alias");
    fixture.destroy();
    tick(221);

    expect(api.post).not.toHaveBeenCalled();
  }));
});
