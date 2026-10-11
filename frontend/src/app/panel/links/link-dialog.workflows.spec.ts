import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import type { LinkDto } from "../../core/models";
import { defaultExpiredPage } from "../../core/link-workflows";
import { ApiService } from "../../core/services/api.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { LinkDialogComponent } from "./link-dialog.component";

describe("LinkDialogComponent duplication workflows", () => {
  let fixture: ComponentFixture<LinkDialogComponent>, component: LinkDialogComponent;
  let api: jasmine.SpyObj<ApiService>, dialog: jasmine.SpyObj<MatDialogRef<LinkDialogComponent>>, duplicate: jasmine.Spy;
  const workspace = signal<number | null>(1), enabled = signal(true), selection = signal(0);
  const source: LinkDto = { id: 7, name: "Carta Navidad", alias: "navidad", destination: "https://example.test/christmas", fallbackDestination: "https://example.test/backup", state: "paused", clickCount: 99, maxClicks: 100, singleUse: true, usedAt: "2026-09-30T10:00:00Z", scheduledAt: "2026-09-01T08:30:29.123456Z", expiresAt: "2026-10-01T16:40:49.654321Z", notes: "Nota", passwordProtected: true, utm: { source: "email", medium: "qr", campaign: "navidad", term: null, content: null }, domainId: null, domain: null, collectionId: 4, collection: "Campañas", tags: ["navidad"], createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-02T08:00:00Z", version: 42, shortUrl: "https://uvh.test/navidad", expiredPage: defaultExpiredPage() };

  beforeEach(async () => {
    workspace.set(1); enabled.set(true); selection.set(0); api = jasmine.createSpyObj<ApiService>("API", ["get", "post", "patch"]);
    api.get.and.resolveTo({ domains: [], collections: [], templates: [], rules: [{ destination: "https://example.test/es", country: "ES", priority: 1 }] } as never);
    duplicate = jasmine.createSpy("duplicate").and.resolveTo({ link: { ...source, id: 99, clickCount: 0, usedAt: null, version: 1 } });
    api.post.and.callFake((path: string) => (path.endsWith("/check-alias") ? Promise.resolve({ available: true }) : duplicate()) as never);
    dialog = jasmine.createSpyObj<MatDialogRef<LinkDialogComponent>>("Dialog", ["close"]);
    await TestBed.configureTestingModule({ imports: [LinkDialogComponent], providers: [FormBuilder,
      { provide: ApiService, useValue: api }, { provide: MatDialogRef, useValue: dialog }, { provide: MAT_DIALOG_DATA, useValue: { mode: "duplicate", link: source } },
      { provide: WorkspaceService, useValue: { currentId: workspace, selectionGeneration: selection, currentRole: () => "owner" } }, { provide: LinkWorkflowService, useValue: { enabled, capabilities: () => null } },
      { provide: ActionDialogService, useValue: jasmine.createSpyObj("Actions", ["prompt", "confirm"]) },
    ] }).overrideComponent(LinkDialogComponent, { set: { template: "", imports: [] } }).compileComponents();
    fixture = TestBed.createComponent(LinkDialogComponent); component = fixture.componentInstance; fixture.autoDetectChanges(); await fixture.whenStable();
    component.aliasStatus.set("available");
  });
  afterEach(() => fixture.destroy());
  const payload = (api: jasmine.SpyObj<ApiService>) => api.post.calls.all().filter(call => call.args[0].endsWith("/duplicate")).at(-1)!.args[1] as Record<string, unknown>;

  it("prefills the original settings and proposes a different alias without exposing its password", async () => {
    expect(component.form.controls.alias.value).toMatch(/^navidad-copia-[a-f0-9]{6}$/); expect(component.form.controls.alias.value).not.toBe(source.alias);
    expect(component.form.controls.destination.value).toBe(source.destination); expect(component.tags()).toEqual(source.tags); expect(component.ruleForms.length).toBe(1);
    expect(component.form.controls.password.value).toBe(""); expect(component.expiredPage()).toEqual(source.expiredPage!);
    expect(component.duplicateExpired).toBeTrue(); await component.save();
    const body = payload(api); expect(body["passwordAction"]).toBe("keep"); expect(body["password"]).toBeUndefined(); expect(body["sourceVersion"]).toBe(42);
    expect(body["clickCount"]).toBeUndefined(); expect(body["usedAt"]).toBeUndefined(); expect(body["rules"]).toEqual([jasmine.objectContaining({ destination: "https://example.test/es" })]);
    expect(dialog.close).toHaveBeenCalledWith(jasmine.objectContaining({ id: 99, clickCount: 0 }));
  });

  it("copies the internal name and includes explicit name changes", async () => {
    expect(component.form.controls.name.value).toBe("Carta Navidad");
    component.form.controls.name.setValue("Carta duplicada"); await component.save();
    expect(payload(api)["name"]).toBe("Carta duplicada");
  });

  it("only applies a confirmed suggestion for the current destination and preserves newer typing", async () => {
    const actions = TestBed.inject(ActionDialogService) as jasmine.SpyObj<ActionDialogService>;
    component.form.controls.name.setValue("");
    await component.applySuggestedName({ title: "Nombre remoto", url: "https://other.test/" });
    expect(component.form.controls.name.value).toBe("");
    await component.applySuggestedName({ title: "Nombre remoto", url: component.destinationValue() });
    expect(component.form.controls.name.value).toBe("Nombre remoto");
    let resolve!: (value: boolean) => void;
    actions.confirm.and.returnValue(new Promise<boolean>(done => resolve = done));
    const pending = component.applySuggestedName({ title: "Título nuevo", url: component.destinationValue() });
    component.form.controls.name.setValue("Lo que escribo"); resolve(true); await pending;
    expect(component.form.controls.name.value).toBe("Lo que escribo");
  });

  it("checks the visible alias and domain rather than the previous group value", async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    api.post.calls.reset();
    component.form.controls.alias.setValue("navidad-copia-visible");
    component.form.controls.domainId.setValue(12);
    await new Promise(resolve => setTimeout(resolve, 250));
    const checks = api.post.calls.all().filter(call => call.args[0].endsWith("/check-alias"));
    expect(checks.length).toBe(1);
    expect(checks[0].args[1]).toEqual({ alias: "navidad-copia-visible", domainId: 12 });
    expect(component.aliasStatus()).toBe("available");
  });

  for (const action of ["replace", "remove"] as const) {
    it(`sends the explicit ${action} password action`, async () => {
      component.form.controls.password.setValue("new-password"); if (action === "remove") component.form.controls.clearPassword.setValue(true);
      await component.save(); const body = payload(api);
      expect(body["passwordAction"]).toBe(action); expect(body["password"]).toBe(action === "replace" ? "new-password" : undefined);
    });
  }

  it("leaves unchanged instants to the server to preserve their microsecond precision", async () => {
    await component.save(); const body = payload(api);
    expect(body["scheduledAt"]).toBeUndefined(); expect(body["expiresAt"]).toBeUndefined();
    component.form.controls.expiresAt.setValue("2030-12-01T12:00"); await component.save();
    expect(payload(api)["expiresAt"]).toBe(new Date(2030, 11, 1, 12).toISOString());
  });

  it("reuses an idempotency key for an unchanged retry and replaces it after an edit", async () => {
    duplicate.and.rejectWith(new Error("Connection interrupted")); await component.save(); await component.save();
    const calls = api.post.calls.all().filter(call => call.args[0].endsWith("/duplicate"));
    expect(calls[0].args[3]).toEqual(calls[1].args[3]); expect(calls[0].args[3]).toEqual({ "Idempotency-Key": jasmine.any(String) });
    component.form.controls.notes.setValue("Nueva nota"); await component.save();
    expect(api.post.calls.mostRecent().args[3]).not.toEqual(calls[0].args[3]);
  });

  it("refuses to send the duplicate into a different workspace", async () => {
    workspace.set(2); await component.save(); expect(duplicate).not.toHaveBeenCalled(); expect(dialog.close).toHaveBeenCalled();
  });

  it("does not return a late duplicate result after its workspace changed", async () => {
    let resolve!: (value: { link: LinkDto }) => void; duplicate.and.returnValue(new Promise<{ link: LinkDto }>(done => resolve = done));
    const pending = component.save(); workspace.set(2); resolve({ link: { ...source, id: 99 } }); await pending;
    expect(dialog.close).not.toHaveBeenCalledWith(jasmine.objectContaining({ id: 99 }));
  });
  for (const transition of ["workspace ABA", "session"] as const) {
    it(`does not publish a duplicate after ${transition} even before the cleanup effect`, async () => {
      let resolve!: (value: { link: LinkDto }) => void;
      duplicate.and.returnValue(new Promise<{ link: LinkDto }>(done => resolve = done));
      const pending = component.save();
      if (transition === "session") TestBed.inject(SessionContextService).advance();
      else { workspace.set(2); selection.update(value => value + 1); workspace.set(1); selection.update(value => value + 1); }
      resolve({ link: { ...source, id: 99 } }); await pending;
      expect(dialog.close).not.toHaveBeenCalledWith(jasmine.objectContaining({ id: 99 }));
    });
  }
});
