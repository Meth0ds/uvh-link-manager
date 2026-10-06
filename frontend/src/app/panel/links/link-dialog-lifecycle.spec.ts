import { signal } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";

import type { LinkDto, LinkTemplateDto } from "../../core/models";
import { WorkspaceService } from "../../core/services/workspace.service";
import { localDateTimeValue } from "../../core/strict-wire";
import { ActionDialogService } from "../action-dialog.service";
import { LinkDialogComponent, type LinkDialogData } from "./link-dialog.component";

function existingLink(overrides: Partial<LinkDto> = {}): LinkDto {
  return {
    id: 7, alias: "kept-alias", destination: "https://example.test/target",
    fallbackDestination: null, state: "scheduled", clickCount: 0, maxClicks: null,
    singleUse: false, usedAt: null, scheduledAt: "2030-01-01T12:00:10.123Z",
    expiresAt: "2030-01-01T13:00:50.789Z", notes: null, passwordProtected: false,
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    domainId: null, domain: null, collectionId: null, collection: null, tags: [],
    createdAt: "2026-10-06T12:00:00.000Z", updatedAt: "2026-10-06T12:00:00.000Z",
    version: 13, shortUrl: "https://uvh.es/kept-alias", ...overrides,
  };
}

/** Real form, API client and JSON HTTP serialization; no real server/accounts. */
describe("Link dialog lifecycle HTTP consumer", () => {
  let fixture: ComponentFixture<LinkDialogComponent>;
  let http: HttpTestingController;
  let data: LinkDialogData;
  let dialog: jasmine.SpyObj<MatDialogRef<LinkDialogComponent>>;
  let actions: jasmine.SpyObj<ActionDialogService>;
  const workspaceId = signal<number | null>(1);

  beforeEach(() => {
    workspaceId.set(1);
    data = { mode: "edit", link: existingLink() };
    dialog = jasmine.createSpyObj("MatDialogRef", ["close"]);
    actions = jasmine.createSpyObj("ActionDialogService", ["prompt"]);
    actions.prompt.and.resolveTo("Campaign");
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({
      imports: [LinkDialogComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: WorkspaceService, useValue: { currentId: workspaceId, selectionGeneration: () => 0 } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialog },
        { provide: ActionDialogService, useValue: actions },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
  });

  function open(overrides: Partial<LinkDto> = {}, create = false): LinkDialogComponent {
    data.mode = create ? "create" : "edit";
    data.link = create ? undefined : existingLink(overrides);
    data.initialDestination = "https://example.test/target";
    fixture = TestBed.createComponent(LinkDialogComponent);
    http.expectOne("/api/v1/domains").flush({ domains: [] });
    http.expectOne("/api/v1/collections").flush({ collections: [] });
    http.expectOne("/api/v1/link-templates").flush({ templates: [] });
    if (!create) http.expectOne("/api/v1/links/7").flush({ rules: [] });
    flushMicrotasks();
    return fixture.componentInstance;
  }

  function send(component: LinkDialogComponent): Record<string, unknown> {
    void component.save();
    flushMicrotasks();
    const requests = http.match((request) => request.method === (component.isEdit ? "PATCH" : "POST"));
    expect(requests.length).toBe(1);
    if (!requests.length) return {};
    const request = requests[0];
    expect(request.request.url).toBe(component.isEdit ? "/api/v1/links/7" : "/api/v1/links");
    expect(request.request.headers.get("X-CSRF-Token")).toBe("fixture");
    const body = JSON.parse(request.request.serializeBody() as string) as Record<string, unknown>;
    request.flush({ link: existingLink() });
    flushMicrotasks();
    return body;
  }

  function template(scheduled: string | null, expires: string | null): LinkTemplateDto {
    return { id: 1, name: "Timed campaign", createdAt: "2026-10-06T12:00:00Z", payload: {
      destination: "https://example.test/campaign", scheduled_at: scheduled, expires_at: expires,
    } };
  }

  it("omits both unchanged instants when editing only notes", fakeAsync(() => {
    const component = open();
    component.form.controls.notes.setValue("Revised notes");
    const body = send(component);
    expect(body["notes"]).toBe("Revised notes");
    expect(body["version"]).toBe(13);
    expect(Object.hasOwn(body, "scheduledAt")).toBeFalse();
    expect(Object.hasOwn(body, "expiresAt")).toBeFalse();
    expect(dialog.close).toHaveBeenCalledWith(existingLink());
  }));

  it("allows a valid original window entirely within one displayed minute", fakeAsync(() => {
    const component = open({ expiresAt: "2030-01-01T12:00:50.789Z" });
    expect(component.form.hasError("lifecycleOrder")).toBeFalse();
    const body = send(component);
    expect(Object.hasOwn(body, "scheduledAt")).toBeFalse();
    expect(Object.hasOwn(body, "expiresAt")).toBeFalse();
  }));

  for (const field of ["scheduledAt", "expiresAt"] as const) {
    const other = field === "scheduledAt" ? "expiresAt" : "scheduledAt";
    const replacement = field === "scheduledAt" ? "2030-01-01T11:00:00.000Z" : "2030-01-01T14:00:00.000Z";
    it(`sends an explicit ${field} edit while omitting ${other}`, fakeAsync(() => {
      const component = open();
      component.form.controls[field].setValue(localDateTimeValue(replacement));
      const body = send(component);
      expect(body[field]).toBe(replacement);
      expect(Object.hasOwn(body, other)).toBeFalse();
    }));

    it(`clears ${field} with null while preserving ${other}`, fakeAsync(() => {
      const component = open();
      component.form.controls[field].setValue("");
      const body = send(component);
      expect(body[field]).toBeNull();
      expect(Object.hasOwn(body, other)).toBeFalse();
    }));

    it(`preserves ${field} after changing and reverting its displayed value`, fakeAsync(() => {
      const component = open();
      const original = component.form.controls[field].value;
      component.form.controls[field].setValue(localDateTimeValue(replacement));
      component.form.controls[field].setValue(original);
      const body = send(component);
      expect(Object.hasOwn(body, field)).toBeFalse();
    }));
  }

  it("preserves an expired original instant during an unrelated edit", fakeAsync(() => {
    const component = open({ scheduledAt: null, expiresAt: "2020-01-01T12:00:50.789Z" });
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeFalse();
    expect(Object.hasOwn(send(component), "expiresAt")).toBeFalse();
  }));

  it("applies exact template instants even when their displayed minutes match the link", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:20.456Z", "2030-01-01T13:00:40.987Z"));
    const body = send(component);
    expect(body["scheduledAt"]).toBe("2030-01-01T12:00:20.456Z");
    expect(body["expiresAt"]).toBe("2030-01-01T13:00:40.987Z");
  }));

  it("permits a valid template window within one minute", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:20.456Z", "2030-01-01T12:00:40.987Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeFalse();
    expect(send(component)["expiresAt"]).toBe("2030-01-01T12:00:40.987Z");
  }));

  it("keeps a template expiry future when it is later in the present minute", fakeAsync(() => {
    spyOn(Date, "now").and.returnValue(Date.parse("2030-01-01T12:00:10.000Z"));
    const component = open({}, true);
    component.applyTemplate(template(null, "2030-01-01T12:00:40.987Z"));
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeFalse();
    expect(send(component)["expiresAt"]).toBe("2030-01-01T12:00:40.987Z");
  }));

  it("exports known original instants when saving a template", fakeAsync(() => {
    const component = open();
    void component.saveAsTemplate();
    flushMicrotasks();
    const request = http.expectOne("/api/v1/link-templates");
    const body = JSON.parse(request.request.serializeBody() as string) as { payload: Record<string, unknown> };
    expect(body.payload["scheduled_at"]).toBe(data.link!.scheduledAt);
    expect(body.payload["expires_at"]).toBe(data.link!.expiresAt);
    request.flush({ template: template(data.link!.scheduledAt, data.link!.expiresAt) });
    flushMicrotasks();
  }));

  it("clears old dates when applying a template with no dates", fakeAsync(() => {
    const component = open();
    component.applyTemplate({ id: 1, name: "Untimed", createdAt: "2026-10-06T12:00:00Z", payload: { destination: "https://example.test/untimed" } });
    const body = send(component);
    expect(body["scheduledAt"]).toBeNull();
    expect(body["expiresAt"]).toBeNull();
  }));

  it("rejects a truly inverted template window", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:50.789Z", "2030-01-01T12:00:10.123Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));

  it("rejects invalid calendar input before dispatch", fakeAsync(() => {
    const component = open();
    component.form.controls.scheduledAt.setValue("2030-02-30T12:00");
    expect(component.form.controls.scheduledAt.hasError("localDateTime")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));

  it("retains future validation for a new manually expired link", fakeAsync(() => {
    const component = open({}, true);
    component.form.controls.expiresAt.setValue("2020-01-01T12:00");
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "POST");
  }));

  it("refuses to submit into a different workspace", fakeAsync(() => {
    const component = open();
    workspaceId.set(2);
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
    expect(dialog.close).toHaveBeenCalled();
  }));

  it("allows template instants separated only by microseconds", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:20.123456Z", "2030-01-01T12:00:20.123789Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeFalse();
    expect(send(component)["expiresAt"]).toBe("2030-01-01T12:00:20.123789Z");
  }));

  it("rejects a template window inverted only by microseconds", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:20.123789Z", "2030-01-01T12:00:20.123456Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));

  it("treats a template expiry one microsecond after the clock as future", fakeAsync(() => {
    spyOn(Date, "now").and.returnValue(Date.parse("2030-01-01T12:00:20.123Z"));
    const component = open({}, true);
    component.applyTemplate(template(null, "2030-01-01T12:00:20.123001Z"));
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeFalse();
    expect(send(component)["expiresAt"]).toBe("2030-01-01T12:00:20.123001Z");
  }));

  it("uses the typed minute after editing an applied template and retains the other exact instant", fakeAsync(() => {
    const component = open();
    component.applyTemplate(template("2030-01-01T12:00:20.456Z", "2030-01-01T13:00:40.987Z"));
    component.form.controls.scheduledAt.setValue(localDateTimeValue("2030-01-01T11:00:00.000Z"));
    const body = send(component);
    expect(body["scheduledAt"]).toBe("2030-01-01T11:00:00.000Z");
    expect(body["expiresAt"]).toBe("2030-01-01T13:00:40.987Z");
  }));

  it("re-judges an exact template expiry that passes while the dialog is open", fakeAsync(() => {
    let clock = Date.parse("2030-01-01T12:00:10.000Z");
    spyOn(Date, "now").and.callFake(() => clock);
    const component = open({}, true);
    component.applyTemplate(template(null, "2030-01-01T12:00:40.987Z"));
    clock = Date.parse("2030-01-01T12:00:40.987Z");
    void component.save(); flushMicrotasks();
    expect(component.form.controls.expiresAt.hasError("pastDateTime")).toBeTrue();
    http.expectNone((request) => request.method === "POST");
  }));

  it("sends only one request while a save is pending", fakeAsync(() => {
    const component = open();
    void component.save(); void component.save(); flushMicrotasks();
    const requests = http.match((request) => request.method === "PATCH");
    expect(requests.length).toBe(1);
    requests[0].flush({ link: existingLink() }); flushMicrotasks();
  }));

  it("rejects a valid response for another link without closing the editor", fakeAsync(() => {
    const component = open();
    void component.save(); flushMicrotasks();
    http.expectOne("/api/v1/links/7").flush({ link: existingLink({ id: 8 }) });
    flushMicrotasks();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(component.error()).toBe("El servidor devolvió una respuesta no válida");
    expect(component.busy()).toBeFalse();
  }));

  it("can edit notes after a valid microsecond window round-trips through a millisecond DTO", fakeAsync(() => {
    const component = open({ scheduledAt: "2030-01-01T12:00:20.123Z", expiresAt: "2030-01-01T12:00:20.123Z" });
    component.form.controls.notes.setValue("Keep the stored microsecond window");
    expect(component.form.hasError("lifecycleOrder")).toBeFalse();
    const body = send(component);
    expect(body["notes"]).toBe("Keep the stored microsecond window");
    expect(Object.hasOwn(body, "scheduledAt")).toBeFalse();
    expect(Object.hasOwn(body, "expiresAt")).toBeFalse();
  }));

  it("rejects equal instants introduced by applying a template to an existing link", fakeAsync(() => {
    const component = open({ scheduledAt: "2030-01-01T12:00:20.123Z", expiresAt: "2030-01-01T12:00:20.123Z" });
    component.applyTemplate(template("2030-01-01T12:00:20.123Z", "2030-01-01T12:00:20.123Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));

  it("rejects equal manually edited dates instead of treating them as retained storage", fakeAsync(() => {
    const component = open();
    component.form.controls.scheduledAt.setValue(localDateTimeValue("2030-01-01T14:00:00.000Z"));
    component.form.controls.expiresAt.setValue(localDateTimeValue("2030-01-01T14:00:00.000Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));

  it("still rejects an original window whose DTO instants are reversed", fakeAsync(() => {
    const component = open({ scheduledAt: "2030-01-01T12:00:20.124Z", expiresAt: "2030-01-01T12:00:20.123Z" });
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "PATCH");
  }));


  it("rejects equal instants when creating a link from a template", fakeAsync(() => {
    const component = open({}, true);
    component.applyTemplate(template("2030-01-01T12:00:20.123Z", "2030-01-01T12:00:20.123Z"));
    expect(component.form.hasError("lifecycleOrder")).toBeTrue();
    void component.save(); flushMicrotasks();
    http.expectNone((request) => request.method === "POST");
  }));

  it("surfaces the server's window rejection without closing or replacing retained dates", fakeAsync(() => {
    const component = open({ scheduledAt: "2030-01-01T12:00:20.123Z", expiresAt: "2030-01-01T12:00:20.123Z" });
    component.form.controls.notes.setValue("Server remains authoritative");
    void component.save(); flushMicrotasks();
    const request = http.expectOne("/api/v1/links/7");
    const body = JSON.parse(request.request.serializeBody() as string) as Record<string, unknown>;
    expect(Object.hasOwn(body, "scheduledAt")).toBeFalse();
    expect(Object.hasOwn(body, "expiresAt")).toBeFalse();
    request.flush({ error: "La expiración debe ser posterior a la activación" }, { status: 422, statusText: "Unprocessable Content" });
    flushMicrotasks();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(component.error()).toBe("La expiración debe ser posterior a la activación");
    expect(component.busy()).toBeFalse();
  }));

});
