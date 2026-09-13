import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { WebhooksComponent } from "./webhooks.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import type { WebhookDto } from "../../core/models";

describe("WebhooksComponent presentation and capability", () => {
  let fixture: ComponentFixture<WebhooksComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let confirm: jasmine.Spy;
  const role = signal("owner");
  const workspace = signal(1);
  const webhook: WebhookDto = { id: 1, url: "https://example.invalid/receiver", events: ["link.created"], active: true, hasSecret: true, createdAt: "2026-09-13T12:00:00Z", updatedAt: "2026-09-13T12:00:00Z" };
  beforeEach(async () => {
    role.set("owner"); workspace.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    api.get.and.resolveTo({ webhooks: [webhook] });
    confirm = jasmine.createSpy("confirm").and.resolveTo(false);
    await TestBed.configureTestingModule({ imports: [WebhooksComponent], providers: [provideRouter([]),
      { provide: ApiService, useValue: api }, { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      { provide: ActionDialogService, useValue: { confirm } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(WebhooksComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it("labels the receiver and groups events with human descriptions", () => {
    fixture.componentInstance.startCreate(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="receiverUrl"]').required).toBeTrue();
    expect(fixture.nativeElement.querySelector("fieldset legend").textContent).toContain("Qué eventos");
    expect(fixture.nativeElement.querySelectorAll(".event-label").length).toBe(5);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBeTrue();
  });
  it("explains that editing without a new secret preserves the existing one", () => {
    fixture.componentInstance.startEdit(webhook); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Vacío conserva el secreto actual");
    expect(fixture.nativeElement.textContent).toContain("Guardar cambios");
  });
  it("does not announce a signing credential in a live region", () => {
    fixture.componentInstance.plainSecret.set("fictional-not-a-secret"); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".secret-value code").textContent).toBe("fictional-not-a-secret");
    const live = Array.from(fixture.nativeElement.querySelectorAll('[role="status"], [aria-live]') as NodeListOf<HTMLElement>);
    expect(live.some(node => node.textContent?.includes("fictional-not-a-secret"))).toBeFalse();
    fixture.componentInstance.startEdit(webhook);
    expect(fixture.componentInstance.plainSecret()).toBeNull();
  });
  it("clears the form on role loss and guards all write entry points", async () => {
    fixture.componentInstance.startCreate();
    fixture.componentInstance.secret.set("fictional-signing-value");
    role.set("viewer"); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.showForm()).toBeFalse();
    expect(fixture.componentInstance.secret()).toBe("");
    fixture.componentInstance.startCreate();
    await fixture.componentInstance.save(); await fixture.componentInstance.toggleActive(webhook);
    await fixture.componentInstance.test(webhook); await fixture.componentInstance.resend(webhook, 1); await fixture.componentInstance.remove(webhook);
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });
  it("rejects a confirmation after changing workspace", async () => {
    let resolveConfirmation!: (value: boolean) => void;
    confirm.and.returnValue(new Promise<boolean>(resolve => { resolveConfirmation = resolve; }));
    const operation = fixture.componentInstance.remove(webhook);
    workspace.set(2); resolveConfirmation(true); await operation;
    expect(api.delete).not.toHaveBeenCalled();
  });
  it("does not send a test for a paused receiver", async () => {
    await fixture.componentInstance.test({ ...webhook, active: false });
    expect(api.post).not.toHaveBeenCalled();
    expect(fixture.componentInstance.deliveryLabel("pending")).toBe("En cola");
  });
});
