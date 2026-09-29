import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { of } from "rxjs";
import { DomainDetailComponent } from "./domain-detail.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { DomainDto } from "../../core/models";

function domainDto(overrides: Partial<DomainDto> = {}): DomainDto {
  return {
    id: 7,
    domain: "go.example.test",
    state: "active",
    desiredState: "enabled",
    ownershipStatus: "verified",
    routingStatus: "healthy",
    tlsStatus: "ready",
    trafficStatus: "online",
    servingReady: true,
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
    dnsObservedAt: "2026-09-28T10:00:05Z",
    ownershipTxtPresent: true,
    routingObservedTarget: "edge.example.test",
    routingObservedTtl: 300,
    routingObservedAddresses: ["192.0.2.10"],
    routingObservedProxied: false,
    caaRecords: null,
    caaAllowsIssuer: null,
    acmeIssuer: "letsencrypt.org",
    edgeEligible: true,
    tlsReadyAt: "2026-09-28T10:05:00Z",
    tlsError: null,
    tlsCheckedAt: "2026-09-28T10:05:00Z",
    tlsNotAfter: "2026-12-27T10:05:00Z",
    tlsIssuer: "letsencrypt.org",
    tlsDaysRemaining: 90,
    tlsLastAttemptAt: "2026-09-28T10:04:00Z",
    tlsNextRetryAt: null,
    tlsProbeFailures: 0,
    rootDestination: null,
    notFoundMode: null,
    isDefault: false,
    linksCount: 3,
    createdAt: "2026-09-28T09:00:00Z",
    ...overrides,
  };
}

describe("DomainDetailComponent speaks the traffic model", () => {
  let fixture: ComponentFixture<DomainDetailComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const role = signal("owner");
  const workspace = signal(1);
  let activity: { id: number; event: string; payload: Record<string, unknown>; createdAt: string }[];

  beforeEach(async () => {
    role.set("owner");
    workspace.set(1);
    activity = [];
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.callFake(((path: string) => Promise.resolve(
      path.endsWith("/activity") ? { events: activity } : { domain: domainDto() },
    )) as never);
    api.post.and.resolveTo(undefined as never);
    api.patch.and.resolveTo(undefined as never);
    await TestBed.configureTestingModule({
      imports: [DomainDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: "7" }) },
            paramMap: of(convertToParamMap({ id: "7" })),
          },
        },
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DomainDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("labels the derived traffic state instead of a saved state or the edge flag", () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("Tráfico:");
    expect(host.textContent).toContain("En línea");
    // The old model's vocabulary is gone: `state` is a derived label and
    // `edgeEligible` is an implementation detail, never user-facing copy.
    expect(host.textContent).not.toContain("Estado guardado");
    expect(host.textContent).not.toContain("edgeEligible");
    expect(host.textContent).not.toContain("Entrada pública en edge");
    expect(host.querySelector(".state-chip")).not.toBeNull();
  });

  it("renders the activity timeline with projected details, not internal payloads", async () => {
    activity = [
      { id: 1, event: "domain.tls_expiring", payload: { daysRemaining: 12, notAfter: "2026-10-08T10:00:00Z" }, createdAt: "2026-09-28T10:00:00Z" },
      { id: 2, event: "domain.offline", payload: { reason: "routing_missing", failureCount: 3 }, createdAt: "2026-09-27T10:00:00Z" },
      { id: 3, event: "domain.recovered", payload: {}, createdAt: "2026-09-26T10:00:00Z" },
    ];
    await fixture.componentInstance.loadActivity();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const items = host.querySelectorAll(".activity-item");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("Certificado por caducar");
    expect(items[0].textContent).toContain("quedan 12 días");
    expect(items[1].textContent).toContain("Dominio fuera de servicio");
    expect(items[1].textContent).toContain("El CNAME todavía no apunta al destino esperado.");
    expect(items[1].textContent).toContain("3 comprobaciones fallidas");
    expect(items[2].textContent).toContain("Dominio recuperado");
    // Tones drive the icon family: offline is an error, expiring a warning.
    expect(items[0].className).toContain("activity-warn");
    expect(items[1].className).toContain("activity-bad");
    expect(items[2].className).toContain("activity-good");
  });

  it("keeps a failed activity read from blanking the diagnostics", async () => {
    api.get.and.callFake(((path: string) => Promise.resolve(
      path.endsWith("/activity") ? Promise.reject(new Error("offline")) : { domain: domainDto() },
    )) as never);
    await fixture.componentInstance.loadActivity();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector(".activity-card")?.textContent).toContain("No se pudo cargar la actividad del dominio");
    // The diagnostic grid is still on screen: the timeline is a companion view.
    expect(host.querySelector(".diagnostic-grid")).not.toBeNull();
  });
});
