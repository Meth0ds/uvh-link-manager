import { signal, type WritableSignal } from "@angular/core";
import { ComponentFixture, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";

import type { LinkDto } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
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
  let workspaceId: WritableSignal<number | null>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.resolveTo({ domains: [] } as never);
    api.post.and.resolveTo({ link: {} as LinkDto } as never);
    dialogRef = jasmine.createSpyObj<MatDialogRef<LinkDialogComponent>>("MatDialogRef", ["close"]);
    workspaceId = signal(1);

    TestBed.configureTestingModule({
      imports: [LinkDialogComponent],
      providers: [
        FormBuilder,
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: WorkspaceService, useValue: { currentId: workspaceId } },
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

  it("refuses to create a link that would be born expired", async () => {
    component.form.controls.destination.setValue("https://example.test");
    component.form.controls.expiresAt.setValue("2020-01-01T10:00");
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeTrue();

    await component.save();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("re-judges an expiry that lapsed while the dialog sat open", async () => {
    component.form.controls.destination.setValue("https://example.test");
    component.form.controls.expiresAt.setValue("2030-01-01T10:00");
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeFalse();

    // The wall clock passes the chosen expiry while the dialog is open: save
    // must judge the form against the present, not against the typing moment.
    spyOn(Date, "now").and.returnValue(new Date(2030, 0, 2).getTime());
    await component.save();

    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeTrue();
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

  it("refuses to save into a workspace selected after the dialog opened", async () => {
    component.form.controls.destination.setValue("https://example.test");
    // El selector global cambia con el modal abierto: guardar pertenece al
    // workspace de apertura y jamás debe crear el enlace en el nuevo.
    workspaceId.set(2);

    await component.save();

    expect(api.post).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it("asks for a random alias with null when creating without one", async () => {
    component.form.controls.destination.setValue("https://example.test");
    await component.save();

    const payload = api.post.calls.mostRecent().args[1] as { alias: string | null };
    expect(payload.alias).toBeNull();
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

describe("LinkDialogComponent edit-mode alias contract", () => {
  it("refuses to clear the alias instead of promising a deletion", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.callFake(((url: string) =>
      Promise.resolve(url.includes("/api/v1/domains") ? { domains: [] } : { rules: [] })) as never);
    api.patch.and.resolveTo({ link: {} as LinkDto } as never);
    const dialogRef = jasmine.createSpyObj<MatDialogRef<LinkDialogComponent>>("MatDialogRef", ["close"]);
    const link = {
      id: 7,
      alias: "kept-alias",
      destination: "https://example.test",
      domainId: null,
      fallbackDestination: null,
      maxClicks: null,
      singleUse: false,
      scheduledAt: null,
      expiresAt: null,
      notes: null,
      passwordProtected: false,
      utm: { source: null, medium: null, campaign: null, term: null, content: null },
      tags: [],
    } as unknown as LinkDto;

    TestBed.configureTestingModule({
      imports: [LinkDialogComponent],
      providers: [
        FormBuilder,
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { mode: "edit", link } },
      ],
    });
    const fixture = TestBed.createComponent(LinkDialogComponent);
    await fixture.whenStable();

    // Emptying the alias blocks saving: the server keeps the current alias,
    // and the dialog must not suggest that clearing it deletes anything.
    fixture.componentInstance.form.controls.alias.setValue("");
    expect(fixture.componentInstance.form.controls.alias.hasError("required")).toBeTrue();
    await fixture.componentInstance.save();
    expect(api.patch).not.toHaveBeenCalled();

    fixture.componentInstance.form.controls.alias.setValue("kept-alias");
    await fixture.componentInstance.save();
    expect(api.patch).toHaveBeenCalled();
    const payload = api.patch.calls.mostRecent().args[1] as { alias?: string | null };
    expect(payload.alias).toBe("kept-alias");

    fixture.destroy();
  });

  it("keeps an expired link editable instead of forcing a life extension", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.callFake(((url: string) =>
      Promise.resolve(url.includes("/api/v1/domains") ? { domains: [] } : { rules: [] })) as never);
    api.patch.and.resolveTo({ link: {} as LinkDto } as never);
    const dialogRef = jasmine.createSpyObj<MatDialogRef<LinkDialogComponent>>("MatDialogRef", ["close"]);
    const link = {
      id: 8,
      alias: "old-alias",
      destination: "https://example.test",
      domainId: null,
      fallbackDestination: null,
      maxClicks: null,
      singleUse: false,
      scheduledAt: null,
      expiresAt: "2020-01-01T10:00:00Z",
      notes: null,
      passwordProtected: false,
      utm: { source: null, medium: null, campaign: null, term: null, content: null },
      tags: [],
    } as unknown as LinkDto;

    TestBed.configureTestingModule({
      imports: [LinkDialogComponent],
      providers: [
        FormBuilder,
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { mode: "edit", link } },
      ],
    });
    const fixture = TestBed.createComponent(LinkDialogComponent);
    await fixture.whenStable();

    const expires = fixture.componentInstance.form.controls.expiresAt;
    expect(expires.value).not.toBe("");
    expect(expires.hasError("pastDateTime")).toBeFalse();
    await fixture.componentInstance.save();
    expect(api.patch).toHaveBeenCalled();

    fixture.destroy();
  });
});
