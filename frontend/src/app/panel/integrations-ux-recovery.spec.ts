import { signal, type Type } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { of } from "rxjs";
import { DomainsComponent } from "./domains/domains.component";
import { DomainDetailComponent } from "./domains/domain-detail.component";
import { WebhooksComponent } from "./webhooks/webhooks.component";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { ActionDialogService } from "./action-dialog.service";
import type { DomainDto, WebhookDto, WebhookDelivery } from "../core/models";

function domainDto(overrides: Partial<DomainDto> = {}): DomainDto {
  return {
    id: 7,
    domain: "go.example.test",
    state: "verified",
    desiredState: "enabled",
    ownershipStatus: "verified",
    routingStatus: "healthy",
    tlsStatus: "pending",
    trafficStatus: "offline",
    servingReady: false,
    verificationHost: "_uvh-verification.go.example.test",
    verificationToken: "opaque-token",
    cnameTarget: "edge.example.test",
    verificationScheme: 2,
    verifiedAt: "2026-09-28T10:00:00Z",
    ownershipVerifiedAt: "2026-09-28T10:00:00Z",
    routingVerifiedAt: "2026-09-28T10:00:00Z",
    dnsCheckStartedAt: "2026-09-28T10:00:00Z",
    dnsCheckCompletedAt: "2026-09-28T10:00:05Z",
    dnsError: null,
    dnsCheckInProgress: false,
    automaticDnsRetry: true,
    dnsRetryIntervalHours: 24,
    nextDnsCheckAt: "2026-09-29T10:00:00Z",
    dnsCheckDue: false,
    dnsFailureCount: 0,
    dnsMaxFailures: 3,
    dnsFirstFailedAt: null,
    graceExpiresAt: null,
    dnsObservedAt: null,
    ownershipTxtPresent: null,
    routingObservedTarget: null,
    routingObservedTtl: null,
    routingObservedAddresses: null,
    routingObservedProxied: null,
    caaRecords: null,
    caaAllowsIssuer: null,
    acmeIssuer: "letsencrypt.org",
    edgeEligible: false,
    tlsReadyAt: null,
    tlsError: null,
    tlsCheckedAt: null,
    tlsNotAfter: null,
    tlsIssuer: null,
    tlsDaysRemaining: null,
    tlsLastAttemptAt: null,
    tlsNextRetryAt: null,
    tlsProbeFailures: 0,
    rootDestination: null,
    notFoundMode: null,
    isDefault: false,
    linksCount: 0,
    createdAt: "2026-09-28T09:00:00Z",
    ...overrides,
  };
}


