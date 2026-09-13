import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { WebhookInspectorComponent } from "./webhook-inspector.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WebhookDelivery, WebhookDto } from "../../core/models";

describe("WebhookInspectorComponent presentation safety", () => {
  let fixture: ComponentFixture<WebhookInspectorComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const role = signal("owner");
  const webhook: WebhookDto = { id: 1, url: "https://example.invalid/receiver", active: true, hasSecret: true, events: ["link.created"], createdAt: "2026-09-13T12:00:00Z", updatedAt: "2026-09-13T12:00:00Z" };
  beforeEach(async () => {
    role.set("owner");
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.callFake(async <T>(path: string, _params?: Record<string, string | number | boolean | null | undefined>, decoder?: (value: unknown) => T): Promise<T> => {
      if (!decoder) throw new Error("Inspector reads must provide a decoder");
      return decoder(path === "/api/v1/webhooks" ? { webhooks: [webhook] } : { deliveries: [], total: 0, page: 1, perPage: 20 });
    });
    await TestBed.configureTestingModule({ imports: [WebhookInspectorComponent], providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: "1" }) } } },
      { provide: ApiService, useValue: api }, { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: role } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(WebhookInspectorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it("does not confuse failed reads with empty histories or show stale pagination", async () => {
    fixture.componentInstance.total.set(25);
    api.get.and.rejectWith(new Error("offline"));
    await fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector(".empty-state")).toBeNull();
    expect(fixture.nativeElement.querySelector(".pagination")).toBeNull();
    expect(fixture.nativeElement.querySelector(".test-action button").disabled).toBeTrue();
  });
  it("gives read-only users guidance without ping or resend controls", async () => {
    role.set("viewer");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".test-action")).toBeNull();
    expect(fixture.nativeElement.querySelector(".empty-state").textContent).toContain("pedir a un editor");
    expect(api.post).not.toHaveBeenCalled();
  });
  it("keeps queued and delivered outcomes distinct and exposes only the filtered payload", () => {
    const delivery: WebhookDelivery = { id: 2, webhook_id: 1, event: "link.created", event_id: "fictional-event", status: "pending", attempts: 0, error: null,
      payloadPreview: { event: "link.created", eventId: "fictional-event", timestamp: null, data: { linkId: 123 }, redacted: true }, next_attempt_at: null, created_at: "2026-09-13T12:00:00Z", delivered_at: null };
    fixture.componentInstance.deliveries.set([delivery]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".status").textContent).toContain("En cola");
    expect(fixture.nativeElement.querySelector(".timestamps").textContent).toContain("Sin entrega confirmada");
    expect(fixture.nativeElement.querySelector("details").open).toBeFalse();
    expect(fixture.nativeElement.querySelector("pre").textContent).toBe(JSON.stringify(delivery.payloadPreview, null, 2));
    expect(fixture.componentInstance.deliveryLabel("success")).toBe("Entregada");
    expect(api.post).not.toHaveBeenCalled();
  });
});