const hook: WebhookDto = { id: 5, url: "https://example.invalid/receiver", events: ["link.created"], active: true, hasSecret: true, createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z" };
const delivery: WebhookDelivery = { id: 8, webhook_id: 5, event: "link.created", event_id: "fictional-event", status: "failed", attempts: 2, error: { code: "connection_failed", message: "Fixture timed out" }, payloadPreview: { event: "link.created", eventId: "fictional-event", timestamp: null, data: {}, redacted: true }, next_attempt_at: null, created_at: "2026-10-07T00:00:00Z", delivered_at: null };
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Integrations UX recovery", () => {
  let api: jasmine.SpyObj<ApiService>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let dispose: (() => void) | undefined;
  const workspace = signal(1);
  const role = signal("owner");
  beforeEach(() => {
    workspace.set(1); role.set("owner"); dispose = undefined;
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    snack = jasmine.createSpyObj<MatSnackBar>("MatSnackBar", ["open"]);
    api.get.and.callFake(((path: string) => Promise.resolve(path === "/api/v1/domains" ? { domains: [] } : path.endsWith("/activity") ? { events: [] } : path.startsWith("/api/v1/domains/") ? { domain: domainDto() } : path.endsWith("/deliveries") ? { deliveries: [delivery], total: 1, page: 1, perPage: 20 } : { webhooks: [hook] })) as never);
    api.post.and.resolveTo(undefined); api.patch.and.resolveTo(undefined);
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: "7" }) }, paramMap: of(convertToParamMap({ id: "7" })) } },
      { provide: ApiService, useValue: api }, { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      { provide: MatSnackBar, useValue: snack }, { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy().and.resolveTo(false) } },
    ] });
  });
  afterEach(() => dispose?.());
  async function mount<T>(type: Type<T>): Promise<ComponentFixture<T>> {
    TestBed.overrideComponent(type, { add: { providers: [{ provide: MatSnackBar, useValue: snack }] } });
    const fixture = TestBed.createComponent(type); dispose = () => fixture.destroy();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); snack.open.calls.reset();
    return fixture;
  }
  it("does not erase a newer domain draft after a pending add succeeds", async () => {
    const f = await mount(DomainsComponent); const c = f.componentInstance;
    const reply = deferred<{ domain: DomainDto }>(); api.post.and.returnValue(reply.promise);
    c.newDomain.set("first.example.invalid"); const adding = c.add();
    c.newDomain.set("next.example.invalid"); reply.resolve({ domain: domainDto() }); await adding;
    expect(c.newDomain()).toBe("next.example.invalid"); expect(c.domains().length).toBe(1); expect(c.adding()).toBeFalse();
  });
  it("clears the original domain draft only after its own successful add", async () => {
    const f = await mount(DomainsComponent); const c = f.componentInstance;
    api.post.and.resolveTo({ domain: domainDto() }); c.newDomain.set("first.example.invalid"); await c.add();
    expect(c.newDomain()).toBe(""); expect(c.domains().length).toBe(1);
  });
  for (const change of ["workspace", "role"]) {
    it(`discards a late edit success notice after ${change} changes`, async () => {
      const f = await mount(WebhooksComponent); const c = f.componentInstance;
      c.startEdit(hook); const reply = deferred<unknown>(); api.patch.and.returnValue(reply.promise);
      const saving = c.save(); if (change === "workspace") workspace.set(2); else role.set("viewer");
      f.detectChanges(); await f.whenStable(); snack.open.calls.reset();
      reply.resolve({ ok: true }); await saving;
      expect(snack.open).not.toHaveBeenCalled(); expect(c.saving()).toBeFalse(); expect(c.showForm()).toBeFalse();
    });
  }
  it("publishes the current edit confirmation after a successful patch", async () => {
    const f = await mount(WebhooksComponent); f.componentInstance.startEdit(hook); await f.componentInstance.save();
    expect(snack.open).toHaveBeenCalledWith("Webhook actualizado", "Cerrar", { duration: 2500 });
  });
  it("refreshes an accepted resend through GET instead of caching an empty history", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance; await c.loadDeliveries(hook);
    const queued = { ...delivery, status: "pending" as const, error: null };
    api.get.and.resolveTo({ deliveries: [queued], total: 1, page: 1, perPage: 20 }); api.get.calls.reset();
    await c.resend(hook, delivery.id);
    expect(api.get).toHaveBeenCalled(); expect(c.deliveries()[hook.id]).toEqual([queued]);
    expect(api.post.calls.count()).toBe(1); expect(c.deliveryLabel(c.deliveries()[hook.id]?.[0]?.status ?? "failed")).toBe("En cola");
  });
  it("keeps the last delivery and a read error when resend is accepted but refresh fails", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance; await c.loadDeliveries(hook);
    api.get.and.rejectWith(new ApiRequestError("No se pudo consultar el historial", 503));
    await c.resend(hook, delivery.id);
    expect(c.deliveries()[hook.id]).toEqual([delivery]); expect(c.deliveriesError()[hook.id]).toBe("No se pudo consultar el historial");
    expect(api.post.calls.count()).toBe(1); expect(c.actionId()).toBeNull();
  });
  for (const edit of ["root", "mode"]) {
    it(`preserves a newer visitor ${edit} draft when the earlier save succeeds`, async () => {
      const f = await mount(DomainDetailComponent); const c = f.componentInstance;
      c.onRootChange("https://example.invalid/first"); c.onModeChange("redirect");
      const reply = deferred<{ domain: DomainDto }>(); api.patch.and.returnValue(reply.promise); const saving = c.saveSurface();
      if (edit === "root") c.onRootChange("https://example.invalid/next"); else c.onModeChange("branded");
      reply.resolve({ domain: domainDto({ rootDestination: "https://example.invalid/first", notFoundMode: "redirect" }) }); await saving;
      expect(c.surfaceDirty()).toBeTrue();
      expect(edit === "root" ? c.rootDestinationInput() : c.notFoundModeInput()).toBe(edit === "root" ? "https://example.invalid/next" : "branded");
      expect(c.domain()?.rootDestination).toBe("https://example.invalid/first");
    });
  }
  it("reconciles the server's visitor preference when its draft is unchanged", async () => {
    const f = await mount(DomainDetailComponent); const c = f.componentInstance;
    c.onRootChange("https://example.invalid"); c.onModeChange("redirect");
    api.patch.and.resolveTo({ domain: domainDto({ rootDestination: "https://example.invalid/", notFoundMode: "redirect" }) }); await c.saveSurface();
    expect(c.surfaceDirty()).toBeFalse(); expect(c.rootDestinationInput()).toBe("https://example.invalid/");
  });
  it("preserves a rejected domain draft and does not publish an invented row", async () => {
    const f = await mount(DomainsComponent); const c = f.componentInstance;
    api.post.and.rejectWith(new ApiRequestError("Subdominio no permitido", 422));
    c.newDomain.set("my.example.invalid"); await c.add();
    expect(c.newDomain()).toBe("my.example.invalid"); expect(c.domains()).toEqual([]); expect(c.adding()).toBeFalse();
  });
  it("keeps dirty visitor preferences after a rejected save", async () => {
    const f = await mount(DomainDetailComponent); const c = f.componentInstance;
    c.onRootChange("https://example.invalid/draft"); c.onModeChange("branded");
    api.patch.and.rejectWith(new ApiRequestError("No se pudo guardar", 503)); await c.saveSurface();
    expect(c.surfaceDirty()).toBeTrue(); expect(c.rootDestinationInput()).toBe("https://example.invalid/draft"); expect(c.actionBusy()).toBeFalse();
  });
  it("recovers the history read without repeating an accepted resend", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance; await c.loadDeliveries(hook);
    api.get.and.rejectWith(new ApiRequestError("Historial no disponible", 503)); await c.resend(hook, delivery.id);
    await c.resend(hook, delivery.id); expect(api.post.calls.count()).toBe(1);
    api.get.and.resolveTo({ deliveries: [{ ...delivery, status: "pending", error: null }], total: 1, page: 1, perPage: 20 });
    await c.loadDeliveries(hook);
    expect(c.deliveriesError()[hook.id]).toBeNull(); expect(c.deliveries()[hook.id][0].status).toBe("pending"); expect(api.post.calls.count()).toBe(1);
  });
  it("replaces an older in-flight history read after an accepted resend", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance; await c.loadDeliveries(hook);
    const command = deferred<unknown>(); api.post.and.returnValue(command.promise); const resending = c.resend(hook, delivery.id);
    const read = deferred<unknown>(); api.get.and.returnValue(read.promise); const older = c.loadDeliveries(hook, true);
    const queued = { ...delivery, status: "pending" as const, error: null };
    api.get.and.resolveTo({ deliveries: [queued], total: 1, page: 1, perPage: 20 });
    command.resolve({ ok: true }); await resending;
    read.resolve({ deliveries: [delivery], total: 1, page: 1, perPage: 20 }); await older;
    expect(c.deliveries()[hook.id]).toEqual([queued]); expect(c.deliveriesLoading()[hook.id]).toBeFalse(); expect(api.post.calls.count()).toBe(1);
  });
  it("discards a pending history response after the workspace changes", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance;
    const read = deferred<unknown>(); api.get.and.returnValue(read.promise); const loading = c.loadDeliveries(hook);
    api.get.and.resolveTo({ webhooks: [hook] }); workspace.set(2); f.detectChanges(); await f.whenStable();
    read.resolve({ deliveries: [delivery], total: 1, page: 1, perPage: 20 }); await loading;
    expect(c.deliveries()).toEqual({}); expect(c.deliveriesError()).toEqual({});
  });
  it("loads delivery history only when its native disclosure is opened", async () => {
    const f = await mount(WebhooksComponent); api.get.calls.reset();
    expect(f.nativeElement.querySelectorAll('.wh-card').length).toBe(1);
    expect(f.nativeElement.querySelector('.wh-url').getAttribute('href')).toBe('/app/webhooks/5');
    expect(api.get).not.toHaveBeenCalled();
    const details = f.nativeElement.querySelector('.delivery-history') as HTMLDetailsElement;
    details.open = true; details.dispatchEvent(new Event('toggle'));
    await f.whenStable(); f.detectChanges();
    expect(api.get.calls.count()).toBe(1); expect(f.nativeElement.querySelector('.del-status').textContent).toContain('Fallida');
    expect(f.nativeElement.querySelector('.delivery-error').open).toBeFalse();
  });
  it("preserves a generated secret outside live regions until explicitly hidden", async () => {
    const f = await mount(WebhooksComponent); const c = f.componentInstance;
    c.startCreate(); c.url.set(hook.url); c.selectedEvents.set(hook.events);
    api.post.and.resolveTo({ webhook: hook, secret: 'FICTIONAL-signing-value-only' }); await c.save(); f.detectChanges();
    expect(f.nativeElement.querySelector('.secret-value code').textContent).toBe('FICTIONAL-signing-value-only');
    expect([...f.nativeElement.querySelectorAll('[role="status"], [aria-live]')].some(x => (x as HTMLElement).textContent?.includes('FICTIONAL-signing-value-only'))).toBeFalse();
    c.clearSecret(); f.detectChanges(); expect(f.nativeElement.querySelector('.secret-box')).toBeNull();
  });
  it("keeps viewer diagnostics and hides receiver write actions", async () => {
    role.set('viewer'); const f = await mount(WebhooksComponent);
    expect(f.nativeElement.querySelector('.wh-url')).not.toBeNull();
    expect(f.nativeElement.querySelector('.wh-actions button')).toBeNull();
    expect(f.nativeElement.textContent).toContain('Solo lectura');
  });
  it("routes DNS instructions to the detail and keeps advanced restrictions available", async () => {
    api.get.and.resolveTo({ domains: [domainDto({ state: 'pending' })] }); const f = await mount(DomainsComponent);
    expect(f.nativeElement.querySelector('.domain-card').textContent).not.toContain('opaque-token');
    expect(f.nativeElement.querySelector('.details-action a').getAttribute('href')).toBe('/app/domains/7');
    const help = f.nativeElement.querySelector('.advanced-help') as HTMLDetailsElement;
    expect(help.open).toBeFalse(); expect(help.textContent).toContain('Apex, flattening y proxies');
    expect(f.nativeElement.querySelector('.domain-actions button').textContent).toContain('Comprobar DNS');
  });

  it("describes a healthy observed CNAME without inventing a destination mismatch", async () => {
    const f = await mount(DomainDetailComponent); const c = f.componentInstance;
    c.domain.set(domainDto({ dnsObservedAt: "2026-10-07T00:00:00Z", routingObservedTarget: "edge.example.test", routingObservedTtl: 300 }));
    f.detectChanges();
    expect(c.observedRoutingLabel()).toBe("El CNAME apunta a «edge.example.test» (TTL 300 s).");
    expect(f.nativeElement.textContent).not.toContain("pero el resolvedor devuelve");
  });
  it("preserves the observed versus expected target when DNS routing is degraded", async () => {
    const f = await mount(DomainDetailComponent); const c = f.componentInstance;
    c.domain.set(domainDto({ dnsObservedAt: "2026-10-07T00:00:00Z", routingStatus: "degraded", routingObservedTarget: "other.example.test", routingObservedTtl: 60 }));
    expect(c.observedRoutingLabel()).toBe("Esperábamos «edge.example.test», pero el resolvedor devuelve «other.example.test» (TTL 60 s).");
  });
  it("keeps the unsupported address-only routing diagnosis", async () => {
    const f = await mount(DomainDetailComponent); const c = f.componentInstance;
    c.domain.set(domainDto({ dnsObservedAt: "2026-10-07T00:00:00Z", routingStatus: "degraded", routingObservedAddresses: ["192.0.2.10"] }));
    expect(c.observedRoutingLabel()).toContain("No hay CNAME en este nombre");
    expect(c.observedRoutingLabel()).toContain("192.0.2.10");
  });
  it("does not claim a DNS result before an observation exists", async () => {
    const f = await mount(DomainDetailComponent);
    expect(f.componentInstance.observedRoutingLabel()).toBeNull();
  });

});
